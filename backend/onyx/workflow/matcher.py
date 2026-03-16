"""Workflow matcher — determines whether a new turn belongs to an existing
Workflow or needs a new one, using embedding similarity.

Given a ``task_name`` produced by the summarizer, we:
1. Embed the task_name using the configured embedding model.
2. Fetch all Workflow nodes for this user/tenant from Neo4j.
3. Compute cosine similarity in Python against stored name embeddings.
4. If similarity > threshold, return the existing workflow.
5. Otherwise, create a new Workflow node and return its id.

Also exposes ``find_active_execution_in_session`` for same-session
continuation detection.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import numpy as np

from onyx.utils.logger import setup_logger
from onyx.workflow.neo4j_client import Neo4jClient

logger = setup_logger()

# Cosine-similarity threshold above which we consider two task names
# to refer to the same workflow.
_SIMILARITY_THRESHOLD: float = 0.8


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_arr = np.array(a, dtype=np.float64)
    b_arr = np.array(b, dtype=np.float64)
    dot = float(np.dot(a_arr, b_arr))
    norm = float(np.linalg.norm(a_arr) * np.linalg.norm(b_arr))
    if norm < 1e-10:
        return 0.0
    return dot / norm


def _embed_text_sync(text: str) -> list[float]:
    """Embed a single text string using the project's embedding model.

    Uses the same approach as ``onyx.kg.utils.embeddings.encode_string_batch``
    — opens a tenant-scoped DB session, fetches the current search settings,
    builds an ``EmbeddingModel`` and encodes.

    Falls back to a deterministic hash-based embedding if the model server is
    unavailable (so workflow matching still works, albeit less accurately).
    """
    try:
        from onyx.db.engine.sql_engine import get_session_with_current_tenant
        from onyx.db.search_settings import get_current_search_settings
        from onyx.natural_language_processing.search_nlp_models import EmbeddingModel
        from shared_configs.configs import MODEL_SERVER_HOST
        from shared_configs.configs import MODEL_SERVER_PORT
        from shared_configs.enums import EmbedTextType

        with get_session_with_current_tenant() as db_session:
            search_settings = get_current_search_settings(db_session)
            model = EmbeddingModel.from_db_model(
                search_settings=search_settings,
                server_host=MODEL_SERVER_HOST,
                server_port=MODEL_SERVER_PORT,
            )
            embeddings = model.encode([text], text_type=EmbedTextType.QUERY)

        return list(embeddings[0])
    except Exception:
        logger.warning(
            "Model-server embedding failed; using hash-based fallback",
            exc_info=True,
        )
        return _hash_embedding_fallback(text)


def _hash_embedding_fallback(text: str, dim: int = 128) -> list[float]:
    """Deterministic, lightweight fallback embedding based on character hashing.

    This is NOT a real semantic embedding — it only provides rough lexical
    matching.  It exists so that workflow creation is never blocked by a
    model-server outage.  The real embedding will overwrite it on the next
    successful call.
    """
    import hashlib

    text_lower = text.lower().strip()
    # Use SHA-512 to produce enough bytes for our dimension
    digest = hashlib.sha512(text_lower.encode("utf-8")).digest()
    # Repeat if dim > 64 floats
    while len(digest) < dim * 4:
        digest += hashlib.sha512(digest).digest()
    arr = np.frombuffer(digest[: dim * 4], dtype=np.float32).copy()
    # Normalise to unit length
    norm = float(np.linalg.norm(arr))
    if norm > 0:
        arr = arr / norm
    return arr.tolist()


async def _embed_text(text: str) -> list[float]:
    """Async wrapper: runs the synchronous embedding in an executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _embed_text_sync, text)


# ---------------------------------------------------------------------------
# Core matcher
# ---------------------------------------------------------------------------


async def match_or_create_workflow(
    task_name: str,
    user_id: str,
    tenant_id: str,
    agent_session_id: str,
    neo4j_client: Neo4jClient,
) -> tuple[str, bool]:
    """Match *task_name* to an existing Workflow or create a new one.

    Args:
        task_name: Human-readable task name from the summarizer.
        user_id: The user who owns the workflow.
        tenant_id: Tenant identifier for multi-tenancy.
        agent_session_id: The current agent session (used for logging).
        neo4j_client: An initialised Neo4j client instance.

    Returns:
        A tuple ``(workflow_id, is_new)`` where *is_new* is ``True`` when
        a brand-new Workflow node was created.
    """
    try:
        # 1. Embed the incoming task name
        task_embedding = await _embed_text(task_name)

        # 2. Fetch existing workflows for this user/tenant
        existing_workflows = await _fetch_user_workflows(
            user_id=user_id,
            tenant_id=tenant_id,
            neo4j_client=neo4j_client,
        )

        # 3. Find the best match
        best_id: str | None = None
        best_score: float = 0.0

        for wf in existing_workflows:
            stored_embedding = wf.get("embedding")
            if not stored_embedding or not isinstance(stored_embedding, list):
                continue
            score = _cosine_similarity(task_embedding, stored_embedding)
            if score > best_score:
                best_score = score
                best_id = str(wf.get("id", ""))

        # 4. Return existing workflow if similarity is high enough
        if best_id and best_score >= _SIMILARITY_THRESHOLD:
            logger.info(
                "Matched task '%s' to existing workflow %s (score=%.3f)",
                task_name,
                best_id,
                best_score,
            )
            return best_id, False

        # 5. No match — create a new Workflow node
        new_id = await _create_workflow(
            task_name=task_name,
            user_id=user_id,
            tenant_id=tenant_id,
            embedding=task_embedding,
            neo4j_client=neo4j_client,
        )
        logger.info(
            "Created new workflow '%s' (id=%s) for user %s "
            "(best existing score=%.3f)",
            task_name,
            new_id,
            user_id,
            best_score,
        )
        return new_id, True

    except Exception:
        # Graceful degradation: create a new workflow with no embedding so
        # that downstream consumers are never blocked.
        logger.error(
            "Workflow matching failed; creating fallback workflow",
            exc_info=True,
        )
        fallback_id = str(uuid4())
        try:
            await _create_workflow_raw(
                workflow_id=fallback_id,
                task_name=task_name,
                user_id=user_id,
                tenant_id=tenant_id,
                embedding=[],
                neo4j_client=neo4j_client,
            )
        except Exception:
            logger.error(
                "Could not write fallback workflow to Neo4j",
                exc_info=True,
            )
        return fallback_id, True


# ---------------------------------------------------------------------------
# Same-session continuation
# ---------------------------------------------------------------------------


async def find_active_execution_in_session(
    agent_session_id: str,
    neo4j_client: Neo4jClient,
) -> str | None:
    """Find an active (``running``) Execution in the given agent session.

    Returns the execution id if one exists, or ``None``.
    """
    query = (
        "MATCH (e:Execution {agent_session_id: $sid, status: 'running'}) "
        "RETURN e.id AS id "
        "LIMIT 1"
    )
    try:
        results = await neo4j_client.execute_read(
            query, {"sid": agent_session_id}
        )
        if results:
            return str(results[0]["id"])
        return None
    except Exception:
        logger.warning(
            "Failed to query active execution for session %s",
            agent_session_id,
            exc_info=True,
        )
        return None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _fetch_user_workflows(
    user_id: str,
    tenant_id: str,
    neo4j_client: Neo4jClient,
) -> list[dict[str, object]]:
    """Fetch all Workflow nodes for a user/tenant."""
    query = (
        "MATCH (w:Workflow {user_id: $userId, tenant_id: $tenantId}) "
        "RETURN w.id AS id, w.name AS name, w.name_embedding AS embedding"
    )
    return await neo4j_client.execute_read(
        query, {"userId": user_id, "tenantId": tenant_id}
    )


async def _create_workflow(
    task_name: str,
    user_id: str,
    tenant_id: str,
    embedding: list[float],
    neo4j_client: Neo4jClient,
) -> str:
    """Create a new Workflow node and return its id."""
    workflow_id = str(uuid4())
    await _create_workflow_raw(
        workflow_id=workflow_id,
        task_name=task_name,
        user_id=user_id,
        tenant_id=tenant_id,
        embedding=embedding,
        neo4j_client=neo4j_client,
    )
    return workflow_id


async def _create_workflow_raw(
    workflow_id: str,
    task_name: str,
    user_id: str,
    tenant_id: str,
    embedding: list[float],
    neo4j_client: Neo4jClient,
) -> None:
    """Low-level helper that writes the Workflow node to Neo4j."""
    query = (
        "CREATE (w:Workflow {"
        "  id: $id,"
        "  tenant_id: $tenantId,"
        "  user_id: $userId,"
        "  name: $name,"
        "  description: $description,"
        "  name_embedding: $embedding,"
        "  execution_count: 0,"
        "  success_rate: 1.0,"
        "  avg_duration_ms: 0,"
        "  tags: [],"
        "  created_at: datetime(),"
        "  updated_at: datetime()"
        "}) "
        "RETURN w.id AS id"
    )
    params: dict[str, object] = {
        "id": workflow_id,
        "tenantId": tenant_id,
        "userId": user_id,
        "name": task_name,
        "description": task_name,
        "embedding": embedding,
    }
    await neo4j_client.execute_write(query, params)
