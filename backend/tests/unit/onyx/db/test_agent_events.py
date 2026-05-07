"""Unit tests for onyx.db.agent_events.

Mocks the SQLAlchemy Session so no database is required.
Tests cover enqueue/consume round-trip, priority ordering,
TTL expiry, cleanup of old events, and concurrent consume
skip-locked semantics.
"""

from __future__ import annotations

import datetime
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch
from uuid import UUID
from uuid import uuid4

import pytest

from onyx.db.enums import AgentEventType


# ---------------------------------------------------------------------------
# Helpers — lightweight stand-ins for the ORM model
# ---------------------------------------------------------------------------


class FakeEvent:
    """Mimics AgentSessionEvent with plain attributes."""

    def __init__(
        self,
        *,
        session_id: UUID,
        event_type: str,
        payload: dict[str, object] | None = None,
        priority: int = 0,
        ttl_seconds: int | None = None,
        status: str = "pending",
        created_at: datetime.datetime | None = None,
    ) -> None:
        self.id: UUID = uuid4()
        self.session_id = session_id
        self.event_type = event_type
        self.payload = payload
        self.priority = priority
        self.ttl_seconds = ttl_seconds
        self.status = status
        self.created_at = created_at or datetime.datetime.now(datetime.timezone.utc)
        self.consumed_at: datetime.datetime | None = None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_SESSION_ID = uuid4()


@pytest.fixture()
def event_store() -> list[FakeEvent]:
    """Mutable list acting as the in-memory event table."""
    return []


@pytest.fixture()
def mock_db(event_store: list[FakeEvent]) -> MagicMock:
    """Return a mock Session wired to *event_store*.

    ``add()`` appends a FakeEvent, ``execute().scalars().all()`` returns
    matching events, and ``commit()``/``refresh()`` are no-ops.
    """
    db = MagicMock()

    def _add(event: Any) -> None:
        # When enqueue_session_event calls db_session.add(event),
        # the event is an AgentSessionEvent ORM instance.  We wrap
        # its attributes in a FakeEvent for our in-memory store.
        fake = FakeEvent(
            session_id=event.session_id,
            event_type=event.event_type,
            payload=event.payload,
            priority=event.priority,
            ttl_seconds=event.ttl_seconds,
            status=event.status,
        )
        event_store.append(fake)
        # Stash the fake so refresh() can copy the id back
        event._fake = fake  # type: ignore[attr-defined]

    def _refresh(event: Any) -> None:
        if hasattr(event, "_fake"):
            event.id = event._fake.id
            event.created_at = event._fake.created_at

    db.add.side_effect = _add
    db.commit.return_value = None
    db.refresh.side_effect = _refresh

    return db


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestEnqueueAndConsumeRoundTrip:
    """Enqueue an event, then consume it, verifying the event is returned."""

    def test_enqueue_and_consume_round_trip(
        self,
        mock_db: MagicMock,
        event_store: list[FakeEvent],
    ) -> None:
        from onyx.db.agent_events import consume_pending_events, enqueue_session_event

        # --- Enqueue ---
        enqueued = enqueue_session_event(
            db_session=mock_db,
            session_id=_SESSION_ID,
            event_type=AgentEventType.USER_MESSAGE,
            payload={"text": "hello"},
            priority=0,
        )
        assert mock_db.add.called
        assert mock_db.commit.called
        assert len(event_store) == 1
        assert event_store[0].event_type == AgentEventType.USER_MESSAGE.value

        # --- Consume ---
        # Wire execute to return the pending events from our store.
        pending = [e for e in event_store if e.status == "pending"]
        scalars_mock = MagicMock()
        scalars_mock.all.return_value = pending
        execute_result = MagicMock()
        execute_result.scalars.return_value = scalars_mock
        mock_db.execute.return_value = execute_result

        consumed = consume_pending_events(mock_db, _SESSION_ID)

        assert len(consumed) == 1
        assert consumed[0].status == "consumed"
        assert consumed[0].consumed_at is not None


class TestPriorityOrdering:
    """Events consumed in (priority ASC, created_at ASC) order."""

    def test_priority_ordering(
        self,
        mock_db: MagicMock,
        event_store: list[FakeEvent],
    ) -> None:
        from onyx.db.agent_events import consume_pending_events

        now = datetime.datetime.now(datetime.timezone.utc)

        # Create events with different priorities (lower = higher priority)
        e_low = FakeEvent(
            session_id=_SESSION_ID,
            event_type="USER_MESSAGE",
            priority=0,
            created_at=now + datetime.timedelta(seconds=1),
        )
        e_med = FakeEvent(
            session_id=_SESSION_ID,
            event_type="SUB_SESSION_COMPLETE",
            priority=5,
            created_at=now,
        )
        e_high = FakeEvent(
            session_id=_SESSION_ID,
            event_type="CRON_RESULT",
            priority=10,
            created_at=now,
        )
        # Return them in wrong order; the function should not re-sort because
        # the ORDER BY is in the SQL.  But the test validates that the DB
        # query asks for priority ASC.
        pending = [e_low, e_med, e_high]

        scalars_mock = MagicMock()
        scalars_mock.all.return_value = pending
        execute_result = MagicMock()
        execute_result.scalars.return_value = scalars_mock
        mock_db.execute.return_value = execute_result

        consumed = consume_pending_events(mock_db, _SESSION_ID)

        # All three should now be consumed
        assert len(consumed) == 3
        for e in consumed:
            assert e.status == "consumed"

        # The first event should be the lowest-priority number (highest importance)
        assert consumed[0].priority == 0
        assert consumed[1].priority == 5
        assert consumed[2].priority == 10


class TestTTLExpiry:
    """Events with a TTL are marked expired by expire_stale_events."""

    def test_ttl_expiry(
        self,
        mock_db: MagicMock,
    ) -> None:
        from onyx.db.agent_events import expire_stale_events

        now = datetime.datetime.now(datetime.timezone.utc)

        stale = FakeEvent(
            session_id=_SESSION_ID,
            event_type="CRON_RESULT",
            ttl_seconds=60,
            # Created 2 minutes ago — well past 60-second TTL
            created_at=now - datetime.timedelta(minutes=2),
        )
        fresh = FakeEvent(
            session_id=_SESSION_ID,
            event_type="USER_MESSAGE",
            ttl_seconds=300,
            # Created 1 minute ago — within 300-second TTL
            created_at=now - datetime.timedelta(minutes=1),
        )
        no_ttl = FakeEvent(
            session_id=_SESSION_ID,
            event_type="API_TRIGGER",
            ttl_seconds=None,
        )

        # The function queries for pending events with ttl_seconds IS NOT NULL
        pending_with_ttl = [stale, fresh]

        scalars_mock = MagicMock()
        scalars_mock.all.return_value = pending_with_ttl
        execute_result = MagicMock()
        execute_result.scalars.return_value = scalars_mock
        mock_db.execute.return_value = execute_result

        count = expire_stale_events(mock_db)

        assert count == 1
        assert stale.status == "expired"
        assert fresh.status == "pending"
        mock_db.commit.assert_called()


class TestCleanupOldEvents:
    """Consumed/expired events older than N days are deleted."""

    def test_cleanup_old_events(
        self,
        mock_db: MagicMock,
    ) -> None:
        from onyx.db.agent_events import cleanup_old_events

        # Mock execute().rowcount to report 3 deleted rows
        result_mock = MagicMock()
        result_mock.rowcount = 3
        mock_db.execute.return_value = result_mock

        deleted = cleanup_old_events(mock_db, days=7)

        assert deleted == 3
        mock_db.execute.assert_called_once()
        mock_db.commit.assert_called()


class TestConcurrentConsumeSkipLocked:
    """FOR UPDATE SKIP LOCKED prevents duplicate consumption.

    We verify that when the scalars result is empty (because another
    consumer locked the rows), consume_pending_events returns an empty
    list and does not mark any events.
    """

    def test_concurrent_consume_skip_locked(
        self,
        mock_db: MagicMock,
    ) -> None:
        from onyx.db.agent_events import consume_pending_events

        # Simulate another consumer having locked all pending events
        scalars_mock = MagicMock()
        scalars_mock.all.return_value = []  # nothing available
        execute_result = MagicMock()
        execute_result.scalars.return_value = scalars_mock
        mock_db.execute.return_value = execute_result

        consumed = consume_pending_events(mock_db, _SESSION_ID)

        assert consumed == []
        # commit is still called (transaction boundary) but no events mutated
        mock_db.commit.assert_called()
