"""Unit tests for onyx.agents.bud_agent.turn_driver.

Mocks all external dependencies (LLM, DB, agent_context) so the tests
run without any services or heavy imports.
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch
from uuid import uuid4

import pytest

# ---------------------------------------------------------------------------
# Pre-install a mock agent_context module to avoid heavy transitive imports
# (redis, SQLAlchemy models, agents SDK, openai, etc.).
# ---------------------------------------------------------------------------
_mock_agent_context = MagicMock()


class _FakeAgentExecutionMode:
    INTERACTIVE = "interactive"
    CRON = "cron"
    INBOX = "inbox"
    EXTERNAL = "external"


_mock_agent_context.AgentExecutionMode = _FakeAgentExecutionMode
_mock_agent_context.persist_turn_result = MagicMock()
_mock_agent_context.build_message_history = MagicMock(
    return_value=[{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}]
)

sys.modules.setdefault("onyx.agents.bud_agent.agent_context", _mock_agent_context)

# Now import the module under test (it will find agent_context in sys.modules)
from onyx.agents.bud_agent.llm_turn import ToolCallInfo, TurnResult
from onyx.agents.bud_agent.turn_driver import (
    TurnDriver,
    TurnDriverConfig,
    TurnDriverResult,
    classify_tool_calls,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_tool_call(name: str, call_id: str = "c1") -> ToolCallInfo:
    return ToolCallInfo(name=name, input={}, call_id=call_id, raw_item=None)


def _make_turn_result(
    text: str = "",
    tool_calls: list[ToolCallInfo] | None = None,
    stopped: bool = False,
    final_messages: list[dict[str, Any]] | None = None,
) -> TurnResult:
    tcs = tool_calls or []
    return TurnResult(
        full_response_text=text,
        thinking_content="",
        tool_calls=tcs,
        tool_call_count=len(tcs),
        final_messages=final_messages or [{"role": "assistant", "content": text}],
        stopped=stopped,
    )


def _make_config(
    mode: str = "interactive",
    max_tool_calls: int = 500,
    should_stop: Any = None,
    emitter: Any = None,
    tool_requester: Any = None,
    on_turn_complete: Any = None,
) -> TurnDriverConfig:
    return TurnDriverConfig(
        mode=mode,  # type: ignore[arg-type]
        max_tool_calls=max_tool_calls,
        should_stop=should_stop,
        emitter=emitter,
        tool_requester=tool_requester,
        on_turn_complete=on_turn_complete,
    )


def _make_ctx(
    connector_approval_tools: set[str] | None = None,
) -> MagicMock:
    """Build a mock AgentRunContext."""
    ctx = MagicMock()
    ctx.agent = MagicMock()
    ctx.run_config = MagicMock()
    ctx.system_prompt = "You are helpful."
    ctx.connector_approval_tools = connector_approval_tools or set()
    return ctx


def _make_db_session() -> MagicMock:
    return MagicMock()


# ---------------------------------------------------------------------------
# Tests for classify_tool_calls
# ---------------------------------------------------------------------------


class TestClassifyToolCalls:
    def test_local_tool(self) -> None:
        """Local tools (e.g. bash) are classified as local."""
        tc = _make_tool_call("bash")
        local, remote = classify_tool_calls([tc], set())
        assert len(local) == 1
        assert len(remote) == 0
        assert local[0].name == "bash"

    def test_remote_tool(self) -> None:
        """Remote tools (e.g. web_search) are classified as remote."""
        tc = _make_tool_call("web_search")
        local, remote = classify_tool_calls([tc], set())
        assert len(local) == 0
        assert len(remote) == 1
        assert remote[0].name == "web_search"

    def test_pause_tool(self) -> None:
        """Pause tools like ask_user_questions are classified as local."""
        tc = _make_tool_call("ask_user_questions")
        local, remote = classify_tool_calls([tc], set())
        assert len(local) == 1
        assert len(remote) == 0

    def test_connector_approval_tool(self) -> None:
        """Tools in connector_approval_tools are classified as local."""
        tc = _make_tool_call("my_connector")
        local, remote = classify_tool_calls([tc], {"my_connector"})
        assert len(local) == 1
        assert len(remote) == 0

    def test_mixed(self) -> None:
        """Mixed tool calls are correctly split."""
        tcs = [
            _make_tool_call("bash", "c1"),
            _make_tool_call("web_search", "c2"),
            _make_tool_call("ask_user_questions", "c3"),
            _make_tool_call("memory_store", "c4"),
        ]
        local, remote = classify_tool_calls(tcs, set())
        assert [tc.name for tc in local] == ["bash", "ask_user_questions"]
        assert [tc.name for tc in remote] == ["web_search", "memory_store"]

    def test_empty(self) -> None:
        """Empty list returns two empty lists."""
        local, remote = classify_tool_calls([], set())
        assert local == []
        assert remote == []


# ---------------------------------------------------------------------------
# Tests for TurnDriver.run_next_turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
@patch("onyx.agents.bud_agent.turn_driver.persist_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.set_session_execution_status")
async def test_remote_only_tools_recurse_to_complete(
    mock_set_status: MagicMock,
    mock_persist_pending: MagicMock,
    mock_run_llm: AsyncMock,
) -> None:
    """When all tool calls are remote, TurnDriver recurses until complete."""
    # First call: remote tool only; second call: no tools (complete)
    turn_with_remote = _make_turn_result(
        text="",
        tool_calls=[_make_tool_call("web_search")],
        final_messages=[{"role": "assistant", "content": "searched"}],
    )
    turn_complete = _make_turn_result(text="Done!")

    mock_run_llm.side_effect = [turn_with_remote, turn_complete]

    config = _make_config()
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)
    session_id = uuid4()

    result = await driver.run_next_turn(
        session_id=session_id,
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "hi"}],
    )

    assert result.status == "complete"
    assert result.turn is not None
    assert result.turn.full_response_text == "Done!"
    assert mock_run_llm.call_count == 2
    # Second call should have an advanced step_number (past the remote tools)
    second_call_kwargs = mock_run_llm.call_args_list[1].kwargs
    assert second_call_kwargs.get("initial_step_number", 0) > 0
    # No pending tools should be persisted (no local tools)
    mock_persist_pending.assert_not_called()
    mock_set_status.assert_not_called()


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
@patch("onyx.agents.bud_agent.turn_driver.persist_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.set_session_execution_status")
async def test_local_tool_returns_awaiting_tool(
    mock_set_status: MagicMock,
    mock_persist_pending: MagicMock,
    mock_run_llm: AsyncMock,
) -> None:
    """When a local tool is present, TurnDriver pauses and returns awaiting_tool."""
    turn_with_local = _make_turn_result(
        text="Let me run that.",
        tool_calls=[_make_tool_call("bash", "c1")],
    )
    mock_run_llm.return_value = turn_with_local

    requester = AsyncMock()
    config = _make_config(tool_requester=requester)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)
    session_id = uuid4()

    result = await driver.run_next_turn(
        session_id=session_id,
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "run ls"}],
    )

    assert result.status == "awaiting_tool"
    assert result.pending == []  # only 1 local tool, so nothing remaining
    requester.request.assert_awaited_once()
    # Check the dispatched tool via requester mock
    dispatched_tool = requester.request.call_args[0][0]
    assert dispatched_tool["name"] == "bash"
    assert dispatched_tool["call_id"] == "c1"
    # Check the dispatched_tool field on the result
    assert result.dispatched_tool is not None
    assert result.dispatched_tool["name"] == "bash"
    assert result.dispatched_tool["call_id"] == "c1"
    # Status should be set to AWAITING_TOOL
    mock_set_status.assert_called_once()


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
@patch("onyx.agents.bud_agent.turn_driver.persist_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.set_session_execution_status")
async def test_multiple_local_tools_first_dispatched_rest_persisted(
    mock_set_status: MagicMock,
    mock_persist_pending: MagicMock,
    mock_run_llm: AsyncMock,
) -> None:
    """With multiple local tools, the first is dispatched and the rest persisted."""
    turn = _make_turn_result(
        tool_calls=[
            _make_tool_call("bash", "c1"),
            _make_tool_call("write_file", "c2"),
            _make_tool_call("edit_file", "c3"),
        ],
    )
    mock_run_llm.return_value = turn

    requester = AsyncMock()
    config = _make_config(tool_requester=requester)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)
    session_id = uuid4()

    result = await driver.run_next_turn(
        session_id=session_id,
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "do stuff"}],
    )

    assert result.status == "awaiting_tool"
    # Two remaining tools after dispatching the first
    assert len(result.pending) == 2
    assert result.pending[0]["name"] == "write_file"
    assert result.pending[1]["name"] == "edit_file"

    # First tool dispatched
    dispatched = requester.request.call_args[0][0]
    assert dispatched["name"] == "bash"

    # Remaining persisted
    persisted_tools = mock_persist_pending.call_args[1].get("tools") or mock_persist_pending.call_args[0][2]
    assert len(persisted_tools) == 2


@pytest.mark.asyncio
async def test_max_tool_calls_reached() -> None:
    """When total tool calls exceed max, status is max_tools_reached."""
    config = _make_config(max_tool_calls=5)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)
    # Simulate prior tool calls
    driver._total_tool_calls = 5

    result = await driver.run_next_turn(
        session_id=uuid4(),
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "hi"}],
    )

    assert result.status == "max_tools_reached"
    assert result.turn is None


@pytest.mark.asyncio
async def test_should_stop_returns_stopped() -> None:
    """When should_stop returns True, status is stopped immediately."""
    config = _make_config(should_stop=lambda: True)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    result = await driver.run_next_turn(
        session_id=uuid4(),
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "hi"}],
    )

    assert result.status == "stopped"
    assert result.turn is None


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
async def test_on_turn_complete_fires(mock_run_llm: AsyncMock) -> None:
    """on_turn_complete callback fires after each LLM turn."""
    turn = _make_turn_result(text="All done.")
    mock_run_llm.return_value = turn

    received_turns: list[TurnResult] = []

    async def on_complete(t: TurnResult) -> None:
        received_turns.append(t)

    config = _make_config(on_turn_complete=on_complete)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    await driver.run_next_turn(
        session_id=uuid4(),
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "hi"}],
    )

    assert len(received_turns) == 1
    assert received_turns[0].full_response_text == "All done."


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
async def test_no_emitter_callbacks_have_should_stop(mock_run_llm: AsyncMock) -> None:
    """Without an emitter, callbacks still wire up should_stop."""
    turn = _make_turn_result(text="ok")
    mock_run_llm.return_value = turn

    stop_called = False

    def should_stop() -> bool:
        nonlocal stop_called
        stop_called = True
        return False  # don't actually stop

    config = _make_config(should_stop=should_stop)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    await driver.run_next_turn(
        session_id=uuid4(),
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "hi"}],
    )

    # Verify the should_stop was wired into callbacks by checking
    # that run_llm_turn was called with callbacks that have should_stop
    call_kwargs = mock_run_llm.call_args[1] if mock_run_llm.call_args[1] else {}
    call_args = mock_run_llm.call_args[0] if mock_run_llm.call_args[0] else ()
    # callbacks is either a kwarg or the 4th positional arg
    callbacks = call_kwargs.get("callbacks")
    if callbacks is None and len(call_args) >= 4:
        callbacks = call_args[3]
    assert callbacks is not None
    assert callbacks.should_stop is not None


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
@patch("onyx.agents.bud_agent.turn_driver.persist_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.set_session_execution_status")
async def test_no_tool_requester_still_returns_awaiting(
    mock_set_status: MagicMock,
    mock_persist_pending: MagicMock,
    mock_run_llm: AsyncMock,
) -> None:
    """Without a tool_requester, awaiting_tool is returned but nothing dispatched."""
    turn = _make_turn_result(tool_calls=[_make_tool_call("bash")])
    mock_run_llm.return_value = turn

    config = _make_config(tool_requester=None)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    result = await driver.run_next_turn(
        session_id=uuid4(),
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "hi"}],
    )

    assert result.status == "awaiting_tool"


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
async def test_llm_stopped_returns_stopped(mock_run_llm: AsyncMock) -> None:
    """When the LLM turn itself is stopped, status is stopped."""
    turn = _make_turn_result(text="partial", stopped=True)
    mock_run_llm.return_value = turn

    config = _make_config()
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    result = await driver.run_next_turn(
        session_id=uuid4(),
        db_session=_make_db_session(),
        messages=[{"role": "user", "content": "hi"}],
    )

    assert result.status == "stopped"
    assert result.turn is not None
    assert result.turn.stopped is True


# ---------------------------------------------------------------------------
# Tests for TurnDriver.handle_tool_result
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
@patch("onyx.agents.bud_agent.turn_driver.load_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.persist_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.update_tool_message_result")
@patch("onyx.agents.bud_agent.turn_driver.set_session_execution_status")
async def test_handle_tool_result_with_remaining_dispatches_next(
    mock_set_status: MagicMock,
    mock_update: MagicMock,
    mock_persist_pending: MagicMock,
    mock_load_pending: MagicMock,
    mock_run_llm: AsyncMock,
) -> None:
    """When pending tools remain, handle_tool_result dispatches the next one."""
    mock_load_pending.return_value = [
        {"name": "write_file", "input": {}, "call_id": "c2"},
        {"name": "edit_file", "input": {}, "call_id": "c3"},
    ]

    requester = AsyncMock()
    config = _make_config(tool_requester=requester)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    result = await driver.handle_tool_result(
        session_id=uuid4(),
        db_session=_make_db_session(),
        tool_call_id="c1",
        output="success",
        error=None,
    )

    assert result.status == "awaiting_tool"
    assert len(result.pending) == 1  # edit_file remains
    # write_file should have been dispatched
    dispatched = requester.request.call_args[0][0]
    assert dispatched["name"] == "write_file"
    # update_tool_message_result called for c1
    mock_update.assert_called_once()


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
@patch("onyx.agents.bud_agent.turn_driver.load_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.persist_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.update_tool_message_result")
@patch("onyx.agents.bud_agent.turn_driver.set_session_execution_status")
async def test_handle_tool_result_none_remaining_runs_next_turn(
    mock_set_status: MagicMock,
    mock_update: MagicMock,
    mock_persist_pending: MagicMock,
    mock_load_pending: MagicMock,
    mock_run_llm: AsyncMock,
) -> None:
    """When no pending tools remain, handle_tool_result runs the next LLM turn."""
    mock_load_pending.return_value = []  # no more pending
    turn_complete = _make_turn_result(text="Final answer.")
    mock_run_llm.return_value = turn_complete

    config = _make_config()
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    result = await driver.handle_tool_result(
        session_id=uuid4(),
        db_session=_make_db_session(),
        tool_call_id="c1",
        output="done",
        error=None,
    )

    assert result.status == "complete"
    assert result.turn is not None
    assert result.turn.full_response_text == "Final answer."
    # Execution status should have been set to RUNNING before next turn
    mock_set_status.assert_called()
    # build_message_history was called (via the lazy import)
    _mock_agent_context.build_message_history.assert_called()


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
@patch("onyx.agents.bud_agent.turn_driver.load_pending_local_tools")
@patch("onyx.agents.bud_agent.turn_driver.update_tool_message_result")
@patch("onyx.agents.bud_agent.turn_driver.set_session_execution_status")
async def test_handle_tool_result_with_error(
    mock_set_status: MagicMock,
    mock_update: MagicMock,
    mock_load_pending: MagicMock,
    mock_run_llm: AsyncMock,
) -> None:
    """Tool results with errors are still processed."""
    mock_load_pending.return_value = []
    turn_complete = _make_turn_result(text="I see the error.")
    mock_run_llm.return_value = turn_complete

    config = _make_config()
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    result = await driver.handle_tool_result(
        session_id=uuid4(),
        db_session=_make_db_session(),
        tool_call_id="c1",
        output=None,
        error="command failed",
    )

    assert result.status == "complete"
    mock_update.assert_called_once()
    call_kwargs = mock_update.call_args[1] if mock_update.call_args[1] else {}
    assert call_kwargs.get("tool_error") == "command failed"


# ---------------------------------------------------------------------------
# Tests for _build_callbacks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@patch("onyx.agents.bud_agent.turn_driver.run_llm_turn")
async def test_build_callbacks_with_emitter(mock_run_llm: AsyncMock) -> None:
    """When an emitter is provided, callbacks are wired to it."""
    turn = _make_turn_result(text="hi")
    mock_run_llm.return_value = turn

    emitter = AsyncMock()
    config = _make_config(emitter=emitter)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    # Build callbacks directly
    callbacks = driver._build_callbacks(step_number=5)

    assert callbacks.on_reasoning_start is not None
    assert callbacks.on_reasoning_delta is not None
    assert callbacks.on_text_start is not None
    assert callbacks.on_text_delta is not None
    assert callbacks.on_section_end is not None
    assert callbacks.should_stop is None  # no should_stop in config


@pytest.mark.asyncio
async def test_build_callbacks_without_emitter() -> None:
    """Without an emitter, only should_stop is set on callbacks."""
    def stop_fn() -> bool:
        return False

    config = _make_config(should_stop=stop_fn)
    ctx = _make_ctx()
    driver = TurnDriver(config, ctx)

    callbacks = driver._build_callbacks(step_number=0)

    assert callbacks.on_reasoning_start is None
    assert callbacks.on_reasoning_delta is None
    assert callbacks.on_text_start is None
    assert callbacks.on_text_delta is None
    assert callbacks.on_section_end is None
    assert callbacks.should_stop is stop_fn


# ---------------------------------------------------------------------------
# Tests for TurnDriverResult / TurnDriverConfig defaults
# ---------------------------------------------------------------------------


class TestTurnDriverResultDefaults:
    def test_defaults(self) -> None:
        result = TurnDriverResult(status="complete")
        assert result.status == "complete"
        assert result.turn is None
        assert result.pending == []

    def test_with_values(self) -> None:
        turn = _make_turn_result(text="hi")
        pending = [{"name": "bash", "input": {}, "call_id": "c1"}]
        result = TurnDriverResult(
            status="awaiting_tool",
            turn=turn,
            pending=pending,
        )
        assert result.status == "awaiting_tool"
        assert result.turn is turn
        assert len(result.pending) == 1


class TestTurnDriverConfigDefaults:
    def test_defaults(self) -> None:
        config = TurnDriverConfig(mode="interactive")  # type: ignore[arg-type]
        assert config.max_tool_calls == 500
        assert config.should_stop is None
        assert config.emitter is None
        assert config.tool_requester is None
        assert config.on_turn_complete is None
