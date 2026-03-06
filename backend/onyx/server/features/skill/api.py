"""CRUD API endpoints for skills."""

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.skills import load_builtin_skills
from onyx.auth.users import current_admin_user
from onyx.auth.users import current_user
from onyx.db.engine.sql_engine import get_session
from onyx.db.models import User
from onyx.db.skills import create_skill__no_commit
from onyx.db.skills import delete_skill__no_commit
from onyx.db.skills import get_skill_by_id
from onyx.db.skills import get_skill_by_slug
from onyx.db.skills import get_skills
from onyx.db.skills import update_skill
from onyx.server.features.skill.models import SkillCreate
from onyx.server.features.skill.models import SkillSnapshot
from onyx.server.features.skill.models import SkillUpdate

admin_router = APIRouter(prefix="/admin/skill")
router = APIRouter(prefix="/skill")


# ---------------------------------------------------------------------------
# Read-only endpoints (any authenticated user)
# ---------------------------------------------------------------------------


@router.get("")
def list_skills(
    db_session: Session = Depends(get_session),
    _: User | None = Depends(current_user),
) -> list[SkillSnapshot]:
    # Start with built-in .md skills
    builtin_defs = load_builtin_skills()
    merged: dict[str, SkillSnapshot] = {}
    for defn in builtin_defs.values():
        merged[defn.slug] = SkillSnapshot(
            id=-1,
            slug=defn.slug,
            name=defn.name,
            description=defn.description,
            instructions=defn.instructions,
            requires_tools=defn.requires_tools,
            modes=defn.modes,
            builtin=True,
            enabled=defn.enabled,
            user_id=None,
        )

    # Overlay DB skills (override built-in by slug)
    db_skills = get_skills(db_session, only_enabled=False)
    for s in db_skills:
        merged[s.slug] = SkillSnapshot.from_model(s)

    return list(merged.values())


@router.get("/{skill_id}")
def get_skill(
    skill_id: int,
    db_session: Session = Depends(get_session),
    _: User | None = Depends(current_user),
) -> SkillSnapshot:
    try:
        skill = get_skill_by_id(skill_id, db_session)
    except ValueError:
        raise HTTPException(status_code=404, detail="Skill not found")
    return SkillSnapshot.from_model(skill)


# ---------------------------------------------------------------------------
# Admin write endpoints
# ---------------------------------------------------------------------------


@admin_router.post("")
def create_skill(
    skill_data: SkillCreate,
    db_session: Session = Depends(get_session),
    user: User | None = Depends(current_admin_user),
) -> SkillSnapshot:
    # Validate slug format
    if not skill_data.slug or not skill_data.slug.strip():
        raise HTTPException(status_code=400, detail="Slug cannot be empty")

    # Check for slug uniqueness
    existing = get_skill_by_slug(skill_data.slug, db_session)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Skill with slug '{skill_data.slug}' already exists",
        )

    skill = create_skill__no_commit(
        slug=skill_data.slug,
        name=skill_data.name,
        description=skill_data.description,
        instructions=skill_data.instructions,
        requires_tools=skill_data.requires_tools,
        modes=skill_data.modes,
        builtin=False,
        enabled=True,
        user_id=user.id if user else None,
        db_session=db_session,
    )
    db_session.commit()
    return SkillSnapshot.from_model(skill)


@admin_router.put("/{skill_id}")
def update_skill_endpoint(
    skill_id: int,
    skill_data: SkillUpdate,
    db_session: Session = Depends(get_session),
    _: User | None = Depends(current_admin_user),
) -> SkillSnapshot:
    try:
        skill = update_skill(
            skill_id=skill_id,
            db_session=db_session,
            name=skill_data.name,
            description=skill_data.description,
            instructions=skill_data.instructions,
            requires_tools=skill_data.requires_tools,
            modes=skill_data.modes,
            enabled=skill_data.enabled,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Skill not found")
    return SkillSnapshot.from_model(skill)


@admin_router.delete("/{skill_id}")
def delete_skill(
    skill_id: int,
    db_session: Session = Depends(get_session),
    _: User | None = Depends(current_admin_user),
) -> None:
    try:
        existing = get_skill_by_id(skill_id, db_session)
    except ValueError:
        raise HTTPException(status_code=404, detail="Skill not found")

    if existing.builtin:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a built-in skill. Disable it instead.",
        )

    delete_skill__no_commit(skill_id, db_session)
    db_session.commit()
