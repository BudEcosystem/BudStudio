"""LLM-driven turn summarizer for workflow extraction.

Takes raw agent execution data from a single conversation turn (user message,
tool calls, assistant response) and uses a lightweight LLM to produce
human-readable workflow steps.

The summarizer is called after each agent turn to create a TurnSummary
containing a task_name and a list of StepSummary objects.  These summaries
feed into the workflow canvas for visualization and reuse.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from onyx.llm.interfaces import LLM
from onyx.utils.logger import setup_logger
from onyx.workflow.models import StepSummary
from onyx.workflow.models import TurnSummary

logger = setup_logger()

# Maximum characters of a single tool output to include in the LLM prompt.
# Keeps prompt size small for fast/cheap inference.
_MAX_TOOL_OUTPUT_CHARS = 500

# System prompt for the summarizer LLM.
_SUMMARIZER_SYSTEM_PROMPT = """\
You are a workflow graph builder. You will receive the details of one \
conversation turn between a user and an AI agent, including the user's \
request, tool calls the agent made, and the final response.

Your job is to produce a JSON object describing the turn as a workflow \
graph — a set of typed nodes connected by named edges (relationships).

Rules:
1. task_name: 3-6 words, GENERIC human-readable title for the workflow. \
IMPORTANT: strip entity-specific details — use "Get Stock Price" not \
"Get Tesla Stock Price", use "Draft MoM Email" not "Draft Q3 Sync MoM". \
The task_name should be reusable across different inputs.
2. nodes: a list of typed action nodes. Each node has:
   - name: short name describing the action (e.g. "Receive user request").
   - description: one sentence elaborating on the node.
   - canonical_action: a short GENERIC snake_case label. Strip entity names. \
Use "search_data" not "search_tsla_data". Use consistent labels: \
"receive_request", "provide_clarification", "search_data", "fetch_details", \
"ask_clarification", "process_data", "draft_content", "send_message", \
"deliver_result". \
IMPORTANT: "receive_request" is ONLY for the initial user request (pos 0). \
When the user answers a clarifying question, use "provide_clarification" — \
NEVER reuse "receive_request" for clarification answers. Each \
canonical_action should map to a unique node in the workflow graph.
   - node_type: one of "input", "compute", or "output":
     * "input" — data PROVIDED to the workflow from outside. Only two cases: \
(1) A human user sends a request or answers a clarifying question \
(input_source="human"). \
(2) The agent is triggered by an external event like a cron job, inbox \
message, or webhook (input_source="agent"). \
IMPORTANT: Tool calls are NOT input. Web searches, API calls, fetching \
pages, reading files — these are all "compute". The agent is actively \
doing work, not receiving data passively.
     * "compute" — the agent actively doing work. Searching the web, \
calling APIs, fetching pages, reading data, analyzing, formatting, \
drafting, deciding, filtering. ALL tool calls are compute.
     * "output" — result leaving the workflow. Sending email, responding \
to user, creating a draft, publishing.
   - input_source: ONLY for input nodes. "human" (user message, \
clarification answer) or "agent" (external trigger like cron/webhook). \
Omit for compute and output nodes.
   - edge_type: UPPER_SNAKE_CASE relationship type for the edge FROM this \
node TO the next. For the LAST node use "DELIVER_RESULT". \
Examples: "PREPARE_DATA", "CLARIFY_INTENT", "DRAFT_CONTENT", \
"FETCH_DETAILS", "SEND_OUTPUT", "SELECT_SOURCE".
   - edge_goal: short human-readable purpose of the edge.
3. ALWAYS start with an input node (the user's request, node_type="input", \
input_source="human", canonical_action="receive_request"). ALWAYS end with \
an output node (node_type="output"). If the agent asked the user a \
clarifying question (canonical_action="ask_clarification"), and the user \
answered, represent the answer as a SEPARATE node with \
canonical_action="provide_clarification" (node_type="input", \
input_source="human"). This keeps "receive_request" and \
"provide_clarification" as distinct nodes in the graph.
4. Collapse retries into a single node. Focus on WHAT not HOW. \
Do not expose raw tool names.
5. Include people or services when relevant.

Output ONLY valid JSON — no markdown fences, no commentary:
{
  "task_name": "...",
  "nodes": [
    {"name": "...", "description": "...", "canonical_action": "...", \
"node_type": "...", "input_source": "...", "edge_type": "...", \
"edge_goal": "..."},
    ...
  ]
}"""


def _truncate(text: str, max_chars: int) -> str:
    """Truncate text to max_chars, appending ellipsis if truncated."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


def _build_user_prompt(
    user_message: str,
    tool_calls: list[dict[str, Any]],
    assistant_response: str,
    existing_workflow_name: str | None = None,
    existing_canonical_actions: list[str] | None = None,
) -> str:
    """Build the user-role prompt sent to the summarizer LLM."""
    parts: list[str] = []

    parts.append(f"User message:\n{_truncate(user_message, 1000)}")

    if tool_calls:
        parts.append("\nTool calls:")
        for i, tc in enumerate(tool_calls, 1):
            tool_name = tc.get("tool_name", "unknown")
            tool_input = tc.get("tool_input", "")
            tool_output = tc.get("tool_output", "")
            status = tc.get("status", "completed")

            # Serialize dicts/lists to string for truncation
            if isinstance(tool_input, (dict, list)):
                tool_input = json.dumps(tool_input, default=str)
            if isinstance(tool_output, (dict, list)):
                tool_output = json.dumps(tool_output, default=str)

            parts.append(
                f"  {i}. tool={tool_name} status={status}\n"
                f"     input: {_truncate(str(tool_input), _MAX_TOOL_OUTPUT_CHARS)}\n"
                f"     output: {_truncate(str(tool_output), _MAX_TOOL_OUTPUT_CHARS)}"
            )
    else:
        parts.append("\nNo tool calls were made.")

    parts.append(
        f"\nAssistant response:\n{_truncate(assistant_response, 1000)}"
    )

    if existing_workflow_name:
        parts.append(
            f'\nIMPORTANT: Use "{existing_workflow_name}" as the task_name '
            f"(do not generate a new one)."
        )

    if existing_canonical_actions:
        actions_str = ", ".join(existing_canonical_actions)
        parts.append(
            f"\nIMPORTANT: This workflow already has these canonical_action "
            f"nodes: [{actions_str}]. REUSE these exact canonical_action "
            f"labels where the action is the same or similar. Only create "
            f"a new canonical_action if the action is genuinely different "
            f"from all existing ones."
        )

    return "\n".join(parts)


def _derive_task_name(user_message: str) -> str:
    """Derive a short, generic task name from the user message.

    Strips entity-specific details and caps at 6 words.  Used as fallback
    when the summarizer LLM fails.
    """
    # Take first sentence or first 60 chars
    msg = user_message.strip()
    # Cut at first sentence boundary
    for sep in (".", "?", "!", "\n"):
        idx = msg.find(sep)
        if 0 < idx < 80:
            msg = msg[:idx]
            break
    # Cap length
    words = msg.split()[:6]
    if not words:
        return "Agent Task"
    name = " ".join(words)
    # Capitalize first letter
    name = name[0].upper() + name[1:] if len(name) > 1 else name.upper()
    return name


def _build_default_summary(
    user_message: str,
    tool_calls: list[dict[str, Any]],
    existing_workflow_name: str | None = None,
) -> TurnSummary:
    """Build a reasonable fallback summary without an LLM call.

    Used when the LLM returns invalid JSON or when an error occurs.
    """
    task_name = existing_workflow_name or _derive_task_name(user_message)

    if not tool_calls:
        return TurnSummary(
            task_name=task_name,
            steps=[
                StepSummary(
                    name="Receive user request",
                    description=_truncate(user_message, 100),
                    canonical_action="receive_request",
                    node_type="input",
                    input_source="human",
                    edge_type="DELIVER_RESULT",
                    transition_goal="Deliver result to user",
                ),
                StepSummary(
                    name="Respond to user",
                    description="Generated final response",
                    canonical_action="deliver_result",
                    node_type="output",
                ),
            ],
        )

    steps: list[StepSummary] = []

    # Start with input node
    steps.append(
        StepSummary(
            name="Receive user request",
            description=_truncate(user_message, 100),
            canonical_action="receive_request",
            node_type="input",
            input_source="human",
            edge_type="PROCESS_REQUEST",
            transition_goal="Process the user request",
        ),
    )

    seen_tools: set[str] = set()
    for i, tc in enumerate(tool_calls):
        tool_name = tc.get("tool_name", "unknown")
        if tool_name in seen_tools:
            continue
        seen_tools.add(tool_name)

        # Sanitize tool name: strip provider prefixes, convert to snake_case
        short_name = tool_name.split("__")[-1] if "__" in tool_name else tool_name
        canonical = short_name.replace("-", "_").replace(" ", "_").lower()
        human_name = short_name.replace("_", " ").replace("-", " ").title()
        status = tc.get("status", "completed")
        status_note = "" if status == "completed" else f" ({status})"

        steps.append(
            StepSummary(
                name=f"{human_name}{status_note}",
                description=f"Execute {human_name.lower()}",
                canonical_action=canonical,
                node_type="compute",
                edge_type="PROCESS_DATA",
                transition_goal=f"Process data from {human_name.lower()}",
            ),
        )

    # Fix last compute step's edge to point to output
    if len(steps) > 1:
        steps[-1] = steps[-1].model_copy(update={
            "edge_type": "SEND_OUTPUT",
            "transition_goal": "Send output to user",
        })

    # End with output node
    steps.append(
        StepSummary(
            name="Deliver result",
            description="Generated final response",
            canonical_action="deliver_result",
            node_type="output",
            edge_type="DELIVER_RESULT",
            transition_goal="Deliver result to user",
        ),
    )

    # Limit to 5 steps
    if len(steps) > 5:
        steps = steps[:4] + [steps[-1]]

    return TurnSummary(task_name=task_name, steps=steps)


def _parse_summary_json(
    raw_text: str,
    existing_workflow_name: str | None = None,
) -> TurnSummary | None:
    """Parse the LLM response text into a TurnSummary.

    Returns None if parsing fails.
    """
    # Strip markdown code fences if present
    text = raw_text.strip()
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        first_newline = text.index("\n") if "\n" in text else len(text)
        text = text[first_newline + 1 :]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning(
            "Summarizer LLM returned invalid JSON: %s",
            text[:200],
        )
        return None

    if not isinstance(data, dict):
        logger.warning("Summarizer LLM returned non-object JSON")
        return None

    task_name = data.get("task_name", "")
    if existing_workflow_name:
        task_name = existing_workflow_name
    if not task_name:
        task_name = "Agent Task"

    # Accept "nodes" (new graph terminology) or "steps" (legacy) from LLM
    raw_nodes = data.get("nodes", data.get("steps", []))
    if not isinstance(raw_nodes, list) or len(raw_nodes) == 0:
        logger.warning("Summarizer LLM returned no nodes")
        return None

    steps: list[StepSummary] = []
    for raw_node in raw_nodes[:5]:  # Cap at 5
        if not isinstance(raw_node, dict):
            continue
        name = str(raw_node.get("name", "Step"))
        description = str(raw_node.get("description", ""))
        canonical_action = str(
            raw_node.get("canonical_action", "unknown_action")
        )
        # Node type classification
        node_type = str(raw_node.get("node_type", "compute")).lower()
        if node_type not in ("input", "compute", "output"):
            node_type = "compute"
        input_source: str | None = None
        if node_type == "input":
            input_source = str(raw_node.get("input_source", "agent")).lower()
            if input_source not in ("human", "agent"):
                input_source = "agent"
        # Edge properties
        transition_goal = str(
            raw_node.get("edge_goal", raw_node.get("transition_goal", ""))
        )
        edge_type = str(
            raw_node.get("edge_type", "NEXT")
        ).upper().replace(" ", "_")
        steps.append(
            StepSummary(
                name=name,
                description=description,
                canonical_action=canonical_action,
                node_type=node_type,
                input_source=input_source,
                transition_goal=transition_goal,
                edge_type=edge_type,
            )
        )

    if not steps:
        return None

    return TurnSummary(task_name=task_name, steps=steps)


def summarize_turn_sync(
    llm: LLM,
    user_message: str,
    tool_calls: list[dict[str, Any]],
    assistant_response: str,
    existing_workflow_name: str | None = None,
    existing_canonical_actions: list[str] | None = None,
) -> TurnSummary:
    """Synchronously summarize one agent turn into human-readable steps.

    Uses the provided LLM instance (should be a fast/cheap model) to
    produce a TurnSummary.  Falls back to a heuristic summary if the LLM
    call fails or returns unparseable output.

    Args:
        llm: An LLM instance (typically the fast default model).
        user_message: The user's input message for this turn.
        tool_calls: List of dicts with keys: tool_name, tool_input,
                    tool_output, status.
        assistant_response: The agent's final text response.
        existing_workflow_name: If provided, use this as the task_name
                                instead of generating one.

    Returns:
        A TurnSummary with task_name and list of StepSummary objects.
    """
    from langchain_core.messages import HumanMessage
    from langchain_core.messages import SystemMessage

    # For trivial turns (no tools, short response), skip the LLM call
    if not tool_calls and len(assistant_response) < 200:
        logger.debug("Skipping LLM summarizer for trivial turn")
        return _build_default_summary(
            user_message, tool_calls, existing_workflow_name
        )

    user_prompt = _build_user_prompt(
        user_message=user_message,
        tool_calls=tool_calls,
        assistant_response=assistant_response,
        existing_workflow_name=existing_workflow_name,
        existing_canonical_actions=existing_canonical_actions,
    )

    prompt = [
        SystemMessage(content=_SUMMARIZER_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ]

    max_attempts = 2
    last_raw_text = ""
    for attempt in range(1, max_attempts + 1):
        try:
            result = llm.invoke(
                prompt=prompt,
                timeout_override=30,
                max_tokens=512,
            )

            raw_text = ""
            if hasattr(result, "content"):
                raw_text = str(result.content).strip()
            else:
                raw_text = str(result).strip()
            last_raw_text = raw_text

            logger.info(
                "Summarizer LLM response (attempt %d, len=%d, first 300 chars): %s",
                attempt,
                len(raw_text),
                raw_text[:300],
            )

            if not raw_text:
                logger.warning(
                    "Summarizer LLM returned empty response on attempt %d",
                    attempt,
                )
                continue

            parsed = _parse_summary_json(raw_text, existing_workflow_name)
            if parsed is not None:
                return parsed

            logger.warning(
                "Failed to parse summarizer LLM response on attempt %d",
                attempt,
            )
            # Don't retry if we got non-empty but unparseable JSON
            break

        except Exception:
            logger.warning(
                "Summarizer LLM call failed on attempt %d",
                attempt,
                exc_info=True,
            )

    logger.warning(
        "Summarizer using fallback after %d attempts (last response: %s)",
        max_attempts,
        last_raw_text[:200] if last_raw_text else "<empty>",
    )
    return _build_default_summary(
        user_message, tool_calls, existing_workflow_name
    )


async def summarize_turn(
    user_message: str,
    tool_calls: list[dict[str, Any]],
    assistant_response: str,
    llm: LLM | None = None,
    existing_workflow_name: str | None = None,
) -> TurnSummary:
    """Asynchronously summarize one agent turn into human-readable steps.

    This is the primary entry point.  It wraps the synchronous LLM call
    in an executor to avoid blocking the event loop.

    If no LLM instance is provided, it fetches the default fast model
    from the configured LLM provider.

    Args:
        user_message: The user's input message for this turn.
        tool_calls: List of dicts with keys: tool_name, tool_input,
                    tool_output, status.
        assistant_response: The agent's final text response.
        llm: Optional LLM instance.  If None, the default fast model
             is used.
        existing_workflow_name: If provided, use this as the task_name
                                instead of generating one.

    Returns:
        A TurnSummary with task_name and list of StepSummary objects.
    """
    if llm is None:
        try:
            from onyx.llm.factory import get_default_llms

            _main_llm, fast_llm = get_default_llms(
                temperature=0.0,
                timeout=15,
            )
            llm = fast_llm
        except Exception:
            logger.warning(
                "Could not obtain default LLM for summarizer, "
                "using fallback summary",
                exc_info=True,
            )
            return _build_default_summary(
                user_message, tool_calls, existing_workflow_name
            )

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        summarize_turn_sync,
        llm,
        user_message,
        tool_calls,
        assistant_response,
        existing_workflow_name,
    )
