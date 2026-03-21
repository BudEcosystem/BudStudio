"""Celery tasks for the Neo4j workflow graph.

1. ``check_conversation_close`` — periodic beat task that scans for done
   conversations and dispatches the skill evolution pipeline.
2. ``run_post_conversation_pipeline_task`` — runs the full Judge -> Proposer ->
   Generator pipeline for a single session.
3. ``check_skill_evolution`` — periodic beat task (every 30 min) that checks
   if any skills need population-based evolution via SkillEvolver.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from celery import shared_task
from celery import Task
from redis.lock import Lock as RedisLock
from sqlalchemy import case, func, select

from onyx.background.celery.apps.app_base import task_logger
from onyx.configs.constants import CELERY_GENERIC_BEAT_LOCK_TIMEOUT
from onyx.configs.constants import OnyxCeleryPriority
from onyx.configs.constants import OnyxCeleryTask
from onyx.configs.constants import OnyxRedisLocks
from onyx.db.engine.sql_engine import get_session_with_current_tenant
from onyx.db.enums import AgentMessageRole, InboxGoalStatus
from onyx.db.models import AgentMessage, AgentSession, InboxConversation, InboxMessage
from onyx.redis.redis_pool import get_redis_client
from onyx.utils.logger import setup_logger

logger = setup_logger()

# Redis key prefix for marking sessions as already judged (24h TTL)
_JUDGED_KEY_PREFIX = "judged:"
_JUDGED_TTL_SECONDS = 86400  # 24 hours

# How long a session must be idle (no new messages) before triggering the
# pipeline via the turn-count heuristic.
_IDLE_THRESHOLD_MINUTES = 15

# Minimum number of user turns to consider a session "substantive" enough
# for the idle heuristic.
_MIN_USER_TURNS = 4


# ---------------------------------------------------------------------------
# Periodic beat task: detect closed conversations
# ---------------------------------------------------------------------------


@shared_task(
    name=OnyxCeleryTask.CHECK_CONVERSATION_CLOSE,
    soft_time_limit=120,
    bind=True,
    ignore_result=True,
)
def check_conversation_close(self: Task, *, tenant_id: str) -> None:
    """Find conversations that are 'done' and dispatch the pipeline.

    Runs every 5 minutes via Celery Beat.  Uses a Redis lock to avoid
    overlapping invocations.

    A conversation is considered "done" if either:
    1. It is linked to an InboxConversation whose goal_status is
       COMPLETED or CANCELLED.
    2. It has >= ``_MIN_USER_TURNS`` user messages and the most recent
       message is older than ``_IDLE_THRESHOLD_MINUTES`` minutes.
    """
    task_logger.info("check_conversation_close: starting")

    redis_client = get_redis_client(tenant_id=tenant_id)
    lock: RedisLock = redis_client.lock(
        OnyxRedisLocks.CHECK_CONVERSATION_CLOSE_BEAT_LOCK,
        timeout=CELERY_GENERIC_BEAT_LOCK_TIMEOUT,
    )

    if not lock.acquire(blocking=False):
        task_logger.info("check_conversation_close: could not acquire lock")
        return None

    dispatched = 0
    try:
        with get_session_with_current_tenant() as db_session:
            qualifying_sessions = _find_qualifying_sessions(db_session)

        for sid, uid in qualifying_sessions:
            session_key = f"{_JUDGED_KEY_PREFIX}{sid}"
            # Skip if already processed (idempotency via Redis)
            if redis_client.get(session_key):
                continue

            # Mark as processed first (set-before-dispatch pattern)
            redis_client.set(session_key, "1", ex=_JUDGED_TTL_SECONDS)

            # Dispatch the pipeline task
            self.app.send_task(
                OnyxCeleryTask.RUN_POST_CONVERSATION_PIPELINE,
                kwargs={
                    "session_id": sid,
                    "tenant_id": tenant_id,
                    "user_id": uid,
                },
                priority=OnyxCeleryPriority.LOW,
            )
            dispatched += 1

    except Exception:
        task_logger.error(
            "check_conversation_close: error scanning sessions",
            exc_info=True,
        )
    finally:
        if lock.owned():
            lock.release()

    if dispatched > 0:
        task_logger.info(
            "check_conversation_close: dispatched %d pipeline tasks",
            dispatched,
        )
    return None


def _find_qualifying_sessions(
    db_session: "Session",  # type: ignore[name-defined]
) -> list[tuple[str, str]]:
    """Query PostgreSQL for sessions eligible for the post-conversation pipeline.

    Returns a list of (session_id_str, user_id_str) tuples.
    """
    results: list[tuple[str, str]] = []

    # ---- Criterion 1: Inbox conversations with closed goals ----
    try:
        inbox_stmt = (
            select(
                AgentSession.id.label("session_id"),
                AgentSession.user_id.label("user_id"),
            )
            .join(
                InboxMessage,
                InboxMessage.session_id == AgentSession.id,
            )
            .join(
                InboxConversation,
                InboxConversation.id == InboxMessage.conversation_id,
            )
            .where(
                InboxConversation.goal_status.in_([
                    InboxGoalStatus.COMPLETED,
                    InboxGoalStatus.CANCELLED,
                ])
            )
            .where(AgentSession.user_id.isnot(None))
            .distinct()
        )
        inbox_rows = db_session.execute(inbox_stmt).all()
        for row in inbox_rows:
            results.append((str(row.session_id), str(row.user_id)))
    except Exception:
        task_logger.warning(
            "check_conversation_close: inbox goal query failed",
            exc_info=True,
        )

    # ---- Criterion 2: Sessions idle with enough turns ----
    try:
        idle_threshold = datetime.now(timezone.utc) - timedelta(
            minutes=_IDLE_THRESHOLD_MINUTES
        )

        # Subquery: count USER messages and get max(created_at) per session
        turn_stats = (
            select(
                AgentMessage.session_id,
                func.count(
                    case(
                        (AgentMessage.role == AgentMessageRole.USER, 1),
                    )
                ).label("user_turns"),
                func.max(AgentMessage.created_at).label("last_message_at"),
            )
            .group_by(AgentMessage.session_id)
            .subquery()
        )

        idle_stmt = (
            select(
                AgentSession.id.label("session_id"),
                AgentSession.user_id.label("user_id"),
            )
            .join(
                turn_stats,
                turn_stats.c.session_id == AgentSession.id,
            )
            .where(
                turn_stats.c.user_turns >= _MIN_USER_TURNS,
                turn_stats.c.last_message_at < idle_threshold,
            )
            .where(AgentSession.user_id.isnot(None))
        )
        idle_rows = db_session.execute(idle_stmt).all()
        for row in idle_rows:
            sid = str(row.session_id)
            uid = str(row.user_id)
            # Avoid duplicates from criterion 1
            if (sid, uid) not in results:
                results.append((sid, uid))
    except Exception:
        task_logger.warning(
            "check_conversation_close: idle session query failed",
            exc_info=True,
        )

    return results


# ---------------------------------------------------------------------------
# Pipeline runner task
# ---------------------------------------------------------------------------


@shared_task(
    name=OnyxCeleryTask.RUN_POST_CONVERSATION_PIPELINE,
    soft_time_limit=300,  # 5 min -- multiple LLM calls
    time_limit=360,
    bind=True,
    ignore_result=True,
)
def run_post_conversation_pipeline_task(
    self: Task,
    *,
    session_id: str,
    tenant_id: str,
    user_id: str,
) -> None:
    """Run the full post-conversation pipeline for a single session.

    Spins up an asyncio event loop because the pipeline uses async Neo4j
    and async LLM calls internally.
    """
    import asyncio

    from onyx.workflow.pipeline import run_post_conversation_pipeline

    task_logger.info(
        "run_post_conversation_pipeline_task: session=%s tenant=%s user=%s",
        session_id,
        tenant_id,
        user_id,
    )

    try:
        asyncio.run(
            run_post_conversation_pipeline(
                session_id=session_id,
                tenant_id=tenant_id,
                user_id=user_id,
            )
        )
    except Exception:
        task_logger.error(
            "run_post_conversation_pipeline_task: failed for session=%s",
            session_id,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Periodic beat task: check if skills need evolution
# ---------------------------------------------------------------------------


@shared_task(
    name=OnyxCeleryTask.CHECK_SKILL_EVOLUTION,
    soft_time_limit=600,  # 10 min — multiple LLM calls per skill
    time_limit=660,
    bind=True,
    ignore_result=True,
)
def check_skill_evolution(self: Task, *, tenant_id: str) -> None:
    """Periodic task: check if any skills need evolution.

    Runs every 30 minutes via Celery Beat.  Uses a Redis lock to avoid
    overlapping invocations.

    Queries Neo4j for skills with DERIVED_FROM relationships and high
    failure rates. Runs ``SkillEvolver.evolve()`` for each qualifying skill.
    """
    import asyncio

    task_logger.info("check_skill_evolution: starting")

    redis_client = get_redis_client(tenant_id=tenant_id)
    lock: RedisLock = redis_client.lock(
        OnyxRedisLocks.CHECK_SKILL_EVOLUTION_BEAT_LOCK,
        timeout=CELERY_GENERIC_BEAT_LOCK_TIMEOUT,
    )

    if not lock.acquire(blocking=False):
        task_logger.info("check_skill_evolution: could not acquire lock")
        return None

    evolved_count = 0
    try:
        from onyx.workflow.evolution import SkillEvolver, get_evolvable_skill_ids

        skill_ids: list[str] = asyncio.run(get_evolvable_skill_ids())
        task_logger.info(
            "check_skill_evolution: found %d evolvable skills",
            len(skill_ids),
        )

        for skill_id in skill_ids:
            try:
                evolver = SkillEvolver(
                    skill_id=skill_id,
                    tenant_id=tenant_id,
                )
                should = asyncio.run(evolver.should_evolve())
                if not should:
                    continue

                task_logger.info(
                    "check_skill_evolution: evolving skill %s",
                    skill_id,
                )
                success = asyncio.run(evolver.evolve())
                if success:
                    evolved_count += 1

            except Exception:
                task_logger.error(
                    "check_skill_evolution: error evolving skill %s",
                    skill_id,
                    exc_info=True,
                )

    except Exception:
        task_logger.error(
            "check_skill_evolution: error discovering skills",
            exc_info=True,
        )
    finally:
        if lock.owned():
            lock.release()

    if evolved_count > 0:
        task_logger.info(
            "check_skill_evolution: evolved %d skills",
            evolved_count,
        )
    return None


# ---------------------------------------------------------------------------
# Skill Feedback Descent task
# ---------------------------------------------------------------------------


@shared_task(
    name=OnyxCeleryTask.RUN_SKILL_FEEDBACK_DESCENT,
    soft_time_limit=300,
    time_limit=360,
    bind=True,
    ignore_result=True,
)
def run_skill_feedback_descent(
    self: Task,
    *,
    skill_id: str,
    tenant_id: str,
) -> None:
    """Run Feedback Descent refinement for a single skill.

    Triggered automatically when a skill's quality score drops below 0.5
    after receiving enough annotations. Uses async because the evolution
    engine relies on async Neo4j and LLM calls.
    """
    import asyncio

    task_logger.info(
        "run_skill_feedback_descent: skill=%s tenant=%s",
        skill_id,
        tenant_id,
    )

    try:
        from onyx.workflow.evolution import FeedbackDescentRefiner

        refiner = FeedbackDescentRefiner(skill_id=skill_id, tenant_id=tenant_id)
        asyncio.run(refiner.refine())
    except ImportError:
        task_logger.warning(
            "run_skill_feedback_descent: evolution module not available yet "
            "(skill=%s)",
            skill_id,
        )
    except Exception:
        task_logger.error(
            "run_skill_feedback_descent: failed for skill=%s",
            skill_id,
            exc_info=True,
        )
