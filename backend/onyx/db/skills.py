"""Database operations for the Skill table."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from onyx.db.models import Skill


def get_skills(
    db_session: Session,
    only_enabled: bool = True,
) -> list[Skill]:
    """Return all skills, optionally filtering to enabled-only."""
    stmt = select(Skill)
    if only_enabled:
        stmt = stmt.where(Skill.enabled.is_(True))
    stmt = stmt.order_by(Skill.slug)
    return list(db_session.scalars(stmt).all())


def get_skill_by_id(
    skill_id: int,
    db_session: Session,
) -> Skill:
    """Return a skill by ID. Raises if not found."""
    skill = db_session.get(Skill, skill_id)
    if skill is None:
        raise ValueError(f"Skill with id={skill_id} not found")
    return skill


def get_skill_by_slug(
    slug: str,
    db_session: Session,
) -> Skill | None:
    """Return a skill by slug, or None if not found."""
    stmt = select(Skill).where(Skill.slug == slug)
    return db_session.scalars(stmt).first()


def create_skill__no_commit(
    slug: str,
    name: str,
    description: str,
    instructions: str,
    db_session: Session,
    requires_tools: list[str] | None = None,
    modes: list[str] | None = None,
    builtin: bool = False,
    enabled: bool = True,
    user_id: UUID | None = None,
) -> Skill:
    """Create a new skill. Flushes but does NOT commit."""
    skill = Skill(
        slug=slug,
        name=name,
        description=description,
        instructions=instructions,
        requires_tools=requires_tools or [],
        modes=modes or [],
        builtin=builtin,
        enabled=enabled,
        user_id=user_id,
    )
    db_session.add(skill)
    db_session.flush()
    return skill


def update_skill(
    skill_id: int,
    db_session: Session,
    name: str | None = None,
    description: str | None = None,
    instructions: str | None = None,
    requires_tools: list[str] | None = None,
    modes: list[str] | None = None,
    enabled: bool | None = None,
) -> Skill:
    """Update an existing skill. Commits the changes."""
    skill = get_skill_by_id(skill_id, db_session)

    if name is not None:
        skill.name = name
    if description is not None:
        skill.description = description
    if instructions is not None:
        skill.instructions = instructions
    if requires_tools is not None:
        skill.requires_tools = requires_tools
    if modes is not None:
        skill.modes = modes
    if enabled is not None:
        skill.enabled = enabled

    db_session.commit()
    return skill


def delete_skill__no_commit(
    skill_id: int,
    db_session: Session,
) -> None:
    """Delete a skill. Flushes but does NOT commit."""
    skill = get_skill_by_id(skill_id, db_session)
    db_session.delete(skill)
    db_session.flush()
