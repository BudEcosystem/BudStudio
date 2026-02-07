"""Vespa-backed hybrid search operations for agent memories.

Provides index, delete, and search operations against the ``agent_memory``
Vespa schema.  The schema uses a hybrid ranking profile that combines
cosine vector similarity (70%) with BM25 keyword scoring (30%).
"""

import time
from uuid import UUID

import httpx

from onyx.document_index.vespa.shared_utils.utils import get_vespa_http_client
from onyx.document_index.vespa_constants import AGENT_MEMORY_DOC_ID_ENDPOINT
from onyx.document_index.vespa_constants import SEARCH_ENDPOINT
from onyx.document_index.vespa_constants import VESPA_TIMEOUT
from onyx.utils.logger import setup_logger
from shared_configs.model_server_models import Embedding

logger = setup_logger()

# Minimum relevance score below which results are discarded.
MIN_RELEVANCE_SCORE = 0.35

# Default hybrid alpha: 70% vector, 30% keyword (matches OpenClaw).
DEFAULT_ALPHA = 0.7


def index_memory_to_vespa(
    memory_id: UUID,
    content: str,
    user_id: UUID,
    embedding: Embedding,
    created_at: int,
) -> None:
    """Index a single agent memory into Vespa.

    Parameters
    ----------
    memory_id:
        The PG primary-key UUID for this memory.
    content:
        The textual content of the memory (used for BM25).
    user_id:
        Owning user's UUID (used for filtering).
    embedding:
        Pre-computed embedding vector (float list).
    created_at:
        Epoch seconds timestamp.
    """
    doc_id = str(memory_id)
    url = f"{AGENT_MEMORY_DOC_ID_ENDPOINT}/{doc_id}"

    fields = {
        "memory_id": doc_id,
        "user_id": str(user_id),
        "content": content,
        "embedding": {"values": list(embedding)},
        "created_at": created_at,
    }

    try:
        with get_vespa_http_client() as http_client:
            response = http_client.post(
                url,
                headers={"Content-Type": "application/json"},
                json={"fields": fields},
            )
            response.raise_for_status()
    except httpx.HTTPError:
        logger.exception(f"Failed to index agent memory {memory_id} to Vespa")
        raise


def delete_memory_from_vespa(memory_id: UUID) -> None:
    """Delete a single agent memory from Vespa by its PG UUID."""
    doc_id = str(memory_id)
    url = f"{AGENT_MEMORY_DOC_ID_ENDPOINT}/{doc_id}"

    try:
        with get_vespa_http_client() as http_client:
            response = http_client.delete(url)
            response.raise_for_status()
    except httpx.HTTPError:
        logger.warning(
            f"Failed to delete agent memory {memory_id} from Vespa", exc_info=True
        )


def search_memories_vespa(
    query_text: str,
    query_embedding: Embedding,
    user_id: UUID,
    limit: int = 6,
    alpha: float = DEFAULT_ALPHA,
    min_score: float = MIN_RELEVANCE_SCORE,
) -> list[tuple[UUID, float]]:
    """Search agent memories in Vespa using hybrid (vector + BM25) ranking.

    Returns a list of ``(memory_id, relevance_score)`` tuples sorted by
    descending score.  Results below *min_score* are excluded.
    """
    target_hits = max(10 * limit, 100)

    yql = (
        "select memory_id, content from agent_memory where "
        f'user_id contains "{user_id}" and '
        f"({{targetHits: {target_hits}}}nearestNeighbor(embedding, query_embedding) "
        'or ({grammar: "weakAnd"}userInput(@query)))'
    )

    params: dict[str, str | int | float] = {
        "yql": yql,
        "query": query_text,
        "input.query(query_embedding)": str(list(query_embedding)),
        "input.query(alpha)": alpha,
        "hits": limit,
        "ranking.profile": "hybrid_memory_search",
        "timeout": VESPA_TIMEOUT,
    }

    try:
        with get_vespa_http_client() as http_client:
            response = http_client.post(SEARCH_ENDPOINT, json=params)
            response.raise_for_status()
    except httpx.HTTPError:
        logger.exception("Failed to search agent memories in Vespa")
        raise

    data = response.json()
    hits = data.get("root", {}).get("children", [])

    results: list[tuple[UUID, float]] = []
    for hit in hits:
        relevance: float = hit.get("relevance", 0.0)
        if relevance < min_score:
            continue

        memory_id_str: str = hit.get("fields", {}).get("memory_id", "")
        if not memory_id_str:
            continue

        try:
            results.append((UUID(memory_id_str), relevance))
        except ValueError:
            logger.warning(f"Invalid memory_id from Vespa: {memory_id_str}")

    return results
