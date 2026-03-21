"""LLM Judge for conversation quality assessment and flow extraction.

Reads a completed agent conversation (from the AgentMessage table),
sends the transcript to an LLM, and produces a ConversationJudgment
containing a clean high-level flow, a generic pattern summary, and
a quality assessment.

This module is part of the skill-evolution pipeline.  Its output is
stored on the ExecutionNode (quality, pattern_summary, root_cause,
confidence) and used downstream for workflow matching and refinement.
"""

from __future__ import annotations

import asyncio
import json
from functools import partial
from typing import Any
from uuid import UUID

from onyx.utils.logger import setup_logger
from onyx.workflow.models import ConversationJudgment
from onyx.workflow.models import FlowStep

logger = setup_logger()

# ---------------------------------------------------------------------------
# Truncation helpers
# ---------------------------------------------------------------------------

_MAX_TOOL_INPUT_CHARS = 200
_MAX_TOOL_OUTPUT_CHARS = 500


def _truncate(text: str, max_chars: int) -> str:
    """Truncate *text* to *max_chars*, appending an ellipsis when trimmed."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


# ---------------------------------------------------------------------------
# 1. Load conversation transcript
# ---------------------------------------------------------------------------


def _load_conversation_transcript(session_id: str, tenant_id: str) -> str:
    """Load all messages for *session_id* and format them as a readable transcript.

    Skips SYSTEM messages.  TOOL messages are formatted with abbreviated
    tool_input and tool_output.  Returns the full transcript as a string,
    or an empty string if the session has no meaningful content.
    """
    from onyx.db.agent import get_session_messages
    from onyx.db.engine.sql_engine import get_session_with_tenant

    with get_session_with_tenant(tenant_id=tenant_id) as db_session:
        messages = get_session_messages(db_session, UUID(session_id))

    if not messages:
        return ""

    lines: list[str] = []

    for msg in messages:
        role = msg.role.value.upper() if hasattr(msg.role, "value") else str(msg.role).upper()

        # Skip system messages — they are prompt scaffolding, not conversation.
        if role == "SYSTEM":
            continue

        if role == "TOOL":
            tool_name = msg.tool_name or "unknown_tool"

            # Serialize tool_input
            if msg.tool_input is not None:
                if isinstance(msg.tool_input, (dict, list)):
                    raw_input = json.dumps(msg.tool_input, default=str)
                else:
                    raw_input = str(msg.tool_input)
            else:
                raw_input = ""

            # Serialize tool_output
            if msg.tool_output is not None:
                if isinstance(msg.tool_output, (dict, list)):
                    raw_output = json.dumps(msg.tool_output, default=str)
                else:
                    raw_output = str(msg.tool_output)
            elif msg.tool_error:
                raw_output = f"ERROR: {msg.tool_error}"
            else:
                raw_output = ""

            abbreviated_input = _truncate(raw_input, _MAX_TOOL_INPUT_CHARS)
            abbreviated_output = _truncate(raw_output, _MAX_TOOL_OUTPUT_CHARS)

            line = f"TOOL [{tool_name}]: {abbreviated_input}"
            if abbreviated_output:
                line += f" → {abbreviated_output}"
            lines.append(line)

        elif role in ("USER", "ASSISTANT"):
            content = (msg.content or "").strip()
            if content:
                lines.append(f"{role}: {content}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 2. LLM Judge prompt
# ---------------------------------------------------------------------------

_JUDGE_SYSTEM_PROMPT = """\
You are an expert conversation analyst. You will receive the transcript of a \
completed conversation between a user and an AI agent, and optionally the \
conversation goal.

Your job is to:
1. Synthesize a clean, high-level flow — a list of logical steps the agent \
followed. Each step should be a meaningful action (NOT individual tool calls). \
For example, "Search for meeting notes" instead of "call memory_search then \
web_search". Collapse retries and redundant calls into a single step.
2. Write a pattern_summary — a GENERIC one-sentence description of the \
workflow pattern with all entity-specific names stripped. \
Example: "User asks for data export; agent searches, formats, and delivers \
a CSV." NOT "User asks for Q3 sales export from Acme Corp."
3. Assess quality:
   - "success" — the user's goal was fully achieved.
   - "partial" — some progress was made but the goal was not fully achieved.
   - "failure" — the agent attempted but could not achieve the goal.
   - "abandoned" — the conversation was dropped before meaningful progress.
4. If quality is NOT "success": identify which steps failed and provide \
a root_cause explanation.
5. Provide a confidence score (0.0–1.0) for your judgment.

Return ONLY valid JSON matching this schema — no markdown fences, no commentary:
{
  "flow": [
    {"name": "...", "description": "..."},
    ...
  ],
  "pattern_summary": "...",
  "quality": "success|partial|failure|abandoned",
  "failure_steps": ["step name that failed", ...],
  "root_cause": "...",
  "confidence": 0.0
}

If quality is "success", failure_steps should be [] and root_cause should be null.

Examples:

Example 1 — successful conversation:
Transcript:
USER: Can you find our Q3 revenue numbers?
TOOL [search_db]: {"query": "Q3 revenue"} → {"results": [{"revenue": 4200000}]}
ASSISTANT: Your Q3 revenue was $4.2M.

Output:
{
  "flow": [
    {"name": "Receive data request", "description": "User asks for Q3 revenue numbers."},
    {"name": "Search database", "description": "Agent queries internal database for revenue data."},
    {"name": "Deliver results", "description": "Agent presents the revenue figure to the user."}
  ],
  "pattern_summary": "User requests specific data; agent searches an internal source and delivers the result.",
  "quality": "success",
  "failure_steps": [],
  "root_cause": null,
  "confidence": 0.95
}

Example 2 — partial failure:
Transcript:
USER: Draft an email to the team about Friday's meeting and attach the agenda.
TOOL [search_docs]: {"query": "Friday meeting agenda"} → {"results": []}
TOOL [web_search]: {"query": "Friday meeting agenda site:company.com"} → {"results": []}
ASSISTANT: I drafted the email but I couldn't find the meeting agenda to attach. Here's the draft without the attachment...

Output:
{
  "flow": [
    {"name": "Receive drafting request", "description": "User asks for a meeting email with agenda attachment."},
    {"name": "Search for agenda", "description": "Agent searches documents and web for the meeting agenda but finds nothing."},
    {"name": "Draft email", "description": "Agent drafts the email without the attachment."},
    {"name": "Deliver partial result", "description": "Agent presents draft and explains the missing attachment."}
  ],
  "pattern_summary": "User requests a drafted message with an attachment; agent searches for the attachment, fails, and delivers a partial draft.",
  "quality": "partial",
  "failure_steps": ["Search for agenda"],
  "root_cause": "The meeting agenda document could not be found in any searched data source.",
  "confidence": 0.90
}
"""


def _build_user_prompt(transcript: str, goal: str | None) -> str:
    """Build the user-role message for the judge LLM."""
    parts: list[str] = []

    if goal:
        parts.append(f"Conversation goal:\n{goal}")

    parts.append(f"Transcript:\n{transcript}")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# 3. JSON parsing helper
# ---------------------------------------------------------------------------


def _parse_judgment_json(raw_text: str) -> ConversationJudgment | None:
    """Parse the LLM response into a ConversationJudgment.

    Handles bare JSON as well as ```json fenced blocks.
    Returns None if parsing fails.
    """
    text = raw_text.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        first_newline = text.index("\n") if "\n" in text else len(text)
        text = text[first_newline + 1:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Judge LLM returned invalid JSON: %s", text[:300])
        return None

    if not isinstance(data, dict):
        logger.warning("Judge LLM returned non-object JSON")
        return None

    # Validate required fields
    flow_raw = data.get("flow")
    if not isinstance(flow_raw, list) or len(flow_raw) == 0:
        logger.warning("Judge LLM returned no flow steps")
        return None

    flow_steps: list[FlowStep] = []
    for raw_step in flow_raw:
        if not isinstance(raw_step, dict):
            continue
        name = str(raw_step.get("name", "Step"))
        description = str(raw_step.get("description", ""))
        flow_steps.append(FlowStep(name=name, description=description))

    if not flow_steps:
        logger.warning("Judge LLM flow steps were all invalid")
        return None

    quality = str(data.get("quality", "failure")).lower()
    if quality not in ("success", "partial", "failure", "abandoned"):
        quality = "failure"

    pattern_summary = str(data.get("pattern_summary", ""))
    failure_steps = data.get("failure_steps", [])
    if not isinstance(failure_steps, list):
        failure_steps = []
    failure_steps = [str(s) for s in failure_steps]

    root_cause = data.get("root_cause")
    if root_cause is not None:
        root_cause = str(root_cause)
        if root_cause.lower() == "null":
            root_cause = None

    confidence = 0.0
    try:
        confidence = float(data.get("confidence", 0.0))
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.0

    return ConversationJudgment(
        flow=flow_steps,
        pattern_summary=pattern_summary,
        quality=quality,
        failure_steps=failure_steps,
        root_cause=root_cause,
        confidence=confidence,
    )


# ---------------------------------------------------------------------------
# 4. Main judge function
# ---------------------------------------------------------------------------


def _judge_conversation_sync(
    transcript: str,
    goal: str | None,
    user_id: str | None = None,
    tenant_id: str | None = None,
    llm: Any = None,
) -> ConversationJudgment | None:
    """Synchronous inner implementation — calls the LLM and parses the result.

    Args:
        llm: Optional pre-configured LLM instance. If provided, skips
             ``get_default_llms()`` (useful when called from the orchestrator
             which already holds the user's OAuth-authenticated LLM).

    Returns None on any failure.
    """
    from langchain_core.messages import HumanMessage
    from langchain_core.messages import SystemMessage

    from onyx.llm.factory import get_default_llms

    try:
        if llm is None:
            # Fall back to get_default_llms (may fail without user auth)
            user_obj = None
            if user_id and tenant_id:
                try:
                    from uuid import UUID as UUIDType

                    from onyx.db.engine.sql_engine import get_session_with_tenant
                    from onyx.db.models import User

                    with get_session_with_tenant(tenant_id) as db_session:
                        user_obj = db_session.query(User).filter(
                            User.id == UUIDType(user_id)
                        ).first()
                except Exception:
                    logger.debug("Could not load user for judge LLM auth")

            _main_llm, fast_llm = get_default_llms(
                temperature=0.0,
                timeout=30,
                user=user_obj,
            )
            llm = fast_llm
    except Exception:
        logger.warning(
            "Judge could not obtain default LLM", exc_info=True
        )
        return None

    user_prompt = _build_user_prompt(transcript, goal)
    prompt = [
        SystemMessage(content=_JUDGE_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ]

    max_attempts = 2
    last_raw_text = ""

    for attempt in range(1, max_attempts + 1):
        try:
            result = llm.invoke(
                prompt=prompt,
                timeout_override=60,
            )

            raw_text = ""
            if hasattr(result, "content"):
                raw_text = str(result.content).strip()
            else:
                raw_text = str(result).strip()
            last_raw_text = raw_text

            logger.info(
                "Judge LLM response (attempt %d, len=%d, first 300 chars): %s",
                attempt,
                len(raw_text),
                raw_text[:300],
            )

            if not raw_text:
                logger.warning(
                    "Judge LLM returned empty response on attempt %d",
                    attempt,
                )
                continue

            parsed = _parse_judgment_json(raw_text)
            if parsed is not None:
                return parsed

            logger.warning(
                "Failed to parse judge LLM response on attempt %d",
                attempt,
            )
            # Don't retry on parseable-but-invalid; retry only on empty
            break

        except Exception:
            logger.warning(
                "Judge LLM call failed on attempt %d",
                attempt,
                exc_info=True,
            )

    logger.warning(
        "Judge returning None after %d attempts (last response: %s)",
        max_attempts,
        last_raw_text[:200] if last_raw_text else "<empty>",
    )
    return None


async def judge_conversation(
    session_id: str,
    tenant_id: str,
    goal: str | None = None,
    user_id: str | None = None,
    llm: Any = None,
) -> ConversationJudgment | None:
    """Judge a completed conversation and return a quality assessment.

    Loads the full conversation transcript from the DB, sends it to
    an LLM with a structured prompt, and returns a ConversationJudgment
    (flow, pattern_summary, quality, failure details).

    Args:
        session_id: The agent session UUID whose messages to judge.
        tenant_id: Tenant schema for DB access.
        goal: Optional conversation goal (inbox conversations have goals).
        user_id: Optional user UUID for LLM authentication.
        llm: Optional pre-configured LLM instance from the orchestrator.

    Returns:
        A ConversationJudgment on success, or None if the conversation
        has no meaningful content or if the LLM call fails.
    """
    # 1. Load transcript
    try:
        transcript = _load_conversation_transcript(session_id, tenant_id)
    except Exception:
        logger.warning(
            "Judge failed to load transcript for session %s",
            session_id,
            exc_info=True,
        )
        return None

    if not transcript or len(transcript.strip()) < 20:
        logger.info(
            "Judge skipping session %s — no meaningful content",
            session_id,
        )
        return None

    # 2–4. Call LLM in executor to avoid blocking the event loop
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        partial(
            _judge_conversation_sync,
            transcript,
            goal,
            user_id,
            tenant_id,
            llm,
        ),
    )
