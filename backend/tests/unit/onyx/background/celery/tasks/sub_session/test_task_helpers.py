"""Unit tests for helper functions in sub-session Celery tasks.

Tests cover the pure/near-pure helpers in
``onyx.background.celery.tasks.sub_session.tasks``:

- _truncate_words
- _extract_text_from_content
- _extract_summary
- _notify_parent (parent busy vs idle)
- _summarize_and_announce
- _summarize_partial_and_announce
- _announce_failure
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch
from uuid import UUID
from uuid import uuid4

import pytest

# ---------------------------------------------------------------------------
# Heavy-dependency stubs.  tasks.py imports from celery and app_base which
# pull in many heavy deps.  Instead of stubbing every celery submodule, we
# intercept the specific modules that tasks.py needs:
#   - ``onyx.background.celery.apps.app_base`` (provides ``task_logger``)
#   - ``celery`` (provides ``shared_task``, ``Task``)
#   - ``celery.exceptions`` (provides ``SoftTimeLimitExceeded``)
#   - ``redis.lock`` (provides ``Lock``)
# ---------------------------------------------------------------------------

import logging
import types


def _make_pkg(name: str) -> types.ModuleType:
    """Create a stub package in sys.modules."""
    mod = types.ModuleType(name)
    mod.__package__ = name
    mod.__path__ = []  # type: ignore[attr-defined]
    sys.modules[name] = mod
    return mod


# -- celery stubs (must be a real package for submodule import) --
if "celery" not in sys.modules:
    _celery_pkg = _make_pkg("celery")
    _celery_pkg.shared_task = lambda *a, **kw: (lambda fn: fn)  # type: ignore[attr-defined]
    _celery_pkg.Task = type("Task", (), {})  # type: ignore[attr-defined]

    _celery_exc = _make_pkg("celery.exceptions")
    _celery_exc.SoftTimeLimitExceeded = type("SoftTimeLimitExceeded", (Exception,), {})  # type: ignore[attr-defined]

# -- app_base: the main import chain breaker --
if "onyx.background.celery.apps.app_base" not in sys.modules:
    _app_base = types.ModuleType("onyx.background.celery.apps.app_base")
    _app_base.task_logger = logging.getLogger("test.task_logger")  # type: ignore[attr-defined]
    sys.modules["onyx.background.celery.apps.app_base"] = _app_base

# -- redis.lock --
if "redis.lock" not in sys.modules:
    sys.modules["redis.lock"] = MagicMock()

from onyx.db.enums import AgentEventType
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PARENT_SESSION_ID: UUID = uuid4()
_TENANT_ID = "public"


# ---------------------------------------------------------------------------
# Fake ORM objects
# ---------------------------------------------------------------------------


class FakeSession:
    """Lightweight stand-in for AgentSession ORM model."""

    def __init__(self, **kwargs: Any) -> None:
        self.id: UUID = kwargs.get("id", uuid4())
        self.parent_session_id: UUID | None = kwargs.get(
            "parent_session_id", _PARENT_SESSION_ID
        )
        self.task_description: str | None = kwargs.get("task_description", "test task")
        self.status: AgentSessionStatus = kwargs.get(
            "status", AgentSessionStatus.ACTIVE
        )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_db() -> MagicMock:
    db = MagicMock()
    db.commit.return_value = None
    db.refresh.return_value = None
    return db


@pytest.fixture()
def mock_redis() -> MagicMock:
    redis = MagicMock()
    redis.publish.return_value = None
    return redis


# ---------------------------------------------------------------------------
# Tests — _truncate_words
# ---------------------------------------------------------------------------


class TestTruncateWords:
    """_truncate_words truncates text to N words."""

    def test_short_text_unchanged(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _truncate_words

        assert _truncate_words("hello world", max_words=5) == "hello world"

    def test_long_text_truncated(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _truncate_words

        text = " ".join(f"word{i}" for i in range(100))
        result = _truncate_words(text, max_words=3)
        assert result == "word0 word1 word2..."

    def test_exactly_max_words(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _truncate_words

        text = "one two three"
        assert _truncate_words(text, max_words=3) == text


# ---------------------------------------------------------------------------
# Tests — _extract_text_from_content
# ---------------------------------------------------------------------------


class TestExtractTextFromContent:
    """_extract_text_from_content handles various content formats."""

    def test_plain_string(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _extract_text_from_content,
        )

        assert _extract_text_from_content("hello") == "hello"

    def test_list_of_strings(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _extract_text_from_content,
        )

        result = _extract_text_from_content(["hello", "world"])
        assert result == "hello\nworld"

    def test_list_of_content_blocks(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _extract_text_from_content,
        )

        content = [
            {"type": "output_text", "text": "Part 1"},
            {"type": "output_text", "text": "Part 2"},
        ]
        result = _extract_text_from_content(content)
        assert result == "Part 1\nPart 2"

    def test_list_with_mixed_blocks(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _extract_text_from_content,
        )

        content = [
            "raw string",
            {"type": "output_text", "text": "block text"},
            {"type": "image", "url": "http://..."},
        ]
        result = _extract_text_from_content(content)
        assert "raw string" in result
        assert "block text" in result

    def test_empty_list(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _extract_text_from_content,
        )

        result = _extract_text_from_content([])
        # Empty list with no parts → str([])
        assert result == "[]"

    def test_non_string_non_list(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _extract_text_from_content,
        )

        result = _extract_text_from_content(42)
        assert result == "42"


# ---------------------------------------------------------------------------
# Tests — _extract_summary
# ---------------------------------------------------------------------------


class TestExtractSummary:
    """_extract_summary extracts summaries from message lists."""

    def test_explicit_summary_line(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [
            {"role": "user", "content": "Do audit"},
            {
                "role": "assistant",
                "content": "I ran the audit.\nSUMMARY: All checks passed.",
            },
        ]
        result = _extract_summary(messages)
        assert result == "All checks passed."

    def test_summary_case_insensitive(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [
            {
                "role": "assistant",
                "content": "Done.\nsummary: Case insensitive check.",
            },
        ]
        result = _extract_summary(messages)
        assert result == "Case insensitive check."

    def test_fallback_first_two_sentences(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [
            {
                "role": "assistant",
                "content": "First sentence. Second sentence. Third sentence.",
            },
        ]
        result = _extract_summary(messages)
        assert result == "First sentence. Second sentence."

    def test_single_sentence_fallback(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [
            {"role": "assistant", "content": "Short answer without period"},
        ]
        result = _extract_summary(messages)
        assert "Short answer" in result

    def test_empty_messages(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        assert _extract_summary([]) == "(no summary available)"

    def test_no_assistant_messages(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [{"role": "user", "content": "Hello"}]
        assert _extract_summary(messages) == "(no summary available)"

    def test_assistant_with_none_content(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [{"role": "assistant", "content": None}]
        assert _extract_summary(messages) == "(no summary available)"

    def test_content_block_list(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [
            {
                "role": "assistant",
                "content": [
                    {"type": "output_text", "text": "First sentence. Second sentence."},
                ],
            },
        ]
        result = _extract_summary(messages)
        assert "First sentence" in result

    def test_uses_last_assistant_message(self) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _extract_summary

        messages = [
            {"role": "assistant", "content": "Old response"},
            {"role": "user", "content": "More work"},
            {"role": "assistant", "content": "Final result.\nSUMMARY: The final answer."},
        ]
        result = _extract_summary(messages)
        assert result == "The final answer."


# ---------------------------------------------------------------------------
# Tests — _notify_parent
# ---------------------------------------------------------------------------


class TestNotifyParent:
    """_notify_parent routes to enqueue or persist based on parent busyness."""

    @patch("onyx.background.celery.tasks.sub_session.tasks.get_session")
    @patch("onyx.db.agent.is_session_busy")
    @patch("onyx.background.celery.tasks.sub_session.tasks.enqueue_session_event")
    @patch("onyx.background.celery.tasks.sub_session.tasks.add_session_message")
    def test_parent_busy_enqueues_event(
        self,
        mock_add_msg: MagicMock,
        mock_enqueue: MagicMock,
        mock_is_busy: MagicMock,
        mock_get_session: MagicMock,
        mock_db: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _notify_parent

        mock_get_session.return_value = FakeSession()
        mock_is_busy.return_value = True

        sub_session = FakeSession()

        _notify_parent(
            db_session=mock_db,
            parent_session_id=_PARENT_SESSION_ID,
            sub_session=sub_session,
            content="Task completed.",
            event_type=AgentEventType.SUB_SESSION_COMPLETE,
            event_payload={"sub_session_id": str(sub_session.id)},
            socketio_type="SUB_SESSION_COMPLETE",
            tenant_id=_TENANT_ID,
            redis_client=mock_redis,
        )

        # Should enqueue instead of persisting directly
        mock_enqueue.assert_called_once()
        mock_add_msg.assert_not_called()
        # Should still publish Socket.IO event
        mock_redis.publish.assert_called_once()

    @patch("onyx.background.celery.tasks.sub_session.tasks.get_session")
    @patch("onyx.db.agent.is_session_busy")
    @patch("onyx.background.celery.tasks.sub_session.tasks.enqueue_session_event")
    @patch("onyx.background.celery.tasks.sub_session.tasks.add_session_message")
    def test_parent_idle_persists_directly(
        self,
        mock_add_msg: MagicMock,
        mock_enqueue: MagicMock,
        mock_is_busy: MagicMock,
        mock_get_session: MagicMock,
        mock_db: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _notify_parent

        mock_get_session.return_value = FakeSession()
        mock_is_busy.return_value = False

        sub_session = FakeSession()

        _notify_parent(
            db_session=mock_db,
            parent_session_id=_PARENT_SESSION_ID,
            sub_session=sub_session,
            content="Task completed.",
            event_type=AgentEventType.SUB_SESSION_COMPLETE,
            event_payload={"sub_session_id": str(sub_session.id)},
            socketio_type="SUB_SESSION_COMPLETE",
            tenant_id=_TENANT_ID,
            redis_client=mock_redis,
        )

        # Should persist directly
        mock_add_msg.assert_called_once_with(
            db_session=mock_db,
            session_id=_PARENT_SESSION_ID,
            role=AgentMessageRole.ASSISTANT,
            content="Task completed.",
        )
        mock_enqueue.assert_not_called()
        mock_redis.publish.assert_called_once()

    @patch("onyx.background.celery.tasks.sub_session.tasks.get_session")
    @patch("onyx.db.agent.is_session_busy")
    @patch("onyx.background.celery.tasks.sub_session.tasks.enqueue_session_event")
    @patch("onyx.background.celery.tasks.sub_session.tasks.add_session_message")
    def test_parent_not_found_still_publishes_socketio(
        self,
        mock_add_msg: MagicMock,
        mock_enqueue: MagicMock,
        mock_is_busy: MagicMock,
        mock_get_session: MagicMock,
        mock_db: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _notify_parent

        mock_get_session.return_value = None  # Parent not found

        sub_session = FakeSession()

        _notify_parent(
            db_session=mock_db,
            parent_session_id=_PARENT_SESSION_ID,
            sub_session=sub_session,
            content="Task completed.",
            event_type=AgentEventType.SUB_SESSION_COMPLETE,
            event_payload={"sub_session_id": str(sub_session.id)},
            socketio_type="SUB_SESSION_COMPLETE",
            tenant_id=_TENANT_ID,
            redis_client=mock_redis,
        )

        # is_session_busy should not be called if parent is None
        mock_is_busy.assert_not_called()
        # Socket.IO event should still be published
        mock_redis.publish.assert_called_once()


# ---------------------------------------------------------------------------
# Tests — _summarize_and_announce
# ---------------------------------------------------------------------------


class TestSummarizeAndAnnounce:
    """_summarize_and_announce sets COMPLETED and notifies the parent."""

    @patch("onyx.background.celery.tasks.sub_session.tasks._notify_parent")
    @patch("onyx.background.celery.tasks.sub_session.tasks.update_session_status")
    def test_announces_completion(
        self,
        mock_update: MagicMock,
        mock_notify: MagicMock,
        mock_db: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _summarize_and_announce,
        )

        session = FakeSession(task_description="Run audit")
        messages = [
            {"role": "assistant", "content": "Done.\nSUMMARY: All good."},
        ]

        _summarize_and_announce(
            mock_db, session, messages, _TENANT_ID, redis_client=mock_redis
        )

        mock_update.assert_called_once_with(
            mock_db, session.id, AgentSessionStatus.COMPLETED
        )
        mock_notify.assert_called_once()
        notify_kwargs = mock_notify.call_args[1]
        assert notify_kwargs["event_type"] == AgentEventType.SUB_SESSION_COMPLETE
        assert "Run audit" in notify_kwargs["content"]

    @patch("onyx.background.celery.tasks.sub_session.tasks._notify_parent")
    @patch("onyx.background.celery.tasks.sub_session.tasks.update_session_status")
    def test_no_parent_still_marks_completed(
        self,
        mock_update: MagicMock,
        mock_notify: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _summarize_and_announce,
        )

        session = FakeSession(parent_session_id=None)

        _summarize_and_announce(mock_db, session, [], _TENANT_ID)

        mock_update.assert_called_once_with(
            mock_db, session.id, AgentSessionStatus.COMPLETED
        )
        mock_notify.assert_not_called()


# ---------------------------------------------------------------------------
# Tests — _summarize_partial_and_announce
# ---------------------------------------------------------------------------


class TestSummarizePartialAndAnnounce:
    """_summarize_partial_and_announce sets FAILED and notifies timeout."""

    @patch("onyx.background.celery.tasks.sub_session.tasks._notify_parent")
    @patch("onyx.background.celery.tasks.sub_session.tasks.update_session_status")
    def test_announces_timeout(
        self,
        mock_update: MagicMock,
        mock_notify: MagicMock,
        mock_db: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _summarize_partial_and_announce,
        )

        session = FakeSession(task_description="Long task")
        messages = [
            {"role": "assistant", "content": "Partial work done."},
        ]

        _summarize_partial_and_announce(
            mock_db, session, messages, _TENANT_ID, redis_client=mock_redis
        )

        mock_update.assert_called_once_with(
            mock_db, session.id, AgentSessionStatus.FAILED
        )
        mock_notify.assert_called_once()
        notify_kwargs = mock_notify.call_args[1]
        assert notify_kwargs["event_type"] == AgentEventType.SUB_SESSION_TIMEOUT
        assert "timed out" in notify_kwargs["content"]

    @patch("onyx.background.celery.tasks.sub_session.tasks._notify_parent")
    @patch("onyx.background.celery.tasks.sub_session.tasks.update_session_status")
    def test_no_parent_marks_failed(
        self,
        mock_update: MagicMock,
        mock_notify: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import (
            _summarize_partial_and_announce,
        )

        session = FakeSession(parent_session_id=None)

        _summarize_partial_and_announce(mock_db, session, [], _TENANT_ID)

        mock_update.assert_called_once_with(
            mock_db, session.id, AgentSessionStatus.FAILED
        )
        mock_notify.assert_not_called()


# ---------------------------------------------------------------------------
# Tests — _announce_failure
# ---------------------------------------------------------------------------


class TestAnnounceFailure:
    """_announce_failure sets FAILED and notifies the parent with error."""

    @patch("onyx.background.celery.tasks.sub_session.tasks._notify_parent")
    @patch("onyx.background.celery.tasks.sub_session.tasks.update_session_status")
    def test_announces_failure(
        self,
        mock_update: MagicMock,
        mock_notify: MagicMock,
        mock_db: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _announce_failure

        session = FakeSession(task_description="Failing task")

        _announce_failure(
            mock_db, session, "Connection refused", _TENANT_ID,
            redis_client=mock_redis,
        )

        mock_update.assert_called_once_with(
            mock_db, session.id, AgentSessionStatus.FAILED
        )
        mock_notify.assert_called_once()
        notify_kwargs = mock_notify.call_args[1]
        assert notify_kwargs["event_type"] == AgentEventType.SUB_SESSION_FAILED
        assert "failed" in notify_kwargs["content"]
        assert "Connection refused" in notify_kwargs["content"]

    @patch("onyx.background.celery.tasks.sub_session.tasks._notify_parent")
    @patch("onyx.background.celery.tasks.sub_session.tasks.update_session_status")
    def test_no_parent_marks_failed(
        self,
        mock_update: MagicMock,
        mock_notify: MagicMock,
        mock_db: MagicMock,
    ) -> None:
        from onyx.background.celery.tasks.sub_session.tasks import _announce_failure

        session = FakeSession(parent_session_id=None)

        _announce_failure(mock_db, session, "Error", _TENANT_ID)

        mock_update.assert_called_once_with(
            mock_db, session.id, AgentSessionStatus.FAILED
        )
        mock_notify.assert_not_called()
