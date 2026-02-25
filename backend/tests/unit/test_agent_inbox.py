"""Unit tests for agent inbox DB operations.

Tests the resolve_user() disambiguation and _message_to_snapshot()
serialization without requiring a live database.
"""

import datetime
from unittest.mock import MagicMock
from unittest.mock import patch
from uuid import uuid4

from onyx.db.agent_inbox import resolve_user
from onyx.db.enums import AgentInboxMessageStatus
from onyx.server.agent.inbox_api import _message_to_snapshot


# ---------------------------------------------------------------------------
# resolve_user tests
# ---------------------------------------------------------------------------


def test_resolve_user_by_email() -> None:
    """Email match returns (user, None)."""
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_session = MagicMock()

    with patch(
        "onyx.db.agent_inbox.get_user_by_email", return_value=mock_user
    ):
        user, error = resolve_user(mock_session, "alice@example.com")

    assert user is mock_user
    assert error is None


def test_resolve_user_by_email_not_found_name_single_match() -> None:
    """Email miss, single name match returns (user, None)."""
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_session = MagicMock()

    # get_user_by_email returns None — email miss
    # scalars().all() returns one match
    mock_session.scalars.return_value.all.return_value = [mock_user]

    with patch(
        "onyx.db.agent_inbox.get_user_by_email", return_value=None
    ):
        user, error = resolve_user(mock_session, "Alice Smith")

    assert user is mock_user
    assert error is None


def test_resolve_user_ambiguous_name() -> None:
    """Multiple name matches returns (None, error)."""
    user_a = MagicMock()
    user_b = MagicMock()
    mock_session = MagicMock()

    mock_session.scalars.return_value.all.return_value = [user_a, user_b]

    with patch(
        "onyx.db.agent_inbox.get_user_by_email", return_value=None
    ):
        user, error = resolve_user(mock_session, "Bob")

    assert user is None
    assert error is not None
    assert "Multiple users" in error
    assert "email" in error.lower()


def test_resolve_user_not_found() -> None:
    """No email match and no name match returns (None, None)."""
    mock_session = MagicMock()

    mock_session.scalars.return_value.all.return_value = []

    with patch(
        "onyx.db.agent_inbox.get_user_by_email", return_value=None
    ):
        user, error = resolve_user(mock_session, "nobody@example.com")

    assert user is None
    assert error is None


# ---------------------------------------------------------------------------
# _message_to_snapshot tests
# ---------------------------------------------------------------------------


def _make_inbox_message(
    status: AgentInboxMessageStatus = AgentInboxMessageStatus.UNREAD,
    sender_name: str | None = "Alice",
    sender_email: str | None = "alice@test.com",
    receiver_name: str | None = "Bob",
    receiver_email: str | None = "bob@test.com",
) -> MagicMock:
    """Create a mock AgentInboxMessage."""
    msg = MagicMock()
    msg.id = uuid4()
    msg.sender_user_id = uuid4()
    msg.receiver_user_id = uuid4()
    msg.content = "Hello from Alice"
    msg.reply_to_id = None
    msg.status = status
    msg.result_summary = None
    msg.error_message = None
    msg.is_sender_notified = False
    msg.created_at = datetime.datetime(2026, 2, 19, 12, 0, 0)
    msg.updated_at = datetime.datetime(2026, 2, 19, 12, 0, 0)

    sender = MagicMock()
    sender.personal_name = sender_name
    sender.email = sender_email
    msg.sender = sender

    receiver = MagicMock()
    receiver.personal_name = receiver_name
    receiver.email = receiver_email
    msg.receiver = receiver

    return msg


def test_message_to_snapshot_basic() -> None:
    """Snapshot correctly serializes all fields."""
    msg = _make_inbox_message()
    snap = _message_to_snapshot(msg)

    assert snap.sender_name == "Alice"
    assert snap.sender_email == "alice@test.com"
    assert snap.receiver_name == "Bob"
    assert snap.receiver_email == "bob@test.com"
    assert snap.content == "Hello from Alice"
    assert snap.status == "unread"
    assert snap.is_sender_notified is False


def test_message_to_snapshot_no_sender() -> None:
    """Snapshot handles None sender relationship gracefully."""
    msg = _make_inbox_message()
    msg.sender = None

    snap = _message_to_snapshot(msg)

    assert snap.sender_name is None
    assert snap.sender_email is None
    assert snap.receiver_name == "Bob"


def test_message_to_snapshot_status_string() -> None:
    """Snapshot handles string status (e.g., from raw DB)."""
    msg = _make_inbox_message(status=AgentInboxMessageStatus.RESPONDED)
    snap = _message_to_snapshot(msg)
    assert snap.status == "responded"


def test_message_to_snapshot_reply_to() -> None:
    """Snapshot serializes reply_to_id as string."""
    msg = _make_inbox_message()
    reply_id = uuid4()
    msg.reply_to_id = reply_id

    snap = _message_to_snapshot(msg)
    assert snap.reply_to_id == str(reply_id)


# ---------------------------------------------------------------------------
# InboxRunResult tests
# ---------------------------------------------------------------------------


def test_inbox_run_result_defaults() -> None:
    """InboxRunResult initializes with correct defaults."""
    from onyx.agents.bud_agent.inbox_orchestrator import InboxRunResult

    result = InboxRunResult()
    assert result.response_text == ""
    assert result.tool_call_count == 0
    assert result.replied is False
    assert result.awaiting_user is False
    assert result.escalation_reason is None
    assert result.no_action is False
    assert result.error is None


def test_inbox_run_result_escalation_reason() -> None:
    """escalation_reason can be set when awaiting_user is True."""
    from onyx.agents.bud_agent.inbox_orchestrator import InboxRunResult

    result = InboxRunResult()
    result.awaiting_user = True
    result.escalation_reason = "User needs to confirm availability."

    assert result.awaiting_user is True
    assert result.escalation_reason == "User needs to confirm availability."
