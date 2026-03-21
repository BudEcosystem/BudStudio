"""Skill Generator — turns a Proposer diagnosis into actual skill content.

Receives a ProposerOutput (as dict) describing what skill to create or edit,
along with the clean flow steps and optionally the current skill instructions
(for edits), and uses an LLM to generate the full skill markdown body.

Part of the EvoSkill-inspired skill evolution pipeline.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from onyx.utils.logger import setup_logger
from onyx.workflow.models import GeneratorOutput

logger = setup_logger()

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_GENERATOR_SYSTEM_PROMPT = """\
You are the Skill Generator in an autonomous skill-evolution pipeline. You \
receive a proposal and a workflow flow, and you produce the actual skill content.

## CRITICAL: The skill represents the ENTIRE workflow flow

The skill slug, name, and description must match the **overall workflow pattern**, \
not a narrow sub-step. The flow steps are what the user sees on their canvas. \
The skill instructions teach the agent how to execute that same flow.

## Instructions

1. **Mirror the flow steps exactly.** Each flow step maps to a numbered \
instruction. The skill instructions should cover the COMPLETE flow from start \
to finish.

2. **The slug and name must describe the overall workflow**, not a detail. \
For example, if the flow is "search emails → open specific one → summarize", \
the slug should be "email-review-and-summarize", NOT "ics-parser" or \
"inbox-search".

3. **Keep instructions actionable.** Use imperative mood ("Search for...", \
"Open the...", "Summarize the...").

4. **For "edit" actions:** Preserve existing content that is still relevant.

5. **The slug must be kebab-case** (2-5 words). The name must be Title Case \
(2-6 words). The description must be one sentence about the overall workflow.

## Output

Return valid JSON (optionally wrapped in ```json fences) matching this schema:

```json
{
  "slug": "kebab-case-slug",
  "name": "Human Readable Name",
  "description": "One-sentence description of the skill.",
  "instructions": "# Skill Title\\n\\n1. Step one — do X\\n2. Step two — do Y\\n..."
}
```

The `instructions` value must be a single JSON string with \\n for newlines. Keep it 5-15 steps. Be specific and actionable.
"""


def _build_generator_user_prompt(
    proposal: dict[str, Any],
    flow_steps: list[dict[str, Any]],
    existing_instructions: str | None,
) -> str:
    """Assemble the user-role prompt for the generator LLM."""
    parts: list[str] = []

    # Proposal details
    action = proposal.get("action", "create")
    parts.append(f"Action: {action}")
    if proposal.get("target_skill"):
        parts.append(f"Target skill: {proposal['target_skill']}")
    parts.append(f"Proposal: {proposal.get('proposed_skill', '')}")
    parts.append(f"Justification: {proposal.get('justification', '')}")

    # Flow steps
    parts.append("\n## Workflow Flow Steps")
    for i, step in enumerate(flow_steps, 1):
        parts.append(
            f"{i}. **{step.get('name', '?')}** — {step.get('description', '')}"
        )

    # Existing instructions (for edits)
    if existing_instructions and action == "edit":
        parts.append("\n## Current Skill Instructions")
        # Truncate if very long to keep prompt manageable
        if len(existing_instructions) > 3000:
            parts.append(existing_instructions[:3000] + "\n... (truncated)")
        else:
            parts.append(existing_instructions)

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------

def _parse_generator_json(raw_text: str) -> GeneratorOutput | None:
    """Parse LLM response text into a GeneratorOutput."""
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
        logger.warning("Generator LLM returned invalid JSON: %s", text[:300])
        return None

    if not isinstance(data, dict):
        logger.warning("Generator LLM returned non-object JSON")
        return None

    slug = data.get("slug", "")
    name = data.get("name", "")
    instructions = data.get("instructions", "")

    if not slug or not name or not instructions:
        logger.warning(
            "Generator LLM returned incomplete output: slug=%s name=%s "
            "instructions_len=%d",
            slug,
            name,
            len(instructions),
        )
        return None

    return GeneratorOutput(
        slug=slug,
        name=name,
        description=data.get("description", ""),
        instructions=instructions,
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def generate_skill(
    proposal: dict[str, Any],
    flow_steps: list[dict[str, Any]],
    existing_instructions: str | None = None,
    user_id: str | None = None,
    tenant_id: str | None = None,
    llm: Any = None,
) -> GeneratorOutput | None:
    """Use an LLM to generate skill content from a proposal.

    Args:
        proposal: ProposerOutput as dict — must contain action,
                  proposed_skill, justification.
        flow_steps: The clean flow from the Judge — [{name, description}].
        existing_instructions: Current skill instructions if editing.
        user_id: Optional user UUID for LLM authentication.
        tenant_id: Optional tenant identifier for DB access.
        llm: Optional pre-configured LLM instance from the orchestrator.

    Returns:
        A GeneratorOutput on success, or None if the LLM call fails.
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
                    logger.debug("Could not load user for generator LLM auth")
            _main_llm, fast_llm = get_default_llms(
                temperature=0.0,
                timeout=30,
                user=user_obj,
            )
            llm = fast_llm
    except Exception:
        logger.error(
            "Could not obtain default LLM for skill generator", exc_info=True
        )
        return None

    user_prompt = _build_generator_user_prompt(
        proposal=proposal,
        flow_steps=flow_steps,
        existing_instructions=existing_instructions,
    )

    prompt = [
        SystemMessage(content=_GENERATOR_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ]

    max_attempts = 2
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

            logger.info(
                "Generator LLM response (attempt=%d, len=%d): %s",
                attempt,
                len(raw_text),
                raw_text[:300],
            )

            if not raw_text:
                logger.warning(
                    "Generator LLM returned empty response on attempt %d",
                    attempt,
                )
                continue

            parsed = _parse_generator_json(raw_text)
            if parsed is not None:
                return parsed

            logger.warning(
                "Failed to parse generator response on attempt %d", attempt
            )
            # Don't retry if we got text but couldn't parse — format issue
            return None

        except Exception:
            logger.warning(
                "Generator LLM call failed on attempt %d",
                attempt,
                exc_info=True,
            )

    logger.error("Generator failed after %d attempts", max_attempts)
    return None
