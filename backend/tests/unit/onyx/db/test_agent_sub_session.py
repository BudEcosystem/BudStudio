"""Unit tests for sub-session DB functions in onyx.db.agent.

Mocks the SQLAlchemy Session so no database is required.
Tests cover create_sub_session, count_active_sub_sessions,
get_sub_sessions_for_parent, and repoint_sub_sessions_parent.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock
from unittest.mock import call
from uuid import UUID
from uuid import uuid4

import pytest

from onyx.db.enums import AgentSessionStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_USER_ID: UUID = uuid4()
_PARENT_SESSION_ID: UUID = uuid4()


class FakeSession:
    """Lightweight stand-in for the AgentSession ORM model."""

    def __init__(self, **kwargs: Any) -> None:
        self.id: UUID = uuid4()
        for k, v in kwargs.items():
            setattr(self, k, v)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_db() -> MagicMock:
    """Return a MagicMock acting as a SQLAlchemy Session."""
    db = MagicMock()
    db.commit.return_value = None
    db.refresh.return_value = None
    return db


# ---------------------------------------------------------------------------
# Tests — create_sub_session
# ---------------------------------------------------------------------------


class TestCreateSubSession:
    """create_sub_session sets the correct session_type and parent."""

    def test_create_sub_session_sets_correct_type_and_parent(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import create_sub_session

        # Capture whatever is passed to db_session.add()
        added_objects: list[Any] = []

        def _add(obj: Any) -> None:
            # Give the ORM object an id so refresh works
            obj.id = uuid4()
            added_objects.append(obj)

        mock_db.add.side_effect = _add

        result = create_sub_session(
            db_session=mock_db,
            user_id=_USER_ID,
            parent_session_id=_PARENT_SESSION_ID,
            task_description="Run security audit",
            task_context="Check all endpoints",
            session_type="SUB_ONE_SHOT",
            max_context_tokens=8000,
            max_turns=5,
        )

        # Verify add was called with an AgentSession
        assert len(added_objects) == 1
        created = added_objects[0]
        assert created.session_type == "SUB_ONE_SHOT"
        assert created.parent_session_id == _PARENT_SESSION_ID
        assert created.user_id == _USER_ID
        assert created.task_description == "Run security audit"
        assert created.description == "Check all endpoints"
        assert created.max_context_tokens == 8000
        assert created.max_turns == 5
        assert created.status == AgentSessionStatus.ACTIVE
        # Title is truncated to 255 chars
        assert created.title == "Run security audit"

        mock_db.commit.assert_called_once()
        mock_db.refresh.assert_called_once()

    def test_create_sub_session_truncates_long_title(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import create_sub_session

        added_objects: list[Any] = []

        def _add(obj: Any) -> None:
            obj.id = uuid4()
            added_objects.append(obj)

        mock_db.add.side_effect = _add

        long_desc = "x" * 500

        create_sub_session(
            db_session=mock_db,
            user_id=_USER_ID,
            parent_session_id=_PARENT_SESSION_ID,
            task_description=long_desc,
        )

        assert len(added_objects) == 1
        assert len(added_objects[0].title) == 255

    def test_create_sub_session_persistent_type(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import create_sub_session

        added_objects: list[Any] = []

        def _add(obj: Any) -> None:
            obj.id = uuid4()
            added_objects.append(obj)

        mock_db.add.side_effect = _add

        create_sub_session(
            db_session=mock_db,
            user_id=_USER_ID,
            parent_session_id=_PARENT_SESSION_ID,
            task_description="Monitor logs",
            session_type="SUB_PERSISTENT",
        )

        assert added_objects[0].session_type == "SUB_PERSISTENT"


# ---------------------------------------------------------------------------
# Tests — count_active_sub_sessions
# ---------------------------------------------------------------------------


class TestCountActiveSubSessions:
    """count_active_sub_sessions counts only SUB_* session types."""

    def test_count_active_sub_sessions_counts_only_sub_types(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import count_active_sub_sessions

        # The function executes SELECT id ... FOR UPDATE and counts rows
        mock_db.execute.return_value.all.return_value = [
            (uuid4(),),
            (uuid4(),),
            (uuid4(),),
        ]

        count = count_active_sub_sessions(mock_db, _USER_ID)

        assert count == 3
        mock_db.execute.assert_called_once()

    def test_count_active_sub_sessions_returns_zero_on_none(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import count_active_sub_sessions

        # No matching rows → empty list
        mock_db.execute.return_value.all.return_value = []

        count = count_active_sub_sessions(mock_db, _USER_ID)

        assert count == 0


# ---------------------------------------------------------------------------
# Tests — get_sub_sessions_for_parent
# ---------------------------------------------------------------------------


class TestGetSubSessionsForParent:
    """get_sub_sessions_for_parent returns sessions ordered newest first."""

    def test_returns_sessions_for_parent(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import get_sub_sessions_for_parent

        fake_sessions = [
            FakeSession(session_type="SUB_ONE_SHOT"),
            FakeSession(session_type="SUB_PERSISTENT"),
        ]

        scalars_mock = MagicMock()
        scalars_mock.all.return_value = fake_sessions
        mock_db.execute.return_value.scalars.return_value = scalars_mock

        result = get_sub_sessions_for_parent(mock_db, _PARENT_SESSION_ID)

        assert len(result) == 2
        assert result[0].session_type == "SUB_ONE_SHOT"
        assert result[1].session_type == "SUB_PERSISTENT"
        mock_db.execute.assert_called_once()


# ---------------------------------------------------------------------------
# Tests — repoint_sub_sessions_parent
# ---------------------------------------------------------------------------


class TestRepointSubSessionsParent:
    """repoint_sub_sessions_parent issues an UPDATE and returns rowcount."""

    def test_repoint_sub_sessions_parent_updates_active_children(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import repoint_sub_sessions_parent

        old_parent_id = uuid4()
        new_parent_id = uuid4()

        # Simulate 2 rows updated
        mock_db.execute.return_value.rowcount = 2

        result = repoint_sub_sessions_parent(
            mock_db, old_parent_id, new_parent_id
        )

        assert result == 2
        mock_db.execute.assert_called_once()
        mock_db.commit.assert_called_once()

    def test_repoint_returns_zero_when_no_children(
        self, mock_db: MagicMock
    ) -> None:
        from onyx.db.agent import repoint_sub_sessions_parent

        mock_db.execute.return_value.rowcount = 0

        result = repoint_sub_sessions_parent(mock_db, uuid4(), uuid4())

        assert result == 0
        mock_db.commit.assert_called_once()
