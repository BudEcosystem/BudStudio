"""Request/response models for the Skill API."""

from pydantic import BaseModel

from onyx.db.models import Skill


class SkillSnapshot(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    instructions: str
    requires_tools: list[str]
    modes: list[str]
    builtin: bool
    enabled: bool
    user_id: str | None = None

    @classmethod
    def from_model(cls, skill: Skill) -> "SkillSnapshot":
        return cls(
            id=skill.id,
            slug=skill.slug,
            name=skill.name,
            description=skill.description,
            instructions=skill.instructions,
            requires_tools=skill.requires_tools or [],
            modes=skill.modes or [],
            builtin=skill.builtin,
            enabled=skill.enabled,
            user_id=str(skill.user_id) if skill.user_id else None,
        )


class SkillCreate(BaseModel):
    slug: str
    name: str
    description: str
    instructions: str
    requires_tools: list[str] = []
    modes: list[str] = []


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    instructions: str | None = None
    requires_tools: list[str] | None = None
    modes: list[str] | None = None
    enabled: bool | None = None
