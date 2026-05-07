"""Database operations for agent session events.

Events drive the multi-session event loop.  Sub-session completions,
user messages, cron results, inbox escalations, and API triggers are
all enqueued as rows in the ``agent_session_event`` table and consumed
by the orchestrator in priority order.
"""

import datetime
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.orm import Session

from onyx.db.enums import AgentEventType
from onyx.db.models import AgentSessionEvent


def enqueue_session_event(
    db_session: Session,
    session_id: UUID,
    event_type: AgentEventType,
    payload: dict[str, object] | None = None,
    priority: int = 0,
    ttl_seconds: int | None = None,
) -> AgentSessionEvent:
    """Create a new pending event for *session_id*.

    Lower *priority* values are consumed first (0 = highest).
    If *ttl_seconds* is set, ``expire_stale_events`` will mark the
    event as ``expired`` once it has lived past that duration.
    """
    event = AgentSessionEvent(
        session_id=session_id,
        event_type=event_type.value,
        payload=payload,
        priority=priority,
        ttl_seconds=ttl_seconds,
        status="pending",
    )
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    return event


def consume_pending_events(
    db_session: Session,
    session_id: UUID,
) -> list[AgentSessionEvent]:
    """Atomically claim all pending events for *session_id*.

    Uses ``FOR UPDATE SKIP LOCKED`` so concurrent consumers never
    process the same event.  Events are returned ordered by
    ``(priority ASC, created_at ASC)`` (lowest priority number first,
    oldest first within the same priority).
    """
    stmt = (
        select(AgentSessionEvent)
        .where(
            AgentSessionEvent.session_id == session_id,
            AgentSessionEvent.status == "pending",
        )
        .order_by(
            AgentSessionEvent.priority.asc(),
            AgentSessionEvent.created_at.asc(),
        )
        .with_for_update(skip_locked=True)
    )
    events = list(db_session.execute(stmt).scalars().all())

    now = datetime.datetime.now(datetime.timezone.utc)
    for event in events:
        event.status = "consumed"
        event.consumed_at = now

    db_session.commit()
    for event in events:
        db_session.refresh(event)
    return events


def mark_event_consumed(
    db_session: Session,
    event_id: UUID,
) -> None:
    """Mark a single event as consumed."""
    stmt = (
        update(AgentSessionEvent)
        .where(AgentSessionEvent.id == event_id)
        .values(
            status="consumed",
            consumed_at=datetime.datetime.now(datetime.timezone.utc),
        )
    )
    db_session.execute(stmt)
    db_session.commit()


def expire_stale_events(
    db_session: Session,
) -> int:
    """Mark pending events whose TTL has elapsed as ``expired``.

    Returns the number of events expired.
    """
    now = datetime.datetime.now(datetime.timezone.utc)

    # Find pending events that have a ttl_seconds and have exceeded it
    stmt = (
        select(AgentSessionEvent)
        .where(
            AgentSessionEvent.status == "pending",
            AgentSessionEvent.ttl_seconds.isnot(None),
        )
    )
    events = list(db_session.execute(stmt).scalars().all())

    count = 0
    for event in events:
        assert event.ttl_seconds is not None  # guarded by query filter
        expiry = event.created_at + datetime.timedelta(seconds=event.ttl_seconds)
        if now >= expiry:
            event.status = "expired"
            count += 1

    db_session.commit()
    return count


def cleanup_old_events(
    db_session: Session,
    days: int = 7,
) -> int:
    """Delete consumed/expired events older than *days*.

    Returns the number of rows deleted.
    """
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        days=days
    )
    stmt = (
        delete(AgentSessionEvent)
        .where(
            AgentSessionEvent.status.in_(["consumed", "expired"]),
            AgentSessionEvent.created_at < cutoff,
        )
    )
    result = db_session.execute(stmt)
    db_session.commit()
    return result.rowcount  # type: ignore[return-value]
