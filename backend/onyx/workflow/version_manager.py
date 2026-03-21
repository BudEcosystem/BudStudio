"""Skill version management backed by Neo4j.

Provides version tracking and frontier management for the skill evolution system.
Every mutation creates a new SkillVersion node — versions are never overwritten.
"""

import hashlib
import random
from datetime import datetime
from datetime import timezone
from uuid import uuid4

from onyx.utils.logger import setup_logger
from onyx.workflow.models import SkillVersionNode
from onyx.workflow.neo4j_client import get_neo4j_client

logger = setup_logger()


async def create_version(
    skill_id: str,
    instructions: str,
    source: str = "auto_created",
    source_workflow_id: str = "",
) -> SkillVersionNode:
    """Create a new version of a skill in Neo4j.

    Never overwrites — always creates a new version node.
    Links to the skill via skill_id (references PostgreSQL Skill.id).
    """
    client = await get_neo4j_client()

    # Get current max version for this skill
    result = await client.execute_read(
        "MATCH (sv:SkillVersion {skill_id: $skill_id}) "
        "RETURN max(sv.version) AS max_version",
        {"skill_id": skill_id},
    )
    max_version = (
        result[0]["max_version"]
        if result and result[0]["max_version"] is not None
        else 0
    )

    version = SkillVersionNode(
        id=str(uuid4()),
        skill_id=skill_id,
        version=max_version + 1,
        instructions_hash=hashlib.sha256(instructions.encode()).hexdigest()[:16],
        quality_score=0.0,
        execution_count=0,
        success_rate=0.0,
        created_at=datetime.now(timezone.utc).isoformat(),
        source=source,
        source_workflow_id=source_workflow_id,
    )

    await client.execute_write(
        "CREATE (sv:SkillVersion $props)",
        {"props": version.model_dump()},
    )

    logger.info(
        "Created SkillVersion v%d for skill %s (source=%s)",
        version.version,
        skill_id,
        source,
    )
    return version


async def get_versions(skill_id: str) -> list[SkillVersionNode]:
    """Get all versions of a skill, ordered by version number descending."""
    client = await get_neo4j_client()
    result = await client.execute_read(
        "MATCH (sv:SkillVersion {skill_id: $skill_id}) "
        "RETURN sv ORDER BY sv.version DESC",
        {"skill_id": skill_id},
    )
    return [SkillVersionNode(**record["sv"]) for record in result]


async def get_latest_version(skill_id: str) -> SkillVersionNode | None:
    """Get the latest (highest version number) version of a skill."""
    client = await get_neo4j_client()
    result = await client.execute_read(
        "MATCH (sv:SkillVersion {skill_id: $skill_id}) "
        "RETURN sv ORDER BY sv.version DESC LIMIT 1",
        {"skill_id": skill_id},
    )
    if not result:
        return None
    return SkillVersionNode(**result[0]["sv"])


async def update_version_stats(
    version_id: str,
    quality: str,  # "success" | "partial" | "failure" | "abandoned"
) -> None:
    """Update execution count and success rate for a version after an execution.

    Uses incremental averaging:
        new_rate = (old_rate * old_count + new_score) / (old_count + 1)

    The SET clause reads execution_count *before* the increment so the
    denominator is (old_count + 1).
    """
    client = await get_neo4j_client()
    score = 1.0 if quality == "success" else (0.5 if quality == "partial" else 0.0)

    await client.execute_write(
        "MATCH (sv:SkillVersion {id: $id}) "
        "SET sv.success_rate = "
        "  (sv.success_rate * sv.execution_count + $score) "
        "  / (sv.execution_count + 1), "
        "    sv.quality_score = "
        "  (sv.success_rate * sv.execution_count + $score) "
        "  / (sv.execution_count + 1), "
        "    sv.execution_count = sv.execution_count + 1",
        {"id": version_id, "score": score},
    )

    logger.debug(
        "Updated stats for SkillVersion %s: quality=%s score=%.1f",
        version_id,
        quality,
        score,
    )


async def get_frontier(
    skill_id: str, max_size: int = 3
) -> list[SkillVersionNode]:
    """Get the top-N versions by quality score (the 'frontier').

    Only versions with at least one execution are included.
    Returns results ordered by quality_score descending.
    """
    client = await get_neo4j_client()
    result = await client.execute_read(
        "MATCH (sv:SkillVersion {skill_id: $skill_id}) "
        "WHERE sv.execution_count > 0 "
        "RETURN sv ORDER BY sv.quality_score DESC LIMIT $limit",
        {"skill_id": skill_id, "limit": max_size},
    )
    return [SkillVersionNode(**record["sv"]) for record in result]


async def select_parent(
    skill_id: str,
    strategy: str = "best",
    iteration: int = 0,
) -> SkillVersionNode | None:
    """Select a parent version from the frontier for evolution.

    Strategies:
    - "best":        always pick highest quality_score
    - "random":      uniform random from frontier
    - "round_robin": cycle through frontier by iteration number

    Falls back to the latest version when the frontier is empty
    (i.e. no version has been executed yet).
    """
    frontier = await get_frontier(skill_id)
    if not frontier:
        return await get_latest_version(skill_id)

    if strategy == "best":
        return frontier[0]
    elif strategy == "random":
        return random.choice(frontier)
    elif strategy == "round_robin":
        return frontier[iteration % len(frontier)]
    else:
        return frontier[0]
