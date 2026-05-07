"""Celery tasks for sub-session execution, zombie reaping, and persistent expiry.

Sub-sessions are autonomous agent runs spawned by a parent session.
They execute in a background Celery worker using TurnDriver with
SubSessionEmitter (no-op) and AutoApproveRequester (auto-approve).

The zombie reaper runs periodically to detect and clean up sub-sessions
that have stalled without a Redis heartbeat.

The persistent expiry task runs periodically to notify parent sessions
when SUB_PERSISTENT sub-sessions have expired due to inactivity.
"""

import asyncio
import concurrent.futures
from typing import Any
import json
from uuid import UUID

from celery import shared_task
from celery import Task
from celery.exceptions import SoftTimeLimitExceeded
from redis.lock import Lock as RedisLock
from sqlalchemy import select
from sqlalchemy.orm import Session

from onyx.background.celery.apps.app_base import task_logger
from onyx.configs.constants import CELERY_GENERIC_BEAT_LOCK_TIMEOUT
from onyx.configs.constants import OnyxCeleryTask
from onyx.configs.constants import OnyxRedisLocks
from onyx.db.agent import add_session_message
from onyx.db.agent import get_expired_persistent_sub_sessions
from onyx.db.agent import get_session
from onyx.db.agent import get_zombie_sub_sessions
from onyx.db.agent import update_session_status
from onyx.db.agent_events import consume_pending_events
from onyx.db.agent_events import enqueue_session_event
from onyx.db.engine.sql_engine import get_session_with_current_tenant
from onyx.db.enums import AgentEventType
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import AgentSession
from onyx.db.models import User
from onyx.redis.redis_pool import get_redis_client


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_HEARTBEAT_TTL_SECONDS = 120  # 2 minutes
_HEARTBEAT_KEY_PREFIX = "bud_agent_running"
_DEFAULT_MAX_TURNS = 25
_SUMMARY_MAX_WORDS = 500

# Persistent sub-session inactivity timeout (seconds).
# After a SUB_PERSISTENT session has been COMPLETED for this long,
# it is considered expired and a notification is sent to its parent.
PERSISTENT_SUB_SESSION_EXPIRY_SECONDS = 86400  # 1 day

# Redis key prefix for tracking sessions that have already been notified
# about expiry, preventing duplicate notifications.
_EXPIRED_NOTIFIED_KEY_PREFIX = "bud_agent_expired_notified"
_EXPIRED_NOTIFIED_TTL_SECONDS = 7 * 24 * 3600  # 7 days


# ---------------------------------------------------------------------------
# Async bridge (same pattern as cron_orchestrator.py)
# ---------------------------------------------------------------------------


def _run_async(coro: object) -> object:
    """Run an async coroutine from synchronous Celery task code.

    Handles the case where an event loop may already be running
    (e.g. inside Celery workers that use gevent/eventlet).
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Helper: truncate text to N words
# ---------------------------------------------------------------------------


def _truncate_words(text: str, max_words: int = _SUMMARY_MAX_WORDS) -> str:
    """Truncate text to *max_words* words, appending '...' if truncated."""
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


# ---------------------------------------------------------------------------
# Helper: extract summary from messages
# ---------------------------------------------------------------------------


def _extract_text_from_content(content: object) -> str:
    """Extract plain text from an Agents SDK content value.

    Content can be:
    - A plain string
    - A list of content blocks like [{"type": "output_text", "text": "..."}, ...]
    - A list of dicts with "annotations" + "text" keys (tool output format)
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts) if parts else str(content)
    return str(content)


def _extract_summary(messages: list[dict[str, object]]) -> str:
    """Extract a summary from the sub-session's final response.

    Looks for a ``SUMMARY: ...`` line in the last assistant message
    (the sub-session prompt instructs the LLM to include one).
    Falls back to the first 2 sentences if no summary line is found.
    """
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and msg.get("content"):
            text = _extract_text_from_content(msg["content"])
            if not text:
                continue

            # Look for explicit SUMMARY: line
            for line in reversed(text.splitlines()):
                stripped = line.strip()
                if stripped.upper().startswith("SUMMARY:"):
                    return stripped[len("SUMMARY:"):].strip()

            # Fallback: first 2 sentences
            sentences = text.replace("\n", " ").split(". ")
            if len(sentences) >= 2:
                return sentences[0] + ". " + sentences[1] + "."
            return _truncate_words(text, max_words=50)

    return "(no summary available)"


# ---------------------------------------------------------------------------
# Announce helpers
# ---------------------------------------------------------------------------


def _notify_parent(
    db_session: Session,
    parent_session_id: UUID,
    sub_session: AgentSession,
    content: str,
    event_type: AgentEventType,
    event_payload: dict[str, object],
    socketio_type: str,
    tenant_id: str,
    redis_client: Any = None,
) -> None:
    """Deliver sub-session result to the parent session.

    - If parent is idle: persist assistant message immediately + Socket.IO notify.
    - If parent is busy: enqueue event with the message content. The drain
      will persist the message after the current turn finishes, ensuring
      correct message ordering.
    """
    from onyx.db.agent import is_session_busy

    rc = redis_client or get_redis_client(tenant_id=tenant_id)
    parent = get_session(db_session, parent_session_id)
    is_busy = is_session_busy(rc, parent_session_id) if parent else False

    if is_busy:
        # Parent is mid-turn. Don't persist the message now (it would
        # interleave with the in-flight response). Enqueue it so the
        # drain persists it after the turn completes.
        enqueue_session_event(
            db_session=db_session,
            session_id=parent_session_id,
            event_type=event_type,
            payload={**event_payload, "message": content},
        )
        task_logger.info(
            "Sub-session %s: parent %s is busy, enqueued for drain",
            sub_session.id,
            parent_session_id,
        )
    else:
        # Parent is idle. Persist the message immediately.
        add_session_message(
            db_session=db_session,
            session_id=parent_session_id,
            role=AgentMessageRole.ASSISTANT,
            content=content,
        )

    # Notify frontend via Socket.IO (Redis pub/sub bridge).
    # Include `message` so the frontend can display it directly.
    try:
        rc.publish(
            f"sub_session_events:{parent_session_id}",
            json.dumps({
                **event_payload,
                "type": socketio_type,
                "message": content,
            }),
        )
    except Exception:
        task_logger.warning(
            "Failed to publish Socket.IO event for sub-session %s",
            sub_session.id,
            exc_info=True,
        )


def _summarize_and_announce(
    db_session: Session,
    session: AgentSession,
    messages: list[dict[str, object]],
    tenant_id: str,
    redis_client: Any = None,
) -> None:
    """Announce successful sub-session completion to the parent session."""
    task_description: str = session.task_description or "(unknown task)"
    summary = _extract_summary(messages)

    parent_session_id = session.parent_session_id
    if parent_session_id is None:
        task_logger.warning(
            "Sub-session %s has no parent_session_id, cannot announce",
            session.id,
        )
        update_session_status(db_session, session.id, AgentSessionStatus.COMPLETED)
        return

    update_session_status(db_session, session.id, AgentSessionStatus.COMPLETED)

    content = (
        f"I finished the background task: **{task_description}**\n\n"
        f"{summary}\n\n"
        f"You can open the sub-session thread for full details."
    )
    event_payload: dict[str, object] = {
        "sub_session_id": str(session.id),
        "task": task_description,
        "summary": summary,
    }

    _notify_parent(
        db_session=db_session,
        parent_session_id=parent_session_id,
        sub_session=session,
        content=content,
        event_type=AgentEventType.SUB_SESSION_COMPLETE,
        event_payload=event_payload,
        socketio_type="SUB_SESSION_COMPLETE",
        tenant_id=tenant_id,
        redis_client=redis_client,
    )


def _summarize_partial_and_announce(
    db_session: Session,
    session: AgentSession,
    messages: list[dict[str, object]],
    tenant_id: str,
    redis_client: Any = None,
) -> None:
    """Announce sub-session timeout to the parent session."""
    task_description: str = session.task_description or "(unknown task)"
    summary = _extract_summary(messages)

    parent_session_id = session.parent_session_id
    if parent_session_id is None:
        update_session_status(db_session, session.id, AgentSessionStatus.FAILED)
        return

    update_session_status(db_session, session.id, AgentSessionStatus.FAILED)

    content = (
        f"The background task **{task_description}** timed out before finishing.\n\n"
        f"Partial result: {summary}\n\n"
        f"You can open the sub-session thread to see what was completed."
    )

    _notify_parent(
        db_session=db_session,
        parent_session_id=parent_session_id,
        sub_session=session,
        content=content,
        event_type=AgentEventType.SUB_SESSION_TIMEOUT,
        event_payload={
            "sub_session_id": str(session.id),
            "task": task_description,
            "summary": summary,
        },
        socketio_type="SUB_SESSION_TIMEOUT",
        tenant_id=tenant_id,
        redis_client=redis_client,
    )


def _announce_failure(
    db_session: Session,
    session: AgentSession,
    error_message: str,
    tenant_id: str,
    redis_client: Any = None,
) -> None:
    """Announce sub-session failure to the parent session."""
    task_description: str = session.task_description or "(unknown task)"

    parent_session_id = session.parent_session_id
    if parent_session_id is None:
        update_session_status(db_session, session.id, AgentSessionStatus.FAILED)
        return

    update_session_status(db_session, session.id, AgentSessionStatus.FAILED)

    content = (
        f"The background task **{task_description}** failed.\n\n"
        f"Error: {error_message}\n\n"
        f"You can open the sub-session thread for details, or ask me to retry."
    )

    _notify_parent(
        db_session=db_session,
        parent_session_id=parent_session_id,
        sub_session=session,
        content=content,
        event_type=AgentEventType.SUB_SESSION_FAILED,
        event_payload={
            "sub_session_id": str(session.id),
            "task": task_description,
            "error": error_message,
        },
        socketio_type="SUB_SESSION_FAILED",
        tenant_id=tenant_id,
        redis_client=redis_client,
    )


# ---------------------------------------------------------------------------
# Main Celery task: execute_sub_session
# ---------------------------------------------------------------------------


@shared_task(
    name=OnyxCeleryTask.EXECUTE_SUB_SESSION,
    soft_time_limit=600,
    time_limit=660,
    acks_late=True,
    bind=True,
    ignore_result=True,
)
def execute_sub_session(
    self: Task,
    *,
    session_id: str,
    tenant_id: str | None = None,
) -> None:
    """Execute a sub-session to completion in a background Celery worker.

    Loads the session from DB, builds an agent context in SUB_SESSION mode,
    and runs TurnDriver in a loop until completion, timeout, or failure.
    """
    resolved_tenant_id: str = tenant_id or "public"
    redis_client = get_redis_client(tenant_id=resolved_tenant_id)
    heartbeat_key = f"{_HEARTBEAT_KEY_PREFIX}:{session_id}"

    # Accumulated messages for summary extraction
    current_messages: list[dict[str, object]] = []

    with get_session_with_current_tenant() as db_session:
        # 1. Load session and validate
        session = get_session(db_session, UUID(session_id))
        if session is None:
            task_logger.warning(
                "execute_sub_session: session %s not found", session_id
            )
            return None

        if session.status != AgentSessionStatus.ACTIVE:
            task_logger.warning(
                "execute_sub_session: session %s is not ACTIVE (status=%s)",
                session_id,
                session.status,
            )
            return None

        if session.session_type not in ("SUB_ONE_SHOT", "SUB_PERSISTENT"):
            task_logger.warning(
                "execute_sub_session: session %s is not a sub-session (type=%s)",
                session_id,
                session.session_type,
            )
            return None

        # Load user
        user = db_session.scalar(
            select(User).where(User.id == session.user_id)
        )
        if user is None:
            task_logger.warning(
                "execute_sub_session: user not found for session %s",
                session_id,
            )
            _announce_failure(
                db_session, session, "User not found", resolved_tenant_id
            )
            return None

        task_description: str = session.task_description or ""
        max_turns: int = session.max_turns or _DEFAULT_MAX_TURNS

        # 2. Set Redis heartbeat
        redis_client.set(heartbeat_key, "1", ex=_HEARTBEAT_TTL_SECONDS)

        try:
            # 3. Build agent context
            from onyx.agents.bud_agent.agent_context import AgentExecutionMode
            from onyx.agents.bud_agent.agent_context import build_agent_run_context
            from onyx.agents.bud_agent.agent_context import build_message_history
            from onyx.agents.bud_agent.sub_session_emitter import AutoApproveRequester
            from onyx.agents.bud_agent.sub_session_emitter import SubSessionEmitter
            from onyx.agents.bud_agent.turn_driver import TurnDriver
            from onyx.agents.bud_agent.turn_driver import TurnDriverConfig

            ctx = build_agent_run_context(
                session_id=UUID(session_id),
                user=user,
                db_session=db_session,
                search_query=task_description,
                mode=AgentExecutionMode.SUB_SESSION,
                tenant_id=resolved_tenant_id,
                blocking_tools=False,
            )

            # 4. Persist task_description as user message and build initial messages
            add_session_message(
                db_session=db_session,
                session_id=UUID(session_id),
                role=AgentMessageRole.USER,
                content=task_description,
            )

            current_messages = build_message_history(
                db_session=db_session,
                session_id=UUID(session_id),
                system_prompt=ctx.system_prompt,
            )

            # 5. Create TurnDriver with stop-flag check
            from onyx.db.agent import is_session_stopped

            def _check_stop() -> bool:
                return is_session_stopped(redis_client, UUID(session_id))

            config = TurnDriverConfig(
                mode=AgentExecutionMode.SUB_SESSION,
                max_tool_calls=500,
                should_stop=_check_stop,
                emitter=SubSessionEmitter(
                    session_id=session_id,
                    parent_session_id=str(session.parent_session_id),
                    redis_client=redis_client,
                ),
                tool_requester=AutoApproveRequester(),
            )
            driver = TurnDriver(config=config, ctx=ctx)

            # 6. Agent loop
            turns = 0
            while turns < max_turns:
                result = _run_async(
                    driver.run_next_turn(
                        session_id=UUID(session_id),
                        db_session=db_session,
                        messages=current_messages,
                        step_number=turns,
                    )
                )

                # Update messages from turn result
                if result.turn and result.turn.final_messages:
                    current_messages = result.turn.final_messages
                turns += 1

                # Refresh heartbeat
                redis_client.set(heartbeat_key, "1", ex=_HEARTBEAT_TTL_SECONDS)

                # Publish progress event for Socket.IO bridge
                if session.parent_session_id is not None:
                    try:
                        redis_client.publish(
                            f"sub_session_events:{session.parent_session_id}",
                            json.dumps({
                                "type": "SUB_SESSION_PROGRESS",
                                "sub_session_id": session_id,
                                "task": task_description,
                                "turns_completed": turns,
                                "status": result.status,
                            }),
                        )
                    except Exception:
                        task_logger.warning(
                            "Failed to publish progress event for "
                            "sub-session %s turn %d",
                            session_id,
                            turns,
                            exc_info=True,
                        )

                # Check completion
                if result.status == "complete":
                    break

                if result.status in ("max_tools_reached", "stopped"):
                    task_logger.info(
                        "execute_sub_session: session %s ended with status=%s",
                        session_id,
                        result.status,
                    )
                    break

                if result.status == "awaiting_tool":
                    # Sub-sessions auto-approve, so this shouldn't normally
                    # happen.  If it does, treat it as completion.
                    task_logger.warning(
                        "execute_sub_session: session %s hit awaiting_tool "
                        "(unexpected in sub-session mode)",
                        session_id,
                    )
                    break

                # 7. Drain pending events for follow-ups
                events = consume_pending_events(db_session, UUID(session_id))
                for event in events:
                    if event.event_type == AgentEventType.SUB_SESSION_FOLLOW_UP.value:
                        follow_up_message: str = (
                            event.payload.get("message", "")
                            if event.payload
                            else ""
                        )
                        if follow_up_message:
                            # Persist as user message
                            add_session_message(
                                db_session=db_session,
                                session_id=UUID(session_id),
                                role=AgentMessageRole.USER,
                                content=follow_up_message,
                            )
                            current_messages.append(
                                {"role": "user", "content": follow_up_message}
                            )

            # 8. On completion: summarize and announce
            _summarize_and_announce(
                db_session, session, current_messages, resolved_tenant_id,
                redis_client=redis_client,
            )

        except SoftTimeLimitExceeded:
            # 9. On timeout: partial summary
            task_logger.warning(
                "execute_sub_session: session %s hit soft time limit",
                session_id,
            )
            _summarize_partial_and_announce(
                db_session, session, current_messages, resolved_tenant_id,
                redis_client=redis_client,
            )

        except Exception as e:
            # 10. On error: announce failure
            task_logger.exception(
                "execute_sub_session: session %s failed with error",
                session_id,
            )
            _announce_failure(
                db_session, session, str(e), resolved_tenant_id,
                redis_client=redis_client,
            )

        finally:
            # 11. Clear Redis heartbeat
            redis_client.delete(heartbeat_key)

    return None


# ---------------------------------------------------------------------------
# Periodic task: reap_zombie_sub_sessions
# ---------------------------------------------------------------------------


@shared_task(
    name=OnyxCeleryTask.REAP_ZOMBIE_SUB_SESSIONS,
    soft_time_limit=120,
    bind=True,
    ignore_result=True,
)
def reap_zombie_sub_sessions(
    self: Task,
    *,
    tenant_id: str,
) -> None:
    """Detect and clean up zombie sub-sessions.

    A zombie sub-session is one that is ACTIVE with session_type
    SUB_ONE_SHOT or SUB_PERSISTENT, updated_at older than 15 minutes,
    and no corresponding Redis heartbeat key.

    Runs every 60 seconds via Celery Beat.
    """
    task_logger.info("reap_zombie_sub_sessions - Starting")

    redis_client = get_redis_client(tenant_id=tenant_id)
    lock: RedisLock = redis_client.lock(
        OnyxRedisLocks.REAP_ZOMBIE_SUB_SESSIONS_LOCK,
        timeout=CELERY_GENERIC_BEAT_LOCK_TIMEOUT,
    )

    if not lock.acquire(blocking=False):
        return None

    reaped = 0
    try:
        with get_session_with_current_tenant() as db_session:
            zombies = get_zombie_sub_sessions(db_session, stale_minutes=15)

            for zombie in zombies:
                heartbeat_key = f"{_HEARTBEAT_KEY_PREFIX}:{zombie.id}"
                if redis_client.exists(heartbeat_key):
                    # Still alive, skip
                    continue

                task_logger.warning(
                    "Reaping zombie sub-session %s (updated_at=%s)",
                    zombie.id,
                    zombie.updated_at,
                )

                # Mark as INACTIVE (not FAILED — the session may just be idle)
                update_session_status(
                    db_session, zombie.id, AgentSessionStatus.INACTIVE
                )

                # Announce failure to parent
                parent_session_id = zombie.parent_session_id
                if parent_session_id is not None:
                    task_description: str = zombie.task_description or "(unknown task)"

                    enqueue_session_event(
                        db_session=db_session,
                        session_id=parent_session_id,
                        event_type=AgentEventType.SUB_SESSION_FAILED,
                        payload={
                            "sub_session_id": str(zombie.id),
                            "task": task_description,
                            "error": "Sub-session timed out (no heartbeat)",
                        },
                    )

                    add_session_message(
                        db_session=db_session,
                        session_id=parent_session_id,
                        role=AgentMessageRole.SYSTEM,
                        content=(
                            f"[Sub-session failed] Task: {task_description}. "
                            f"Error: Sub-session timed out (no heartbeat)"
                        ),
                    )

                    # Publish Redis event
                    try:
                        redis_client.publish(
                            f"sub_session_events:{parent_session_id}",
                            json.dumps({
                                "type": "SUB_SESSION_FAILED",
                                "sub_session_id": str(zombie.id),
                                "task": task_description,
                                "error": "Sub-session timed out (no heartbeat)",
                            }),
                        )
                    except Exception:
                        task_logger.warning(
                            "Failed to publish zombie reap event for session %s",
                            zombie.id,
                            exc_info=True,
                        )

                reaped += 1

    finally:
        if lock.owned():
            lock.release()

    if reaped > 0:
        task_logger.info(
            "reap_zombie_sub_sessions - Reaped %d zombie sub-sessions",
            reaped,
        )

    return None


# ---------------------------------------------------------------------------
# Periodic task: expire_persistent_sub_sessions
# ---------------------------------------------------------------------------


@shared_task(
    name=OnyxCeleryTask.EXPIRE_PERSISTENT_SUB_SESSIONS,
    soft_time_limit=120,
    bind=True,
    ignore_result=True,
)
def expire_persistent_sub_sessions(
    self: Task,
    *,
    tenant_id: str | None = None,
) -> None:
    """Notify parent sessions when persistent sub-sessions have expired.

    A SUB_PERSISTENT session is considered expired when it has been in
    COMPLETED status for longer than ``PERSISTENT_SUB_SESSION_EXPIRY_SECONDS``
    (default 1 hour).

    For each expired session, we:
    1. Check a Redis key to avoid sending duplicate notifications.
    2. Enqueue a SUB_SESSION_EXPIRED event to the parent session.
    3. Inject a system message into the parent session.
    4. Mark the session as notified via a Redis key with a long TTL.

    The session status is NOT changed (it remains COMPLETED).

    Runs every 5 minutes via Celery Beat.
    """
    resolved_tenant_id: str = tenant_id or "public"
    task_logger.info("expire_persistent_sub_sessions - Starting")

    redis_client = get_redis_client(tenant_id=resolved_tenant_id)
    lock: RedisLock = redis_client.lock(
        OnyxRedisLocks.EXPIRE_PERSISTENT_SUB_SESSIONS_LOCK,
        timeout=CELERY_GENERIC_BEAT_LOCK_TIMEOUT,
    )

    if not lock.acquire(blocking=False):
        return None

    notified = 0
    try:
        with get_session_with_current_tenant() as db_session:
            expired_sessions = get_expired_persistent_sub_sessions(
                db_session,
                expiry_seconds=PERSISTENT_SUB_SESSION_EXPIRY_SECONDS,
            )

            for session in expired_sessions:
                # Check if we already sent a notification for this session
                notified_key = (
                    f"{_EXPIRED_NOTIFIED_KEY_PREFIX}:{session.id}"
                )
                if redis_client.exists(notified_key):
                    continue

                parent_session_id = session.parent_session_id
                if parent_session_id is None:
                    # No parent to notify; mark as notified to avoid
                    # re-processing on every sweep.
                    redis_client.set(
                        notified_key, "1", ex=_EXPIRED_NOTIFIED_TTL_SECONDS
                    )
                    continue

                task_description: str = (
                    session.task_description or "(unknown task)"
                )

                task_logger.info(
                    "Sending expiry notification for persistent "
                    "sub-session %s (completed_at=%s)",
                    session.id,
                    session.completed_at,
                )

                # Mark session as INACTIVE
                update_session_status(
                    db_session, session.id, AgentSessionStatus.INACTIVE
                )

                # 1. Enqueue event to parent
                enqueue_session_event(
                    db_session=db_session,
                    session_id=parent_session_id,
                    event_type=AgentEventType.SUB_SESSION_EXPIRED,
                    payload={
                        "sub_session_id": str(session.id),
                        "task": task_description,
                        "message": (
                            f"Persistent session '{task_description}' "
                            f"has expired due to inactivity."
                        ),
                    },
                )

                # 2. Inject system message into parent session
                add_session_message(
                    db_session=db_session,
                    session_id=parent_session_id,
                    role=AgentMessageRole.SYSTEM,
                    content=(
                        f"[Sub-session expired] Persistent session "
                        f"'{task_description}' has expired due to "
                        f"inactivity after "
                        f"{PERSISTENT_SUB_SESSION_EXPIRY_SECONDS} seconds."
                    ),
                )

                # 3. Publish Redis event for Socket.IO notification
                try:
                    redis_client.publish(
                        f"sub_session_events:{parent_session_id}",
                        json.dumps({
                            "type": "SUB_SESSION_EXPIRED",
                            "sub_session_id": str(session.id),
                            "task": task_description,
                            "message": (
                                f"Persistent session '{task_description}' "
                                f"has expired due to inactivity."
                            ),
                        }),
                    )
                except Exception:
                    task_logger.warning(
                        "Failed to publish expiry event for session %s",
                        session.id,
                        exc_info=True,
                    )

                # 4. Mark as notified so we don't re-send
                redis_client.set(
                    notified_key, "1", ex=_EXPIRED_NOTIFIED_TTL_SECONDS
                )

                notified += 1

    finally:
        if lock.owned():
            lock.release()

    if notified > 0:
        task_logger.info(
            "expire_persistent_sub_sessions - Notified %d expired sessions",
            notified,
        )

    return None
