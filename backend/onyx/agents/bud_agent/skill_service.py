"""Skill service for BudAgent — provides the ``use_skill`` FunctionTool.

The agent's system prompt includes a compact catalog of available skills
(name + description).  When the agent decides a skill is relevant, it calls
``use_skill`` to retrieve the full instructions, then follows them using
its existing tools.
"""

import json
from typing import Any

from sqlalchemy.orm import Session

from onyx.agents.bud_agent.skills import (
    SkillDefinition,
    format_skill_catalog,
    get_active_skills,
)
from onyx.utils.logger import setup_logger

logger = setup_logger()


def create_skill_tools(
    db_session: Session | None,
    available_tools: set[str],
    mode: str,
) -> tuple[list[Any], str]:
    """Create the ``use_skill`` FunctionTool and return the skill catalog text.

    Args:
        db_session: Database session for loading DB skills.
        available_tools: Set of tool names available in this context.
        mode: Current agent mode (interactive, inbox, cron).

    Returns:
        ``(tools, catalog_text)`` — a list containing the ``use_skill``
        FunctionTool (empty if no skills are active), and the catalog
        string for injection into the system prompt.
    """
    from agents import FunctionTool, RunContextWrapper

    active_skills = get_active_skills(db_session, available_tools, mode)

    if not active_skills:
        return [], ""

    # Build lookup dict for the handler
    skill_map: dict[str, SkillDefinition] = {s.slug: s for s in active_skills}
    catalog_text = format_skill_catalog(active_skills)

    async def _handle_use_skill(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            skill_slug: str = args.get("skill_slug", "").strip()

            if not skill_slug:
                return "Error: skill_slug is required."

            skill = skill_map.get(skill_slug)
            if skill is None:
                available = ", ".join(sorted(skill_map.keys()))
                return (
                    f"Error: Skill '{skill_slug}' not found. "
                    f"Available skills: {available}"
                )

            logger.info("Agent activated skill: %s", skill_slug)
            return (
                f"# Skill: {skill.name}\n\n"
                f"{skill.instructions}\n\n"
                f"---\n"
                f"Now follow the instructions above using your available tools."
            )

        except json.JSONDecodeError as e:
            return f"Error: Invalid JSON argument: {e}"
        except Exception as e:
            logger.exception("use_skill handler failed")
            return f"Error activating skill: {e}"

    tool = FunctionTool(
        name="use_skill",
        description=(
            "Activate a skill to get detailed step-by-step instructions for "
            "a specific task. Call this when a user's request matches one of "
            "the available skills listed in your system prompt. The skill "
            "will return instructions that you should then follow using your "
            "existing tools."
        ),
        params_json_schema={
            "type": "object",
            "properties": {
                "skill_slug": {
                    "type": "string",
                    "description": (
                        "The slug of the skill to activate "
                        "(from the Available Skills list in your system prompt)."
                    ),
                },
            },
            "required": ["skill_slug"],
        },
        on_invoke_tool=_handle_use_skill,
    )

    return [tool], catalog_text
