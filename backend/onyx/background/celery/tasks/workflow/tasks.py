"""Celery task for syncing agent turns to the Neo4j workflow graph.

Dispatched fire-and-forget from the BudAgent orchestrator after each
``OverallStop`` event.  The task runs in the light worker queue and is
safe to drop (logs + skips) if Neo4j is unreachable.
"""

from celery import shared_task

from onyx.utils.logger import setup_logger
from onyx.workflow.sync import sync_turn_to_neo4j

logger = setup_logger()


@shared_task(
    name="sync_turn_to_neo4j_task",
    soft_time_limit=60,
    time_limit=120,
    ignore_result=True,
    acks_late=True,
)
def sync_turn_to_neo4j_task(
    *,
    session_id: str,
    tenant_id: str,
    user_id: str,
) -> None:
    """Celery task wrapper for Neo4j workflow sync.

    Args:
        session_id: Agent session UUID (string).
        tenant_id: Tenant identifier — automatically set in the
                   ``CURRENT_TENANT_ID_CONTEXTVAR`` by the Celery
                   ``task_prerun`` middleware in ``app_base.py``.
        user_id: User UUID (string).
    """
    logger.info(
        "sync_turn_to_neo4j_task: session=%s tenant=%s user=%s",
        session_id,
        tenant_id,
        user_id,
    )
    sync_turn_to_neo4j(
        session_id=session_id,
        tenant_id=tenant_id,
        user_id=user_id,
    )
