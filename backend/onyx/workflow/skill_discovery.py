"""Proactive Skill Discovery.

At agent runtime, when a user sends a message:
1. Embed the user's message
2. Compare against all skill description embeddings
3. If similarity > threshold, return the skill as a suggestion

The suggestion is injected into the agent's system prompt so it knows
a relevant skill exists without the user explicitly requesting it.
"""

from functools import lru_cache

import numpy as np

from onyx.utils.logger import setup_logger

logger = setup_logger()

_SUGGESTION_THRESHOLD = 0.65  # Lower than workflow matching (0.75) to cast wider net


# ---------------------------------------------------------------------------
# Cached skill embeddings
# ---------------------------------------------------------------------------


@lru_cache(maxsize=100)
def _cached_skill_embedding(skill_text: str) -> tuple[float, ...] | None:
    """Cache skill embeddings since they rarely change.

    Returns a tuple (hashable for LRU cache) or None on failure.
    """
    try:
        from onyx.workflow.matcher import _embed_text_sync

        embedding = _embed_text_sync(skill_text)
        return tuple(embedding) if embedding else None
    except Exception:
        logger.warning("Failed to embed skill text for cache", exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Core discovery
# ---------------------------------------------------------------------------


def _cosine_similarity(a: list[float] | tuple[float, ...], b: list[float] | tuple[float, ...]) -> float:
    """Compute cosine similarity between two vectors."""
    a_arr = np.array(a, dtype=np.float64)
    b_arr = np.array(b, dtype=np.float64)
    dot = float(np.dot(a_arr, b_arr))
    norm = float(np.linalg.norm(a_arr) * np.linalg.norm(b_arr))
    if norm < 1e-10:
        return 0.0
    return dot / norm


def discover_relevant_skills(
    user_message: str,
    active_skills: list,  # list of SkillDefinition objects
    max_suggestions: int = 3,
) -> list[dict[str, object]]:
    """Find skills relevant to the user's message.

    Args:
        user_message: The user's latest message text
        active_skills: All currently active skills
        max_suggestions: Maximum number of skills to suggest

    Returns:
        List of {slug, name, description, similarity} dicts, sorted by
        similarity descending.
    """
    if not user_message or not active_skills:
        return []

    try:
        from onyx.workflow.matcher import _embed_text_sync

        # Embed the user message (not cached -- changes every turn)
        message_embedding = _embed_text_sync(user_message)
        if message_embedding is None:
            return []

        suggestions: list[dict[str, object]] = []
        for skill in active_skills:
            skill_text = f"{skill.name}: {skill.description}"
            skill_embedding = _cached_skill_embedding(skill_text)
            if skill_embedding is None:
                continue

            similarity = _cosine_similarity(message_embedding, skill_embedding)
            if similarity >= _SUGGESTION_THRESHOLD:
                suggestions.append({
                    "slug": skill.slug,
                    "name": skill.name,
                    "description": skill.description,
                    "similarity": round(similarity, 3),
                })

        # Sort by similarity, take top N
        suggestions.sort(key=lambda x: float(x["similarity"]), reverse=True)  # type: ignore[arg-type]
        return suggestions[:max_suggestions]

    except Exception:
        logger.warning("Skill discovery failed", exc_info=True)
        return []


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------


def format_skill_suggestions(suggestions: list[dict[str, object]]) -> str:
    """Format skill suggestions for injection into system prompt.

    Returns empty string if no suggestions.
    """
    if not suggestions:
        return ""

    lines = [
        "\n## Suggested Skills",
        "Based on the user's message, these skills may be relevant:",
    ]
    for s in suggestions:
        lines.append(
            f"- **{s['slug']}**: {s['description']} (relevance: {s['similarity']})"
        )
    lines.append(
        "\nConsider using `use_skill` with one of these if it matches the user's intent."
    )
    return "\n".join(lines)
