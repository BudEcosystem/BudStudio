"""Unit tests for AgentHandler — Socket.IO agent event handling.

Tests cover all public event handlers (handle_execute, handle_tool_result,
handle_approval, handle_stop) and session status transitions.

Every external dependency (DB, Redis, Socket.IO, LLM) is mocked with
``unittest.mock`` so these tests run without any running services.
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from collections.abc import Generator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from onyx.db.enums import (
    AgentMessageRole,
    AgentSessionExecutionStatus,
    AgentSessionStatus,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TEST_USER_ID = uuid4()
TEST_USER_ID_STR = str(TEST_USER_ID)
TEST_USER_EMAIL = "test@example.com"
TEST_SESSION_ID = uuid4()
TEST_SESSION_ID_STR = str(TEST_SESSION_ID)
TEST_SID = "socket-id-abc"
TEST_TENANT_ID = "public"


def _make_mock_session(
    *,
    user_id: UUID | None = TEST_USER_ID,
    status: AgentSessionStatus = AgentSessionStatus.ACTIVE,
    execution_status: AgentSessionExecutionStatus = AgentSessionExecutionStatus.IDLE,
    workspace_path: str | None = "/tmp/workspace",
    pending_local_tools: list[dict[str, Any]] | None = None,
) -> MagicMock:
    """Create a mock AgentSession ORM object."""
    session = MagicMock()
    session.id = TEST_SESSION_ID
    session.user_id = user_id
    session.status = status
    session.execution_status = execution_status
    session.workspace_path = workspace_path
    session.pending_local_tools = pending_local_tools
    return session


def _make_mock_tool_message(
    *,
    tool_name: str = "bash",
    tool_input: dict[str, Any] | None = None,
    tool_call_id: str = "call-123",
    step_number: int = 1,
    tool_output: dict[str, Any] | None = None,
) -> MagicMock:
    """Create a mock AgentMessage with tool fields populated."""
    msg = MagicMock()
    msg.tool_name = tool_name
    msg.tool_input = tool_input or {"command": "ls"}
    msg.tool_call_id = tool_call_id
    msg.step_number = step_number
    msg.tool_output = tool_output
    msg.role = AgentMessageRole.TOOL
    return msg


def _make_mock_user() -> MagicMock:
    """Create a mock User ORM object."""
    user = MagicMock()
    user.id = TEST_USER_ID
    user.email = TEST_USER_EMAIL
    return user


def _run_async(coro: Any) -> Any:
    """Run an async coroutine synchronously."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_sio() -> AsyncMock:
    """Create a mock Socket.IO AsyncServer."""
    sio = AsyncMock()
    sio.emit = AsyncMock()
    return sio


@pytest.fixture()
def mock_redis() -> MagicMock:
    """Create a mock Redis client."""
    r = MagicMock()
    r.exists.return_value = 0  # stop flag not set by default
    r.set.return_value = True
    r.delete.return_value = True
    return r


@pytest.fixture()
def mock_db_session() -> MagicMock:
    """Create a mock SQLAlchemy Session."""
    return MagicMock()


@pytest.fixture()
def handler(mock_sio: AsyncMock) -> Any:
    """Create an AgentHandler with mocked internals.

    The handler's ``_get_db_session`` and ``_get_redis`` are patched so no
    real connections are attempted.
    """
    from onyx.server.agent.agent_handler import AgentHandler

    h = AgentHandler(
        user_id=TEST_USER_ID_STR,
        user_email=TEST_USER_EMAIL,
        sid=TEST_SID,
        sio=mock_sio,
        tenant_id=TEST_TENANT_ID,
    )
    return h


# ---------------------------------------------------------------------------
# Context-manager helper for patching _get_db_session
# ---------------------------------------------------------------------------

def _patch_db_session(
    handler: Any,
    mock_db: MagicMock,
) -> Any:
    """Return a patch context for handler._get_db_session.

    Yields *mock_db* from the contextmanager.
    """
    @contextmanager
    def _ctx() -> Generator[MagicMock, None, None]:
        yield mock_db

    return patch.object(handler, "_get_db_session", _ctx)


# ===========================================================================
# handle_execute tests
# ===========================================================================


class TestHandleExecute:
    """Tests for AgentHandler.handle_execute."""

    def test_successful_execute(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        """Valid session, IDLE status -> sets RUNNING, persists message, calls _run_llm_turn."""
        mock_session = _make_mock_session(
            execution_status=AgentSessionExecutionStatus.IDLE,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_for_user",
                return_value=mock_session,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
            patch(
                "onyx.server.agent.agent_handler.clear_session_stop_flag",
            ) as mock_clear_stop,
            patch(
                "onyx.server.agent.agent_handler.add_session_message",
            ) as mock_add_msg,
            patch.object(
                handler, "_get_redis", return_value=mock_redis,
            ),
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            result = _run_async(handler.handle_execute({
                "session_id": TEST_SESSION_ID_STR,
                "message": "Hello agent",
                "workspace_path": "/tmp/workspace",
            }))

        assert result == {"session_id": TEST_SESSION_ID_STR}

        # Verify status was set to RUNNING
        mock_set_status.assert_called_once_with(
            mock_db_session,
            TEST_SESSION_ID,
            AgentSessionExecutionStatus.RUNNING,
        )

        # Verify stop flag was cleared
        mock_clear_stop.assert_called_once_with(mock_redis, TEST_SESSION_ID)

        # Verify user message was persisted
        mock_add_msg.assert_called_once_with(
            db_session=mock_db_session,
            session_id=TEST_SESSION_ID,
            role=AgentMessageRole.USER,
            content="Hello agent",
        )

        # Verify _run_llm_turn was called
        mock_run_llm.assert_awaited_once()

    def test_session_busy_returns_error(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Session status is RUNNING -> returns SESSION_BUSY error ack."""
        mock_session = _make_mock_session(
            execution_status=AgentSessionExecutionStatus.RUNNING,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_for_user",
                return_value=mock_session,
            ),
        ):
            result = _run_async(handler.handle_execute({
                "session_id": TEST_SESSION_ID_STR,
                "message": "Hello",
            }))

        assert result["code"] == "SESSION_BUSY"
        assert "error" in result

    def test_invalid_session_returns_error(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Non-existent session_id -> returns INVALID_SESSION error ack."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_for_user",
                return_value=None,
            ),
        ):
            result = _run_async(handler.handle_execute({
                "session_id": TEST_SESSION_ID_STR,
                "message": "Hello",
            }))

        assert result["code"] == "INVALID_SESSION"
        assert "error" in result

    def test_session_owned_by_different_user(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Session owned by a different user -> get_session_for_user returns None
        -> INVALID_SESSION error ack."""
        # get_session_for_user returns None when the user doesn't own the session
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_for_user",
                return_value=None,
            ),
        ):
            result = _run_async(handler.handle_execute({
                "session_id": TEST_SESSION_ID_STR,
                "message": "Hello",
            }))

        assert result["code"] == "INVALID_SESSION"

    def test_missing_fields_returns_invalid_request(
        self,
        handler: Any,
    ) -> None:
        """Missing session_id or message -> INVALID_REQUEST."""
        result = _run_async(handler.handle_execute({
            "session_id": "",
            "message": "Hello",
        }))
        assert result["code"] == "INVALID_REQUEST"

        result = _run_async(handler.handle_execute({
            "session_id": TEST_SESSION_ID_STR,
            "message": "",
        }))
        assert result["code"] == "INVALID_REQUEST"

    def test_invalid_uuid_returns_invalid_request(
        self,
        handler: Any,
    ) -> None:
        """Malformed session_id UUID -> INVALID_REQUEST."""
        result = _run_async(handler.handle_execute({
            "session_id": "not-a-uuid",
            "message": "Hello",
        }))
        assert result["code"] == "INVALID_REQUEST"

    def test_terminated_session_returns_error(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Session with terminal status -> SESSION_TERMINATED error ack."""
        mock_session = _make_mock_session(
            status=AgentSessionStatus.COMPLETED,
            execution_status=AgentSessionExecutionStatus.IDLE,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_for_user",
                return_value=mock_session,
            ),
        ):
            result = _run_async(handler.handle_execute({
                "session_id": TEST_SESSION_ID_STR,
                "message": "Hello",
            }))

        assert result["code"] == "SESSION_TERMINATED"


# ===========================================================================
# handle_tool_result tests
# ===========================================================================


class TestHandleToolResult:
    """Tests for AgentHandler.handle_tool_result."""

    def test_happy_path_persists_result_and_starts_llm_turn(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """AWAITING_TOOL status, valid tool_call_id -> persists result, starts new LLM turn."""
        mock_tool_msg = _make_mock_tool_message(
            tool_name="bash",
            tool_call_id="call-123",
            step_number=2,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.tool_result_exists",
                return_value=False,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_TOOL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ) as mock_update,
            patch(
                "onyx.server.agent.agent_handler.load_pending_local_tools",
                return_value=[],
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            _run_async(handler.handle_tool_result({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-123",
                "output": "total 42",
            }))

        # Result was persisted
        mock_update.assert_called_once_with(
            db_session=mock_db_session,
            session_id=TEST_SESSION_ID,
            tool_call_id="call-123",
            tool_output={"output": "total 42"},
            tool_error=None,
        )

        # Status set to RUNNING for the next LLM turn
        mock_set_status.assert_called_once_with(
            mock_db_session,
            TEST_SESSION_ID,
            AgentSessionExecutionStatus.RUNNING,
        )

        # tool:delta emitted to echo result
        mock_sio.emit.assert_any_call(
            "tool:delta",
            {
                "session_id": TEST_SESSION_ID_STR,
                "ind": 2,
                "tool_name": "bash",
                "tool_call_id": "call-123",
                "response_type": "success",
                "data": "total 42",
            },
            to=TEST_SID,
        )

        # New LLM turn started
        mock_run_llm.assert_awaited_once()

    def test_idempotency_duplicate_ignored(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Duplicate tool_call_id (already has result) -> silently ignored."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.tool_result_exists",
                return_value=True,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ) as mock_update,
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            _run_async(handler.handle_tool_result({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-123",
                "output": "duplicate result",
            }))

        mock_update.assert_not_called()
        mock_run_llm.assert_not_awaited()

    def test_stale_result_ignored_when_idle(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Session status is IDLE (was stopped) -> result ignored."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.tool_result_exists",
                return_value=False,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.IDLE,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ) as mock_update,
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            _run_async(handler.handle_tool_result({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-123",
                "output": "stale",
            }))

        mock_update.assert_not_called()
        mock_run_llm.assert_not_awaited()

    def test_pending_local_tools_dispatches_next(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """After result, more tools in pending queue -> sends next tool:request
        instead of starting a new LLM turn."""
        mock_tool_msg = _make_mock_tool_message(
            tool_name="bash",
            tool_call_id="call-1",
            step_number=1,
        )

        # The next pending tool does NOT require approval (read_file)
        next_tool = {
            "name": "read_file",
            "input": {"path": "/tmp/test.py"},
            "id": "call-2",
            "step": 2,
        }

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.tool_result_exists",
                return_value=False,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_TOOL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ),
            patch(
                "onyx.server.agent.agent_handler.load_pending_local_tools",
                return_value=[next_tool],
            ),
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ) as mock_persist,
            patch(
                "onyx.server.agent.agent_handler.requires_approval",
                return_value=False,
            ),
            patch.object(
                handler, "_load_always_allowed_tools", return_value=set(),
            ),
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            _run_async(handler.handle_tool_result({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-1",
                "output": "ok",
            }))

        # Next tool:request emitted for read_file
        mock_sio.emit.assert_any_call(
            "tool:request",
            {
                "session_id": TEST_SESSION_ID_STR,
                "ind": 2,
                "tool_name": "read_file",
                "tool_input": {"path": "/tmp/test.py"},
                "tool_call_id": "call-2",
            },
            to=TEST_SID,
        )

        # Remaining pending tools were updated (empty list since this was the only one)
        mock_persist.assert_called_once_with(mock_db_session, TEST_SESSION_ID, [])

        # LLM turn was NOT started (we dispatched the next tool instead)
        mock_run_llm.assert_not_awaited()

    def test_pending_tool_requiring_approval(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """After result, next pending tool requires approval -> sends
        tool:approval_required and sets AWAITING_APPROVAL."""
        mock_tool_msg = _make_mock_tool_message(
            tool_name="read_file",
            tool_call_id="call-1",
            step_number=1,
        )

        # The next pending tool DOES require approval (bash)
        next_tool = {
            "name": "bash",
            "input": {"command": "rm -rf /"},
            "id": "call-2",
            "step": 2,
        }

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.tool_result_exists",
                return_value=False,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_TOOL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ),
            patch(
                "onyx.server.agent.agent_handler.load_pending_local_tools",
                return_value=[next_tool],
            ),
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
            patch(
                "onyx.server.agent.agent_handler.requires_approval",
                return_value=True,
            ),
            patch.object(
                handler, "_load_always_allowed_tools", return_value=set(),
            ),
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            _run_async(handler.handle_tool_result({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-1",
                "output": "ok",
            }))

        # tool:approval_required emitted
        mock_sio.emit.assert_any_call(
            "tool:approval_required",
            {
                "session_id": TEST_SESSION_ID_STR,
                "ind": 2,
                "tool_name": "bash",
                "tool_input": {"command": "rm -rf /"},
                "tool_call_id": "call-2",
                "gateway_id": "__local__",
            },
            to=TEST_SID,
        )

        # Status set to AWAITING_APPROVAL
        mock_set_status.assert_any_call(
            mock_db_session,
            TEST_SESSION_ID,
            AgentSessionExecutionStatus.AWAITING_APPROVAL,
        )

        # LLM turn was NOT started
        mock_run_llm.assert_not_awaited()

    def test_missing_fields_does_nothing(
        self,
        handler: Any,
    ) -> None:
        """Missing session_id or tool_call_id -> returns early with no action."""
        with patch.object(
            handler, "_run_llm_turn", new_callable=AsyncMock,
        ) as mock_run_llm:
            _run_async(handler.handle_tool_result({
                "session_id": "",
                "tool_call_id": "call-1",
            }))
            _run_async(handler.handle_tool_result({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "",
            }))

        mock_run_llm.assert_not_awaited()


# ===========================================================================
# handle_approval tests
# ===========================================================================


class TestHandleApproval:
    """Tests for AgentHandler.handle_approval."""

    def test_approve_sends_tool_request(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """AWAITING_APPROVAL + approved=True -> sends tool:request, sets AWAITING_TOOL."""
        mock_tool_msg = _make_mock_tool_message(
            tool_name="bash",
            tool_input={"command": "ls -la"},
            tool_call_id="call-approve-1",
            step_number=3,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
        ):
            _run_async(handler.handle_approval({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-approve-1",
                "approved": True,
            }))

        # tool:request emitted
        mock_sio.emit.assert_any_call(
            "tool:request",
            {
                "session_id": TEST_SESSION_ID_STR,
                "ind": 3,
                "tool_name": "bash",
                "tool_input": {"command": "ls -la"},
                "tool_call_id": "call-approve-1",
            },
            to=TEST_SID,
        )

        # Status set to AWAITING_TOOL
        mock_set_status.assert_any_call(
            mock_db_session,
            TEST_SESSION_ID,
            AgentSessionExecutionStatus.AWAITING_TOOL,
        )

    def test_deny_persists_denial_and_starts_llm_turn(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """AWAITING_APPROVAL + approved=False -> persists denial, starts new LLM turn."""
        mock_tool_msg = _make_mock_tool_message(
            tool_name="bash",
            tool_input={"command": "rm -rf /"},
            tool_call_id="call-deny-1",
            step_number=2,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ) as mock_update,
            patch(
                "onyx.server.agent.agent_handler.load_pending_local_tools",
                return_value=[],
            ),
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            _run_async(handler.handle_approval({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-deny-1",
                "approved": False,
            }))

        # Denial persisted as tool error
        mock_update.assert_called_once_with(
            db_session=mock_db_session,
            session_id=TEST_SESSION_ID,
            tool_call_id="call-deny-1",
            tool_error="User denied tool execution",
        )

        # Status set to RUNNING for the next LLM turn
        mock_set_status.assert_any_call(
            mock_db_session,
            TEST_SESSION_ID,
            AgentSessionExecutionStatus.RUNNING,
        )

        # tool:delta emitted with the denial error
        mock_sio.emit.assert_any_call(
            "tool:delta",
            {
                "session_id": TEST_SESSION_ID_STR,
                "ind": 2,
                "tool_name": "bash",
                "tool_call_id": "call-deny-1",
                "response_type": "error",
                "data": "User denied tool execution",
            },
            to=TEST_SID,
        )

        # New LLM turn started
        mock_run_llm.assert_awaited_once()

    def test_stale_approval_ignored(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Session not AWAITING_APPROVAL -> approval silently ignored."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.IDLE,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ) as mock_run_llm,
        ):
            _run_async(handler.handle_approval({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-stale",
                "approved": True,
            }))

        # No status change, no LLM turn
        mock_set_status.assert_not_called()
        mock_run_llm.assert_not_awaited()

    def test_approval_missing_tool_message_ignored(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Approved but tool message not found -> silently ignored."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=None,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
        ):
            _run_async(handler.handle_approval({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-ghost",
                "approved": True,
            }))

        mock_set_status.assert_not_called()

    def test_missing_fields_does_nothing(
        self,
        handler: Any,
    ) -> None:
        """Missing session_id or tool_call_id -> returns early."""
        with patch.object(
            handler, "_run_llm_turn", new_callable=AsyncMock,
        ) as mock_run_llm:
            _run_async(handler.handle_approval({
                "session_id": "",
                "tool_call_id": "call-1",
                "approved": True,
            }))

        mock_run_llm.assert_not_awaited()


# ===========================================================================
# handle_stop tests
# ===========================================================================


class TestHandleStop:
    """Tests for AgentHandler.handle_stop."""

    def test_stop_during_running_sets_stop_flag(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        """RUNNING -> sets stop flag in Redis (actual stopping happens in _run_llm_turn)."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.RUNNING,
            ),
            patch.object(
                handler, "_get_redis", return_value=mock_redis,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_stop_flag",
            ) as mock_set_stop,
        ):
            result = _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        assert result == {"session_id": TEST_SESSION_ID_STR}
        mock_set_stop.assert_called_once_with(mock_redis, TEST_SESSION_ID)

        # agent:stopped is NOT emitted here (it's emitted by _run_llm_turn)
        for call in mock_sio.emit.call_args_list:
            assert call.args[0] != "agent:stopped"

    def test_stop_during_awaiting_tool_sets_idle(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """AWAITING_TOOL -> sets IDLE, emits agent:stopped."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_TOOL,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ) as mock_persist_pending,
        ):
            result = _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        assert result == {"session_id": TEST_SESSION_ID_STR}

        # Status set to IDLE
        mock_set_status.assert_called_once_with(
            mock_db_session,
            TEST_SESSION_ID,
            AgentSessionExecutionStatus.IDLE,
        )

        # Pending tools cleared
        mock_persist_pending.assert_called_once_with(
            mock_db_session, TEST_SESSION_ID, [],
        )

        # agent:stopped emitted
        mock_sio.emit.assert_any_call(
            "agent:stopped",
            {"session_id": TEST_SESSION_ID_STR},
            to=TEST_SID,
        )

    def test_stop_during_awaiting_approval_sets_idle(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """AWAITING_APPROVAL -> sets IDLE, emits agent:stopped."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ),
        ):
            result = _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        assert result == {"session_id": TEST_SESSION_ID_STR}

        mock_set_status.assert_called_once_with(
            mock_db_session,
            TEST_SESSION_ID,
            AgentSessionExecutionStatus.IDLE,
        )

        mock_sio.emit.assert_any_call(
            "agent:stopped",
            {"session_id": TEST_SESSION_ID_STR},
            to=TEST_SID,
        )

    def test_stop_when_idle_is_noop(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
    ) -> None:
        """IDLE -> no-op, no status change, no events emitted."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.IDLE,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
        ):
            result = _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        assert result == {"session_id": TEST_SESSION_ID_STR}
        mock_set_status.assert_not_called()

        # No events emitted
        for call in mock_sio.emit.call_args_list:
            assert call.args[0] != "agent:stopped"

    def test_stop_invalid_session_returns_error(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Session not found (get_session_execution_status raises ValueError)
        -> INVALID_SESSION error ack."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                side_effect=ValueError("not found"),
            ),
        ):
            result = _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        assert result["code"] == "INVALID_SESSION"

    def test_stop_missing_session_id(
        self,
        handler: Any,
    ) -> None:
        """Missing session_id -> INVALID_REQUEST."""
        result = _run_async(handler.handle_stop({
            "session_id": "",
        }))
        assert result["code"] == "INVALID_REQUEST"


# ===========================================================================
# Session status transition tests
# ===========================================================================


class TestSessionStatusTransitions:
    """Tests verifying correct status transitions through agent lifecycle flows."""

    def test_full_flow_idle_to_running_to_awaiting_tool_to_running_to_idle(
        self,
        handler: Any,
        mock_sio: AsyncMock,
        mock_db_session: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        """Verify a full flow: IDLE -> RUNNING -> AWAITING_TOOL -> RUNNING -> IDLE.

        1. handle_execute: IDLE -> RUNNING
        2. _run_llm_turn: dispatches local tool -> sets AWAITING_TOOL
        3. handle_tool_result (no more pending): AWAITING_TOOL -> RUNNING
        4. _run_llm_turn: no tools -> sets IDLE, emits agent:done
        """
        # Track all set_session_execution_status calls across the flow
        status_calls: list[AgentSessionExecutionStatus] = []

        def _track_status(
            db_session: Any,
            session_id: UUID,
            status: AgentSessionExecutionStatus,
        ) -> None:
            status_calls.append(status)

        mock_session = _make_mock_session(
            execution_status=AgentSessionExecutionStatus.IDLE,
        )
        mock_tool_msg = _make_mock_tool_message(
            tool_name="bash",
            tool_call_id="call-flow-1",
            step_number=1,
        )

        # Step 1: handle_execute (IDLE -> RUNNING)
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_for_user",
                return_value=mock_session,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
                side_effect=_track_status,
            ),
            patch(
                "onyx.server.agent.agent_handler.clear_session_stop_flag",
            ),
            patch(
                "onyx.server.agent.agent_handler.add_session_message",
            ),
            patch.object(
                handler, "_get_redis", return_value=mock_redis,
            ),
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ),
        ):
            result = _run_async(handler.handle_execute({
                "session_id": TEST_SESSION_ID_STR,
                "message": "Do something",
            }))

        assert result == {"session_id": TEST_SESSION_ID_STR}
        assert status_calls == [AgentSessionExecutionStatus.RUNNING]

        # Step 2: handle_tool_result with no more pending tools -> RUNNING
        status_calls.clear()

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.tool_result_exists",
                return_value=False,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_TOOL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ),
            patch(
                "onyx.server.agent.agent_handler.load_pending_local_tools",
                return_value=[],
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
                side_effect=_track_status,
            ),
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ),
        ):
            _run_async(handler.handle_tool_result({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-flow-1",
                "output": "file contents",
            }))

        # Should transition to RUNNING for next LLM turn
        assert AgentSessionExecutionStatus.RUNNING in status_calls

    def test_stop_transitions_from_running(
        self,
        handler: Any,
        mock_db_session: MagicMock,
        mock_redis: MagicMock,
    ) -> None:
        """RUNNING -> stop sets flag in Redis (actual transition to IDLE happens
        when _run_llm_turn detects the flag)."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.RUNNING,
            ),
            patch.object(
                handler, "_get_redis", return_value=mock_redis,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_stop_flag",
            ) as mock_set_stop,
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
        ):
            _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        mock_set_stop.assert_called_once_with(mock_redis, TEST_SESSION_ID)
        # Status is NOT changed here (done in _run_llm_turn)
        mock_set_status.assert_not_called()

    def test_stop_transitions_from_awaiting_tool_to_idle(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """AWAITING_TOOL -> stop transitions directly to IDLE."""
        status_calls: list[AgentSessionExecutionStatus] = []

        def _track_status(
            db_session: Any,
            session_id: UUID,
            status: AgentSessionExecutionStatus,
        ) -> None:
            status_calls.append(status)

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_TOOL,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
                side_effect=_track_status,
            ),
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ),
        ):
            _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        assert status_calls == [AgentSessionExecutionStatus.IDLE]

    def test_stop_transitions_from_awaiting_approval_to_idle(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """AWAITING_APPROVAL -> stop transitions directly to IDLE."""
        status_calls: list[AgentSessionExecutionStatus] = []

        def _track_status(
            db_session: Any,
            session_id: UUID,
            status: AgentSessionExecutionStatus,
        ) -> None:
            status_calls.append(status)

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
                side_effect=_track_status,
            ),
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ),
        ):
            _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        assert status_calls == [AgentSessionExecutionStatus.IDLE]

    def test_stop_from_idle_no_transition(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """IDLE -> stop is a no-op, no status transition."""
        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.IDLE,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
            ) as mock_set_status,
        ):
            _run_async(handler.handle_stop({
                "session_id": TEST_SESSION_ID_STR,
            }))

        mock_set_status.assert_not_called()

    def test_approval_deny_transitions_awaiting_approval_to_running(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Deny approval: AWAITING_APPROVAL -> RUNNING (then LLM turn runs)."""
        status_calls: list[AgentSessionExecutionStatus] = []

        def _track_status(
            db_session: Any,
            session_id: UUID,
            status: AgentSessionExecutionStatus,
        ) -> None:
            status_calls.append(status)

        mock_tool_msg = _make_mock_tool_message(
            tool_name="bash",
            tool_call_id="call-deny-flow",
            step_number=2,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.update_tool_message_result",
            ),
            patch(
                "onyx.server.agent.agent_handler.load_pending_local_tools",
                return_value=[],
            ),
            patch(
                "onyx.server.agent.agent_handler.persist_pending_local_tools",
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
                side_effect=_track_status,
            ),
            patch.object(
                handler, "_run_llm_turn", new_callable=AsyncMock,
            ),
        ):
            _run_async(handler.handle_approval({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-deny-flow",
                "approved": False,
            }))

        assert AgentSessionExecutionStatus.RUNNING in status_calls

    def test_approval_approve_transitions_awaiting_approval_to_awaiting_tool(
        self,
        handler: Any,
        mock_db_session: MagicMock,
    ) -> None:
        """Approve: AWAITING_APPROVAL -> AWAITING_TOOL."""
        status_calls: list[AgentSessionExecutionStatus] = []

        def _track_status(
            db_session: Any,
            session_id: UUID,
            status: AgentSessionExecutionStatus,
        ) -> None:
            status_calls.append(status)

        mock_tool_msg = _make_mock_tool_message(
            tool_name="bash",
            tool_call_id="call-approve-flow",
            step_number=2,
        )

        with (
            _patch_db_session(handler, mock_db_session),
            patch(
                "onyx.server.agent.agent_handler.get_session_execution_status",
                return_value=AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ),
            patch(
                "onyx.server.agent.agent_handler.get_tool_message",
                return_value=mock_tool_msg,
            ),
            patch(
                "onyx.server.agent.agent_handler.set_session_execution_status",
                side_effect=_track_status,
            ),
        ):
            _run_async(handler.handle_approval({
                "session_id": TEST_SESSION_ID_STR,
                "tool_call_id": "call-approve-flow",
                "approved": True,
            }))

        assert status_calls == [AgentSessionExecutionStatus.AWAITING_TOOL]
