"""Skill loader and registry for BudAgent.

Skills are reusable instruction packages stored as `.md` files with YAML
frontmatter.  They teach the agent *how* to accomplish specific tasks using
existing tools (bash, web_search, etc.) without requiring new tool code.

Built-in skills ship with the codebase in this directory.  Admin-created
skills live in the ``skill`` database table and can override built-in ones
by matching the same ``slug``.
"""

import functools
from dataclasses import dataclass
from dataclasses import field
from importlib import resources
from typing import Any

import yaml
from sqlalchemy.orm import Session

from onyx.utils.logger import setup_logger

logger = setup_logger()


@dataclass(frozen=True)
class SkillDefinition:
    """Parsed representation of a single skill."""

    slug: str
    name: str
    description: str
    instructions: str
    requires_tools: list[str] = field(default_factory=list)
    modes: list[str] = field(default_factory=list)  # empty = all modes
    enabled: bool = True


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_FRONTMATTER_DELIMITER = "---"


def parse_skill_md(content: str) -> SkillDefinition | None:
    """Parse a SKILL.md-style file with YAML frontmatter + markdown body.

    Returns ``None`` if the file is malformed or missing required fields.
    """
    content = content.strip()
    if not content.startswith(_FRONTMATTER_DELIMITER):
        logger.warning("Skill file does not start with YAML frontmatter delimiter")
        return None

    # Split on the second '---'
    rest = content[len(_FRONTMATTER_DELIMITER) :]
    end_idx = rest.find(_FRONTMATTER_DELIMITER)
    if end_idx == -1:
        logger.warning("Skill file missing closing YAML frontmatter delimiter")
        return None

    yaml_block = rest[:end_idx].strip()
    body = rest[end_idx + len(_FRONTMATTER_DELIMITER) :].strip()

    try:
        meta: dict[str, Any] = yaml.safe_load(yaml_block) or {}
    except yaml.YAMLError as e:
        logger.warning("Failed to parse YAML frontmatter: %s", e)
        return None

    slug = meta.get("slug")
    name = meta.get("name")
    description = meta.get("description")
    if not slug or not name or not description:
        logger.warning(
            "Skill file missing required fields (slug, name, description): got %s",
            meta,
        )
        return None

    if not body:
        logger.warning("Skill '%s' has no instruction body", slug)
        return None

    requires_tools = meta.get("requires_tools", [])
    if isinstance(requires_tools, str):
        requires_tools = [requires_tools]

    modes = meta.get("modes", [])
    if isinstance(modes, str):
        modes = [modes]

    return SkillDefinition(
        slug=str(slug),
        name=str(name),
        description=str(description),
        instructions=body,
        requires_tools=requires_tools,
        modes=modes,
        enabled=meta.get("enabled", True),
    )


# ---------------------------------------------------------------------------
# Built-in skill loading
# ---------------------------------------------------------------------------


@functools.lru_cache(maxsize=1)
def load_builtin_skills() -> dict[str, SkillDefinition]:
    """Scan this package directory for ``*.md`` files and parse each as a skill.

    Results are cached for the lifetime of the process.
    """
    skills: dict[str, SkillDefinition] = {}
    package = resources.files(__package__)

    for item in package.iterdir():
        if not hasattr(item, "name") or not item.name.endswith(".md"):
            continue

        try:
            content = item.read_text(encoding="utf-8")
        except Exception:
            logger.warning("Failed to read skill file %s", item.name, exc_info=True)
            continue

        skill = parse_skill_md(content)
        if skill is None:
            continue

        if skill.slug in skills:
            logger.warning(
                "Duplicate built-in skill slug '%s' from file '%s' — overwriting",
                skill.slug,
                item.name,
            )
        skills[skill.slug] = skill

    logger.info("Loaded %d built-in skill(s): %s", len(skills), list(skills.keys()))
    return skills


# ---------------------------------------------------------------------------
# Active skill resolution (built-in + DB merge)
# ---------------------------------------------------------------------------


def get_active_skills(
    db_session: Session | None,
    available_tools: set[str],
    mode: str,
) -> list[SkillDefinition]:
    """Return the list of skills that should be available in the current context.

    Merge logic:
    1. Start with built-in skills.
    2. Load DB skills; DB skills with matching slug override built-in ones.
    3. Filter out disabled skills.
    4. Filter out skills whose ``requires_tools`` are not all in ``available_tools``.
    5. Filter out skills whose ``modes`` don't include the current ``mode``
       (empty modes list means "all modes").
    """
    # Start with built-in
    merged: dict[str, SkillDefinition] = dict(load_builtin_skills())

    # Overlay DB skills
    if db_session is not None:
        try:
            from onyx.db.skills import get_skills

            db_skills = get_skills(db_session, only_enabled=False)
            for db_skill in db_skills:
                merged[db_skill.slug] = SkillDefinition(
                    slug=db_skill.slug,
                    name=db_skill.name,
                    description=db_skill.description,
                    instructions=db_skill.instructions,
                    requires_tools=db_skill.requires_tools or [],
                    modes=db_skill.modes or [],
                    enabled=db_skill.enabled,
                )
        except Exception:
            logger.warning(
                "Failed to load DB skills — using built-in only", exc_info=True
            )

    # Filter
    active: list[SkillDefinition] = []
    for skill in merged.values():
        if not skill.enabled:
            continue
        if skill.requires_tools and not set(skill.requires_tools).issubset(
            available_tools
        ):
            continue
        if skill.modes and mode not in skill.modes:
            continue
        active.append(skill)

    return active


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------


def format_skill_catalog(skills: list[SkillDefinition]) -> str:
    """Build a compact skill catalog for injection into the system prompt.

    Returns an empty string if there are no active skills.
    """
    if not skills:
        return ""

    lines = [
        "## Available Skills",
        "Use `use_skill` to activate a skill when it matches the user's request.",
        "",
    ]
    for skill in skills:
        lines.append(f"- **{skill.slug}**: {skill.description}")

    return "\n".join(lines)
