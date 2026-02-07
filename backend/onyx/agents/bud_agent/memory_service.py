"""Memory service for BudAgent — stores and retrieves persistent memories.

Provides both service functions and Agents SDK FunctionTool objects for
memory_store and memory_search so the agent can proactively manage its memory.

Search uses Vespa hybrid retrieval (70% vector + 30% BM25) when available,
falling back to PostgreSQL full-text search when Vespa is unreachable.
"""

import json
from typing import Any
from typing import Callable
from typing import Coroutine
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.vespa_memory import delete_memory_from_vespa
from onyx.agents.bud_agent.vespa_memory import index_memory_to_vespa
from onyx.agents.bud_agent.vespa_memory import search_memories_vespa
from onyx.db.agent import (
    create_memory,
    delete_memory,
    get_memories_for_user,
    search_memories_by_text,
    update_memory_access,
)
from onyx.db.enums import AgentMemorySource
from onyx.db.models import AgentMemory
from onyx.utils.logger import setup_logger

logger = setup_logger()


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


def _get_embedding(content: str, db_session: Session) -> list[float] | None:
    """Generate an embedding for the given content, or None on failure."""
    try:
        from onyx.context.search.utils import get_query_embedding

        return list(get_query_embedding(content, db_session))
    except Exception:
        logger.warning("Failed to generate embedding for memory", exc_info=True)
        return None


def store_memory(
    db_session: Session,
    user_id: UUID,
    content: str,
    source: AgentMemorySource = AgentMemorySource.SESSION,
    source_session_id: UUID | None = None,
) -> AgentMemory:
    """Store a memory entry with deduplication.

    Writes to PostgreSQL first, then indexes into Vespa for hybrid search.
    Vespa indexing failures are logged but do not prevent the memory from
    being stored.
    """
    if not content or not content.strip():
        raise ValueError("Memory content cannot be empty")

    memory = create_memory(
        db_session=db_session,
        user_id=user_id,
        content=content,
        source=source,
        source_session_id=source_session_id,
    )
    logger.info(f"Stored memory {memory.id} for user {user_id}")

    # Index into Vespa (best-effort)
    try:
        embedding = _get_embedding(content, db_session)
        if embedding is not None:
            created_at_epoch = int(memory.created_at.timestamp())
            index_memory_to_vespa(
                memory_id=memory.id,
                content=content.strip(),
                user_id=user_id,
                embedding=embedding,
                created_at=created_at_epoch,
            )
    except Exception:
        logger.warning(
            f"Failed to index memory {memory.id} to Vespa", exc_info=True
        )

    return memory


def search_memories(
    db_session: Session,
    user_id: UUID,
    query: str,
    limit: int = 6,
) -> list[AgentMemory]:
    """Search memories using Vespa hybrid search, falling back to PG keyword.

    The Vespa path performs 70% vector + 30% BM25 scoring and filters
    results below a minimum relevance threshold.  If Vespa is unavailable
    the function silently falls back to PostgreSQL full-text search.
    """
    if not query or not query.strip():
        return []

    memories: list[AgentMemory] = []

    # Try Vespa hybrid search first
    try:
        embedding = _get_embedding(query, db_session)
        if embedding is not None:
            vespa_results = search_memories_vespa(
                query_text=query,
                query_embedding=embedding,
                user_id=user_id,
                limit=limit,
            )
            if vespa_results:
                memory_ids = [mid for mid, _score in vespa_results]
                stmt = select(AgentMemory).where(AgentMemory.id.in_(memory_ids))
                id_to_memory = {
                    m.id: m
                    for m in db_session.execute(stmt).scalars().all()
                }
                # Preserve Vespa relevance ordering
                memories = [
                    id_to_memory[mid]
                    for mid in memory_ids
                    if mid in id_to_memory
                ]
    except Exception:
        logger.warning(
            "Vespa memory search failed, falling back to PG", exc_info=True
        )

    # Fallback to PostgreSQL keyword search
    if not memories:
        memories = search_memories_by_text(
            db_session=db_session,
            user_id=user_id,
            query=query,
            limit=limit,
        )

    # Update access timestamps
    for memory in memories:
        update_memory_access(db_session, memory.id)

    return memories


def get_recent_memories(
    db_session: Session,
    user_id: UUID,
    limit: int = 10,
) -> list[AgentMemory]:
    """Get the most recently accessed memories for a user."""
    return get_memories_for_user(
        db_session=db_session,
        user_id=user_id,
        limit=limit,
    )


def remove_memory(
    db_session: Session,
    memory_id: UUID,
    user_id: UUID,
) -> bool:
    """Delete a specific memory from both PostgreSQL and Vespa."""
    deleted = delete_memory(
        db_session=db_session,
        memory_id=memory_id,
        user_id=user_id,
    )
    if deleted:
        try:
            delete_memory_from_vespa(memory_id)
        except Exception:
            logger.warning(
                f"Failed to delete memory {memory_id} from Vespa", exc_info=True
            )
    return deleted


def format_memories_for_prompt(memories: list[AgentMemory]) -> str:
    """Format memories for inclusion in the system prompt."""
    if not memories:
        return ""

    lines: list[str] = []
    for i, memory in enumerate(memories, 1):
        source_label = memory.source.value if memory.source else "unknown"
        lines.append(f"{i}. [{source_label}] {memory.content}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# FunctionTool factories for the Agents SDK
# ---------------------------------------------------------------------------


def create_memory_tools(
    db_session: Session,
    user_id: UUID,
    session_id: UUID | None = None,
) -> list[Any]:
    """Create Agents SDK FunctionTool objects for memory_store and memory_search.

    These are *remote* tools — they execute directly on the backend without
    a round-trip to the desktop.  The ``db_session`` / ``user_id`` are captured
    in the closures so the agent loop can call them seamlessly.

    Returns a list of ``FunctionTool`` instances.
    """
    from agents import FunctionTool
    from agents import RunContextWrapper

    from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS

    # Type alias for the on_invoke_tool callback
    InvokeHandler = Callable[
        [RunContextWrapper[Any], str],
        Coroutine[Any, Any, str],
    ]

    tools: list[FunctionTool] = []

    # ── memory_store ──────────────────────────────────────────────────────
    store_schema = REMOTE_TOOL_SCHEMAS["memory_store"]

    async def _handle_memory_store(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            content = args.get("content", "")
            if not content or not content.strip():
                return "Error: memory content cannot be empty."

            memory = store_memory(
                db_session=db_session,
                user_id=user_id,
                content=content,
                source=AgentMemorySource.SESSION,
                source_session_id=session_id,
            )
            return f"Memory stored (id={memory.id})."
        except Exception as e:
            logger.exception("memory_store failed")
            return f"Error storing memory: {e}"

    tools.append(
        FunctionTool(
            name="memory_store",
            description=store_schema["description"],
            params_json_schema=store_schema["parameters"],
            on_invoke_tool=_handle_memory_store,
        )
    )

    # ── memory_search ─────────────────────────────────────────────────────
    search_schema = REMOTE_TOOL_SCHEMAS["memory_search"]

    async def _handle_memory_search(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            query = args.get("query", "")
            limit = min(int(args.get("limit", 5)), 20)
            if not query or not query.strip():
                return "Error: search query cannot be empty."

            memories = search_memories(
                db_session=db_session,
                user_id=user_id,
                query=query,
                limit=limit,
            )

            if not memories:
                return "No matching memories found."

            lines: list[str] = []
            for i, m in enumerate(memories, 1):
                source_label = m.source.value if m.source else "unknown"
                lines.append(f"{i}. [{source_label}] {m.content}")
            return "\n".join(lines)
        except Exception as e:
            logger.exception("memory_search failed")
            return f"Error searching memories: {e}"

    tools.append(
        FunctionTool(
            name="memory_search",
            description=search_schema["description"],
            params_json_schema=search_schema["parameters"],
            on_invoke_tool=_handle_memory_search,
        )
    )

    return tools
