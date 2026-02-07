"""One-time backfill script to index all existing AgentMemory rows into Vespa.

Usage (from backend directory with venv activated)::

    python -m onyx.agents.bud_agent.vespa_memory_backfill

Or call ``backfill_memories_to_vespa()`` from a management endpoint.
"""

import concurrent.futures
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.vespa_memory import index_memory_to_vespa
from onyx.context.search.utils import get_query_embeddings
from onyx.db.engine import get_session_with_current_tenant
from onyx.db.models import AgentMemory
from onyx.utils.logger import setup_logger

logger = setup_logger()

# Number of memories to embed in a single batch call to the model server.
EMBED_BATCH_SIZE = 32

# Number of concurrent threads for Vespa indexing.
INDEX_THREADS = 8


def backfill_memories_to_vespa(db_session: Session | None = None) -> int:
    """Load all existing ``AgentMemory`` rows, embed them, and index into Vespa.

    Returns the number of successfully indexed memories.
    """
    close_session = False
    if db_session is None:
        db_session = next(get_session_with_current_tenant())
        close_session = True

    try:
        stmt = select(AgentMemory).order_by(AgentMemory.created_at)
        memories = list(db_session.execute(stmt).scalars().all())

        if not memories:
            logger.info("No agent memories found to backfill.")
            return 0

        logger.info(f"Backfilling {len(memories)} agent memories to Vespa ...")

        indexed = 0

        # Process in batches to limit memory and model-server load
        for batch_start in range(0, len(memories), EMBED_BATCH_SIZE):
            batch = memories[batch_start : batch_start + EMBED_BATCH_SIZE]
            contents = [m.content for m in batch]

            try:
                embeddings = get_query_embeddings(contents, db_session)
            except Exception:
                logger.exception(
                    f"Failed to embed batch starting at index {batch_start}"
                )
                continue

            def _index_one(idx: int) -> bool:
                mem = batch[idx]
                emb = embeddings[idx]
                try:
                    index_memory_to_vespa(
                        memory_id=mem.id,
                        content=mem.content,
                        user_id=mem.user_id,
                        embedding=list(emb),
                        created_at=int(mem.created_at.timestamp()),
                    )
                    return True
                except Exception:
                    logger.warning(
                        f"Failed to index memory {mem.id} to Vespa",
                        exc_info=True,
                    )
                    return False

            with concurrent.futures.ThreadPoolExecutor(
                max_workers=INDEX_THREADS
            ) as executor:
                results = list(executor.map(_index_one, range(len(batch))))
                indexed += sum(1 for ok in results if ok)

        logger.info(
            f"Backfill complete: {indexed}/{len(memories)} memories indexed to Vespa."
        )
        return indexed
    finally:
        if close_session:
            db_session.close()


if __name__ == "__main__":
    backfill_memories_to_vespa()
