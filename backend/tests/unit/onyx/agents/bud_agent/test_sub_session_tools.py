"""Unit tests for sub-session tool service functions.

Tests cover all six service functions in
``onyx.agents.bud_agent.sub_session_tools``:

- spawn_sub_session
- list_sub_sessions
- inspect_sub_session
- get_sub_session_result
- cancel_sub_session
- send_to_sub_session

Plus the private helpers ``_short_label`` and ``_is_persistent_session_expired``.

All external dependencies (DB, Redis, Celery, Socket.IO) are mocked.
"""

from __future__ import annotations

import sys
from datetime import datetime
from datetime import timedelta
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch
from uuid import UUID
from uuid import uuid4

import pytest

from onyx.db.enums import AgentSessionStatus
from onyx.db.enums import AgentSessionExecutionStatus

# ---------------------------------------------------------------------------
# Celery client stub: spawn_sub_session and send_to_sub_session do a lazy
# import of ``onyx.background.celery.apps.client.celery_app``.  In unit-test
# environments the Celery broker isn't available, so we inject a mock module
# into sys.modules before any test imports it.
# ---------------------------------------------------------------------------

_mock_celery_client_module = MagicMock()
sys.modules.setdefault(
    "onyx.background.celery.apps.client", _mock_celery_client_module
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_USER_ID: UUID = uuid4()
_PARENT_SESSION_ID: UUID = uuid4()
_TENANT_ID = "public"


# ---------------------------------------------------------------------------
# Fake ORM objects
# ---------------------------------------------------------------------------


class FakeMessage:
    """Lightweight stand-in for AgentSessionMessage ORM model."""

    def __init__(self, role: str, content: str | None = None, **kwargs: Any) -> None:
        self.role = MagicMock(value=role)
        self.content = content
        self.tool_name: str | None = kwargs.get("tool_name")
        self.tool_output: str | None = kwargs.get("tool_output")
        self.tool_error: str | None = kwargs.get("tool_error")


class FakeSession:
    """Lightweight stand-in for AgentSession ORM model."""

    def __init__(self, **kwargs: Any) -> None:
        self.id: UUID = kwargs.get("id", uuid4())
        self.user_id: UUID = kwargs.get("user_id", _USER_ID)
        self.parent_session_id: UUID | None = kwargs.get(
            "parent_session_id", _PARENT_SESSION_ID
        )
        self.task_description: str | None = kwargs.get("task_description", "test task")
        self.title: str | None = kwargs.get("title", "test task")
        self.status: AgentSessionStatus = kwargs.get(
            "status", AgentSessionStatus.ACTIVE
        )
        self.execution_status: AgentSessionExecutionStatus | None = kwargs.get(
            "execution_status", AgentSessionExecutionStatus.IDLE
        )
        self.session_type: str = kwargs.get("session_type", "SUB_ONE_SHOT")
        self.max_turns: int | None = kwargs.get("max_turns", 10)
        self.total_tokens_used: int = kwargs.get("total_tokens_used", 0)
        self.total_tool_calls: int = kwargs.get("total_tool_calls", 0)
        self.created_at: datetime | None = kwargs.get("created_at", datetime.utcnow())
        self.updated_at: datetime | None = kwargs.get("updated_at", datetime.utcnow())
        self.completed_at: datetime | None = kwargs.get("completed_at")
        self.messages: list[FakeMessage] = kwargs.get("messages", [])


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


@pytest.fixture()
def mock_redis() -> MagicMock:
    """Return a MagicMock acting as a Redis client."""
    return MagicMock()


# ---------------------------------------------------------------------------
# Tests — _short_label
# ---------------------------------------------------------------------------


class TestShortLabel:
    """_short_label truncates text to first N words."""

    def test_empty_string(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import _short_label

        assert _short_label("") == ""

    def test_short_text_unchanged(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import _short_label

        assert _short_label("hello world") == "hello world"

    def test_exactly_max_words(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import _short_label

        text = "one two three four five"
        assert _short_label(text, max_words=5) == text

    def test_truncates_beyond_max_words(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import _short_label

        text = "one two three four five six seven"
        assert _short_label(text, max_words=3) == "one two three..."

    def test_custom_max_words(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import _short_label

        text = "a b c d e f g"
        assert _short_label(text, max_words=2) == "a b..."


# ---------------------------------------------------------------------------
# Tests — _is_persistent_session_expired
# ---------------------------------------------------------------------------


class TestIsPersistentSessionExpired:
    """_is_persistent_session_expired checks expiry for SUB_PERSISTENT sessions."""

    def test_non_persistent_returns_false(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            _is_persistent_session_expired,
        )

        session = FakeSession(session_type="SUB_ONE_SHOT")
        assert _is_persistent_session_expired(session) is False  # type: ignore[arg-type]

    def test_not_completed_returns_false(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            _is_persistent_session_expired,
        )

        session = FakeSession(
            session_type="SUB_PERSISTENT",
            status=AgentSessionStatus.ACTIVE,
        )
        assert _is_persistent_session_expired(session) is False  # type: ignore[arg-type]

    def test_no_completed_at_returns_false(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            _is_persistent_session_expired,
        )

        session = FakeSession(
            session_type="SUB_PERSISTENT",
            status=AgentSessionStatus.COMPLETED,
            completed_at=None,
        )
        assert _is_persistent_session_expired(session) is False  # type: ignore[arg-type]

    def test_recently_completed_returns_false(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            _is_persistent_session_expired,
        )

        session = FakeSession(
            session_type="SUB_PERSISTENT",
            status=AgentSessionStatus.COMPLETED,
            completed_at=datetime.utcnow() - timedelta(minutes=5),
        )
        assert _is_persistent_session_expired(session) is False  # type: ignore[arg-type]

    def test_expired_returns_true(self) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            PERSISTENT_SUB_SESSION_EXPIRY_SECONDS,
            _is_persistent_session_expired,
        )

        session = FakeSession(
            session_type="SUB_PERSISTENT",
            status=AgentSessionStatus.COMPLETED,
            completed_at=datetime.utcnow()
            - timedelta(seconds=PERSISTENT_SUB_SESSION_EXPIRY_SECONDS + 60),
        )
        assert _is_persistent_session_expired(session) is True  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Tests — spawn_sub_session
# ---------------------------------------------------------------------------


class TestSpawnSubSession:
    """spawn_sub_session creates a sub-session and dispatches Celery task."""

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_accepted(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session

        mock_count.return_value = 0
        created_session = FakeSession(id=uuid4())
        mock_create.return_value = created_session
        _mock_celery_client_module.celery_app.reset_mock()

        result = spawn_sub_session(
            db_session=mock_db,
            user_id=_USER_ID,
            parent_session_id=_PARENT_SESSION_ID,
            task="Run security audit",
            tenant_id=_TENANT_ID,
        )

        assert result["status"] == "accepted"
        assert result["session_id"] == str(created_session.id)
        mock_count.assert_called_once_with(mock_db, _USER_ID)
        mock_create.assert_called_once()
        _mock_celery_client_module.celery_app.send_task.assert_called_once()

    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_rejected_concurrency_limit(
        self,
        mock_count: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            _DEFAULT_CONCURRENCY_LIMIT,
            spawn_sub_session,
        )

        mock_count.return_value = _DEFAULT_CONCURRENCY_LIMIT

        result = spawn_sub_session(
            db_session=mock_db,
            user_id=_USER_ID,
            parent_session_id=_PARENT_SESSION_ID,
            task="This should be rejected",
            tenant_id=_TENANT_ID,
        )

        assert result["status"] == "rejected"
        assert result["reason"] == "concurrency_limit"
        assert result["active_count"] == _DEFAULT_CONCURRENCY_LIMIT
        assert result["limit"] == _DEFAULT_CONCURRENCY_LIMIT

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_truncates_long_context(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            _MAX_CONTEXT_CHARS,
            spawn_sub_session,
        )

        mock_count.return_value = 0
        mock_create.return_value = FakeSession()

        long_context = "x" * (_MAX_CONTEXT_CHARS + 1000)

        spawn_sub_session(
                db_session=mock_db,
                user_id=_USER_ID,
                parent_session_id=_PARENT_SESSION_ID,
                task="Test",
                task_context=long_context,
                tenant_id=_TENANT_ID,
            )

        # Verify create_sub_session was called with truncated context
        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["task_context"] is not None
        assert len(call_kwargs["task_context"]) < len(long_context)
        assert call_kwargs["task_context"].endswith("... (truncated)")

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_mode_persistent(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session

        mock_count.return_value = 0
        mock_create.return_value = FakeSession()

        spawn_sub_session(
                db_session=mock_db,
                user_id=_USER_ID,
                parent_session_id=_PARENT_SESSION_ID,
                task="Monitor logs",
                mode="persistent",
                tenant_id=_TENANT_ID,
            )

        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["session_type"] == "SUB_PERSISTENT"

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_mode_one_shot(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session

        mock_count.return_value = 0
        mock_create.return_value = FakeSession()

        spawn_sub_session(
                db_session=mock_db,
                user_id=_USER_ID,
                parent_session_id=_PARENT_SESSION_ID,
                task="Quick task",
                mode="one_shot",
                tenant_id=_TENANT_ID,
            )

        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["session_type"] == "SUB_ONE_SHOT"

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_custom_task_name(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session

        mock_count.return_value = 0
        mock_create.return_value = FakeSession()

        spawn_sub_session(
                db_session=mock_db,
                user_id=_USER_ID,
                parent_session_id=_PARENT_SESSION_ID,
                task="A very long task description with many words",
                task_name="Security Audit",
                tenant_id=_TENANT_ID,
            )

        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["title"] == "Security Audit"

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_auto_derived_title(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session

        mock_count.return_value = 0
        mock_create.return_value = FakeSession()

        spawn_sub_session(
                db_session=mock_db,
                user_id=_USER_ID,
                parent_session_id=_PARENT_SESSION_ID,
                task="Analyze the code quality of the authentication module thoroughly",
                tenant_id=_TENANT_ID,
            )

        call_kwargs = mock_create.call_args[1]
        # _short_label defaults to 5 words
        assert call_kwargs["title"] == "Analyze the code quality of..."

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_passes_max_turns(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session

        mock_count.return_value = 0
        mock_create.return_value = FakeSession()

        spawn_sub_session(
                db_session=mock_db,
                user_id=_USER_ID,
                parent_session_id=_PARENT_SESSION_ID,
                task="Quick check",
                max_turns=3,
                tenant_id=_TENANT_ID,
            )

        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["max_turns"] == 3

    @patch("onyx.agents.bud_agent.sub_session_tools.create_sub_session")
    @patch("onyx.agents.bud_agent.sub_session_tools.count_active_sub_sessions")
    def test_spawn_none_context_not_truncated(
        self,
        mock_count: MagicMock,
        mock_create: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session

        mock_count.return_value = 0
        mock_create.return_value = FakeSession()

        spawn_sub_session(
                db_session=mock_db,
                user_id=_USER_ID,
                parent_session_id=_PARENT_SESSION_ID,
                task="No context task",
                task_context=None,
                tenant_id=_TENANT_ID,
            )

        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["task_context"] is None


# ---------------------------------------------------------------------------
# Tests — list_sub_sessions
# ---------------------------------------------------------------------------


class TestListSubSessions:
    """list_sub_sessions formats and filters sessions from the parent."""

    @patch("onyx.agents.bud_agent.sub_session_tools.get_sub_sessions_for_parent")
    def test_returns_formatted_list(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import list_sub_sessions

        session_id = uuid4()
        mock_get.return_value = [
            FakeSession(
                id=session_id,
                task_description="Run audit",
                title="Run audit",
                status=AgentSessionStatus.COMPLETED,
                execution_status=AgentSessionExecutionStatus.IDLE,
                session_type="SUB_ONE_SHOT",
                total_tokens_used=500,
                total_tool_calls=3,
                messages=[
                    FakeMessage("USER", "hello"),
                    FakeMessage("ASSISTANT", "hi"),
                    FakeMessage("USER", "thanks"),
                ],
            ),
        ]

        result = list_sub_sessions(mock_db, _PARENT_SESSION_ID)

        assert len(result) == 1
        assert result[0]["session_id"] == str(session_id)
        assert result[0]["task"] == "Run audit"
        assert result[0]["status"] == "COMPLETED"
        assert result[0]["execution_status"] == "IDLE"
        assert result[0]["session_type"] == "SUB_ONE_SHOT"
        assert result[0]["tokens_used"] == 500
        assert result[0]["tool_calls"] == 3
        assert result[0]["turns"] == 2  # 2 USER messages

    @patch("onyx.agents.bud_agent.sub_session_tools.get_sub_sessions_for_parent")
    def test_status_filter(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import list_sub_sessions

        mock_get.return_value = [
            FakeSession(status=AgentSessionStatus.ACTIVE, messages=[]),
            FakeSession(status=AgentSessionStatus.COMPLETED, messages=[]),
            FakeSession(status=AgentSessionStatus.ACTIVE, messages=[]),
        ]

        result = list_sub_sessions(
            mock_db, _PARENT_SESSION_ID, status_filter="ACTIVE"
        )

        assert len(result) == 2
        for r in result:
            assert r["status"] == "ACTIVE"

    @patch("onyx.agents.bud_agent.sub_session_tools.get_sub_sessions_for_parent")
    def test_limit(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import list_sub_sessions

        mock_get.return_value = [
            FakeSession(messages=[]) for _ in range(10)
        ]

        result = list_sub_sessions(mock_db, _PARENT_SESSION_ID, limit=3)

        assert len(result) == 3

    @patch("onyx.agents.bud_agent.sub_session_tools.get_sub_sessions_for_parent")
    def test_empty_list(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import list_sub_sessions

        mock_get.return_value = []

        result = list_sub_sessions(mock_db, _PARENT_SESSION_ID)

        assert result == []


# ---------------------------------------------------------------------------
# Tests — inspect_sub_session
# ---------------------------------------------------------------------------


class TestInspectSubSession:
    """inspect_sub_session returns session details with optional history."""

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_session_not_found(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import inspect_sub_session

        mock_get.return_value = None

        result = inspect_sub_session(mock_db, uuid4(), _USER_ID)

        assert "error" in result

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_basic_inspection(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import inspect_sub_session

        session_id = uuid4()
        mock_get.return_value = FakeSession(
            id=session_id,
            task_description="Audit code",
            status=AgentSessionStatus.COMPLETED,
            session_type="SUB_ONE_SHOT",
            total_tokens_used=1000,
            total_tool_calls=5,
            messages=[FakeMessage("USER", "hello")],
        )

        result = inspect_sub_session(mock_db, session_id, _USER_ID)

        assert result["session_id"] == str(session_id)
        assert result["task"] == "Audit code"
        assert result["status"] == "COMPLETED"
        assert result["tokens_used"] == 1000
        assert result["turns"] == 1
        assert "history" not in result

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_messages")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_with_history(
        self,
        mock_get: MagicMock,
        mock_get_messages: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import inspect_sub_session

        session_id = uuid4()
        mock_get.return_value = FakeSession(
            id=session_id,
            messages=[FakeMessage("USER", "hello")],
        )
        mock_get_messages.return_value = [
            FakeMessage("USER", "Run audit"),
            FakeMessage("ASSISTANT", "Done", tool_name="bash"),
        ]

        result = inspect_sub_session(
            mock_db, session_id, _USER_ID, include_history=True
        )

        assert "history" in result
        history = result["history"]
        assert len(history) == 2
        assert history[0]["role"] == "USER"
        assert history[0]["content"] == "Run audit"
        assert history[1]["role"] == "ASSISTANT"
        assert history[1]["tool_name"] == "bash"


# ---------------------------------------------------------------------------
# Tests — get_sub_session_result
# ---------------------------------------------------------------------------


class TestGetSubSessionResult:
    """get_sub_session_result returns summary from completed sessions."""

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_session_not_found(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import get_sub_session_result

        mock_get.return_value = None

        result = get_sub_session_result(mock_db, uuid4(), _USER_ID)

        assert "error" in result

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_still_active_returns_error(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import get_sub_session_result

        mock_get.return_value = FakeSession(status=AgentSessionStatus.ACTIVE)

        result = get_sub_session_result(mock_db, uuid4(), _USER_ID)

        assert "error" in result
        assert "still running" in result["error"]
        assert result["status"] == "ACTIVE"

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_messages")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_completed_returns_summary(
        self,
        mock_get: MagicMock,
        mock_get_messages: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import get_sub_session_result

        session_id = uuid4()
        mock_get.return_value = FakeSession(
            id=session_id,
            status=AgentSessionStatus.COMPLETED,
            task_description="Run audit",
            total_tokens_used=800,
            total_tool_calls=4,
        )
        mock_get_messages.return_value = [
            FakeMessage("USER", "Run audit"),
            FakeMessage("ASSISTANT", "Audit complete. No issues found."),
        ]

        result = get_sub_session_result(mock_db, session_id, _USER_ID)

        assert result["status"] == "COMPLETED"
        assert result["task"] == "Run audit"
        assert result["summary"] == "Audit complete. No issues found."
        assert result["tokens_used"] == 800
        assert result["tool_calls"] == 4

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_messages")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_failed_session_returns_result(
        self,
        mock_get: MagicMock,
        mock_get_messages: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import get_sub_session_result

        mock_get.return_value = FakeSession(
            status=AgentSessionStatus.FAILED,
            task_description="Broken task",
        )
        mock_get_messages.return_value = [
            FakeMessage("USER", "Do something"),
            FakeMessage("ASSISTANT", "Failed due to missing file."),
        ]

        result = get_sub_session_result(mock_db, uuid4(), _USER_ID)

        assert result["status"] == "FAILED"
        assert result["summary"] == "Failed due to missing file."

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_messages")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_long_summary_truncated(
        self,
        mock_get: MagicMock,
        mock_get_messages: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import get_sub_session_result

        mock_get.return_value = FakeSession(
            status=AgentSessionStatus.COMPLETED,
        )
        long_content = "x" * 3000
        mock_get_messages.return_value = [
            FakeMessage("ASSISTANT", long_content),
        ]

        result = get_sub_session_result(mock_db, uuid4(), _USER_ID)

        assert len(result["summary"]) == 2003  # 2000 + "..."
        assert result["summary"].endswith("...")

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_messages")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_no_assistant_messages(
        self,
        mock_get: MagicMock,
        mock_get_messages: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import get_sub_session_result

        mock_get.return_value = FakeSession(
            status=AgentSessionStatus.COMPLETED,
        )
        mock_get_messages.return_value = [
            FakeMessage("USER", "Do something"),
        ]

        result = get_sub_session_result(mock_db, uuid4(), _USER_ID)

        assert result["summary"] == "(no summary available)"


# ---------------------------------------------------------------------------
# Tests — cancel_sub_session
# ---------------------------------------------------------------------------


class TestCancelSubSession:
    """cancel_sub_session sets the Redis stop flag for active sessions."""

    @patch("onyx.agents.bud_agent.sub_session_tools.get_redis_client")
    @patch("onyx.agents.bud_agent.sub_session_tools.set_session_stop_flag")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_cancel_active_session(
        self,
        mock_get: MagicMock,
        mock_stop: MagicMock,
        mock_redis_factory: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import cancel_sub_session

        session_id = uuid4()
        mock_get.return_value = FakeSession(
            id=session_id,
            status=AgentSessionStatus.ACTIVE,
        )
        mock_redis = MagicMock()
        mock_redis_factory.return_value = mock_redis

        result = cancel_sub_session(
            mock_db, session_id, _USER_ID, tenant_id=_TENANT_ID
        )

        assert result["status"] == "cancelling"
        assert result["session_id"] == str(session_id)
        mock_stop.assert_called_once_with(mock_redis, session_id)

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_cancel_not_found(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import cancel_sub_session

        mock_get.return_value = None

        result = cancel_sub_session(mock_db, uuid4(), _USER_ID)

        assert "error" in result

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_cancel_not_active(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import cancel_sub_session

        mock_get.return_value = FakeSession(
            status=AgentSessionStatus.COMPLETED,
        )

        result = cancel_sub_session(mock_db, uuid4(), _USER_ID)

        assert "error" in result
        assert "not active" in result["error"]
        assert result["status"] == "COMPLETED"


# ---------------------------------------------------------------------------
# Tests — send_to_sub_session
# ---------------------------------------------------------------------------


class TestSendToSubSession:
    """send_to_sub_session enqueues follow-up events and re-dispatches."""

    @patch("onyx.agents.bud_agent.sub_session_tools.get_redis_client")
    @patch("onyx.agents.bud_agent.sub_session_tools.enqueue_session_event")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_send_worker_running(
        self,
        mock_get: MagicMock,
        mock_enqueue: MagicMock,
        mock_redis_factory: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import send_to_sub_session

        session_id = uuid4()
        mock_get.return_value = FakeSession(
            id=session_id,
            session_type="SUB_PERSISTENT",
            status=AgentSessionStatus.ACTIVE,
        )
        mock_redis = MagicMock()
        mock_redis.exists.return_value = 1  # heartbeat exists
        mock_redis_factory.return_value = mock_redis

        result = send_to_sub_session(
            mock_db, session_id, _USER_ID, "Follow-up message"
        )

        assert result["status"] == "delivered"
        mock_enqueue.assert_called_once()

    @patch("onyx.agents.bud_agent.sub_session_tools.update_session_status")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_redis_client")
    @patch("onyx.agents.bud_agent.sub_session_tools.enqueue_session_event")
    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_send_worker_not_running_redispatches(
        self,
        mock_get: MagicMock,
        mock_enqueue: MagicMock,
        mock_redis_factory: MagicMock,
        mock_update_status: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import send_to_sub_session

        session_id = uuid4()
        mock_get.return_value = FakeSession(
            id=session_id,
            session_type="SUB_PERSISTENT",
            status=AgentSessionStatus.COMPLETED,
        )
        mock_redis = MagicMock()
        mock_redis.exists.return_value = 0  # no heartbeat
        mock_redis_factory.return_value = mock_redis
        _mock_celery_client_module.celery_app.reset_mock()

        result = send_to_sub_session(
            mock_db, session_id, _USER_ID, "Resume work",
            tenant_id=_TENANT_ID,
        )

        assert result["status"] == "delivered"
        _mock_celery_client_module.celery_app.send_task.assert_called_once()
        # Should re-activate since status was COMPLETED
        mock_update_status.assert_called_once_with(
            mock_db, session_id, AgentSessionStatus.ACTIVE
        )

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_send_session_not_found(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import send_to_sub_session

        mock_get.return_value = None

        result = send_to_sub_session(mock_db, uuid4(), _USER_ID, "Hello")

        assert "error" in result

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_send_non_sub_session_rejected(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import send_to_sub_session

        mock_get.return_value = FakeSession(session_type="INTERACTIVE")

        result = send_to_sub_session(mock_db, uuid4(), _USER_ID, "Hello")

        assert "error" in result
        assert "only for sub-sessions" in result["error"]

    @patch("onyx.agents.bud_agent.sub_session_tools.get_session_for_user")
    def test_send_expired_persistent_rejected(
        self,
        mock_get: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.sub_session_tools import (
            PERSISTENT_SUB_SESSION_EXPIRY_SECONDS,
            send_to_sub_session,
        )

        mock_get.return_value = FakeSession(
            session_type="SUB_PERSISTENT",
            status=AgentSessionStatus.COMPLETED,
            completed_at=datetime.utcnow()
            - timedelta(seconds=PERSISTENT_SUB_SESSION_EXPIRY_SECONDS + 60),
        )

        result = send_to_sub_session(mock_db, uuid4(), _USER_ID, "Hello")

        assert result["status"] == "error"
        assert result["reason"] == "session_expired"
