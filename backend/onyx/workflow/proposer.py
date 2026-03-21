"""Skill Proposer — diagnoses what skill to create or edit.

Given a set of workflow steps, execution traces, existing skills, and
accumulated feedback history, the Proposer uses an LLM to decide whether
a new skill should be created or an existing one edited, and produces a
structured proposal (ProposerOutput).

Part of the EvoSkill-inspired skill evolution pipeline.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from onyx.utils.logger import setup_logger
from onyx.workflow.models import ProposerOutput

logger = setup_logger()

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_PROPOSER_SYSTEM_PROMPT = """\
You are the Skill Proposer in an autonomous skill-evolution pipeline. Your job \
is to propose a reusable skill that captures an **entire workflow pattern**, not \
a narrow sub-step.

## CRITICAL: Flow = Skill

The skill you propose MUST represent the **complete workflow flow** shown in the \
"Workflow Flow Steps" section. The flow is what the user sees on the canvas. The \
skill is what the agent executes. They must be the same thing.

- The skill name and slug should match the workflow pattern (e.g., "Email Review \
and Summarize", not "ICS Parser").
- The skill description should describe the end-to-end workflow, not a single step.
- The skill instructions should cover ALL flow steps, not just one.

Do NOT propose a skill for a narrow sub-step or specific detail from the \
conversation. Always stay at the workflow level.

## Mandatory Protocol

1. **Check existing skills for overlap.** If an existing skill covers >70% of \
the same workflow pattern, propose an EDIT instead of creating a new one.

2. **If action_hint is "edit"**, focus on what is wrong or incomplete in the \
target skill.

3. **Check feedback history.** If a similar proposal was DISCARDED, reference it \
in `related_iterations` and explain how this differs.

## Anti-Pattern Guardrails

- Do NOT create a skill for a single step or narrow sub-case.
- Do NOT create a skill that overlaps an existing one — propose an edit instead.
- Do NOT focus on specific entity names from the conversation (email subjects, \
people names, etc.) — the skill must be generic and reusable.

## Output

Return valid JSON (optionally wrapped in ```json fences):

{
  "action": "create" | "edit",
  "target_skill": null,
  "proposed_skill": "<description of the FULL workflow skill to build>",
  "justification": "<why, referencing the flow steps>",
  "related_iterations": []
}
"""


def _build_proposer_user_prompt(
    flow_steps: list[dict[str, Any]],
    execution_traces: list[dict[str, Any]],
    existing_skills: list[dict[str, Any]],
    feedback_history: str,
    action_hint: str,
    target_skill_slug: str | None,
    pattern_summary: str | None = None,
) -> str:
    """Assemble the user-role prompt for the proposer LLM."""
    parts: list[str] = []

    # Workflow pattern (from Judge) — this is the canonical description
    if pattern_summary:
        parts.append(f"## Workflow Pattern\n{pattern_summary}")
        parts.append(
            "The skill you propose MUST represent this entire workflow pattern."
        )

    # Action hint
    parts.append(f"\nAction hint: {action_hint}")
    if target_skill_slug:
        parts.append(f"Target skill to edit: {target_skill_slug}")

    # Existing skills
    if existing_skills:
        parts.append("\n## Existing Skills")
        for sk in existing_skills:
            parts.append(
                f"- **{sk.get('slug', '?')}** — {sk.get('name', '?')}: "
                f"{sk.get('description', 'no description')}"
            )
    else:
        parts.append("\n## Existing Skills\nNone.")

    # Clean flow steps
    parts.append("\n## Workflow Flow Steps")
    for i, step in enumerate(flow_steps, 1):
        parts.append(
            f"{i}. {step.get('name', '?')} — {step.get('description', '')}"
        )

    # Execution traces (condensed)
    if execution_traces:
        parts.append("\n## Sample Execution Traces")
        for j, trace in enumerate(execution_traces, 1):
            trace_str = json.dumps(trace, default=str)
            # Truncate individual traces to keep prompt manageable
            if len(trace_str) > 800:
                trace_str = trace_str[:800] + "..."
            parts.append(f"Trace {j}: {trace_str}")

    # Feedback history
    if feedback_history.strip():
        parts.append(f"\n## Feedback History\n{feedback_history}")
    else:
        parts.append("\n## Feedback History\nNo prior proposals.")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Context truncation (progressive fallback)
# ---------------------------------------------------------------------------

_TRUNCATION_LEVELS = {
    0: 800,   # full (800 chars per trace)
    1: 400,   # medium
    2: 150,   # minimal
}


def _truncate_context(
    traces: list[dict[str, Any]], level: int
) -> list[dict[str, Any]]:
    """Return traces truncated to the given level.

    Level 0: full traces (up to 800 chars each)
    Level 1: medium (400 chars each, max 5 traces)
    Level 2: minimal (150 chars each, max 3 traces)
    """
    max_chars = _TRUNCATION_LEVELS.get(level, 150)
    max_count = {0: len(traces), 1: 5, 2: 3}.get(level, 3)

    truncated: list[dict[str, Any]] = []
    for trace in traces[:max_count]:
        t = {}
        for k, v in trace.items():
            s = json.dumps(v, default=str) if not isinstance(v, str) else v
            if len(s) > max_chars:
                s = s[:max_chars] + "..."
            t[k] = s
        truncated.append(t)
    return truncated


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------

def _parse_proposer_json(raw_text: str) -> ProposerOutput | None:
    """Parse LLM response text into a ProposerOutput."""
    text = raw_text.strip()
    # Strip markdown fences
    if text.startswith("```"):
        first_nl = text.index("\n") if "\n" in text else len(text)
        text = text[first_nl + 1:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Proposer LLM returned invalid JSON: %s", text[:300])
        return None

    if not isinstance(data, dict):
        logger.warning("Proposer LLM returned non-object JSON")
        return None

    action = data.get("action", "create")
    if action not in ("create", "edit"):
        action = "create"

    proposed = data.get("proposed_skill", "")
    if not proposed:
        logger.warning("Proposer LLM returned empty proposed_skill")
        return None

    # Handle case where LLM returns proposed_skill as an object
    # (with name, slug, description, instructions) instead of a string
    if isinstance(proposed, dict):
        proposed = json.dumps(proposed)

    return ProposerOutput(
        action=action,
        target_skill=data.get("target_skill"),
        proposed_skill=proposed,
        justification=data.get("justification", ""),
        related_iterations=data.get("related_iterations", []),
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def propose_skill(
    flow_steps: list[dict[str, Any]],
    execution_traces: list[dict[str, Any]],
    existing_skills: list[dict[str, Any]],
    feedback_history: str,
    action_hint: str = "create",
    target_skill_slug: str | None = None,
    user_id: str | None = None,
    tenant_id: str | None = None,
    llm: Any = None,
    pattern_summary: str | None = None,
) -> ProposerOutput | None:
    """Use an LLM to propose a skill creation or edit.

    Implements progressive context fallback: if the LLM call fails,
    retries with increasingly truncated execution traces (3 levels).

    Args:
        flow_steps: Clean flow from the Judge — [{name, description}].
        execution_traces: Sample execution data from Neo4j.
        existing_skills: List of dicts with slug, name, description.
        feedback_history: Accumulated markdown log of past proposals.
        action_hint: "create" or "edit" — suggestion from upstream check.
        target_skill_slug: If editing, which skill slug to target.
        user_id: Optional user UUID for LLM authentication.
        tenant_id: Optional tenant identifier for DB access.
        llm: Optional pre-configured LLM instance from the orchestrator.

    Returns:
        A ProposerOutput on success, or None if all attempts fail.
    """
    from langchain_core.messages import HumanMessage, SystemMessage
    from onyx.llm.factory import get_default_llms

    # Obtain LLM — load User object for Bud Foundry OAuth token
    try:
        if llm is None:
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
                    logger.debug("Could not load user for proposer LLM auth")
            _main_llm, fast_llm = get_default_llms(
                temperature=0.0,
                timeout=30,
                user=user_obj,
            )
            llm = fast_llm
    except Exception:
        logger.error("Could not obtain default LLM for proposer", exc_info=True)
        return None

    # Progressive context fallback: try full → medium → minimal traces
    for level in range(3):
        truncated_traces = _truncate_context(execution_traces, level)

        user_prompt = _build_proposer_user_prompt(
            flow_steps=flow_steps,
            execution_traces=truncated_traces,
            existing_skills=existing_skills,
            feedback_history=feedback_history,
            action_hint=action_hint,
            target_skill_slug=target_skill_slug,
            pattern_summary=pattern_summary,
        )

        prompt = [
            SystemMessage(content=_PROPOSER_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ]

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

            logger.info(
                "Proposer LLM response (level=%d, len=%d): %s",
                level,
                len(raw_text),
                raw_text[:300],
            )

            if not raw_text:
                logger.warning(
                    "Proposer LLM returned empty response at level %d", level
                )
                continue

            parsed = _parse_proposer_json(raw_text)
            if parsed is not None:
                return parsed

            logger.warning(
                "Failed to parse proposer response at level %d", level
            )
            # If we got text but couldn't parse it, don't retry with less
            # context — the issue is the LLM output format, not prompt size
            return None

        except Exception:
            logger.warning(
                "Proposer LLM call failed at truncation level %d",
                level,
                exc_info=True,
            )
            # Continue to next truncation level

    logger.error("Proposer failed after all truncation levels")
    return None
