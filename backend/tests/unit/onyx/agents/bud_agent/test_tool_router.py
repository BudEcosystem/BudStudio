"""Unit tests for ToolRouter and ToolExecutor classes.

Tests cover:
- LocalToolExecutor.can_handle() / execute()
- RemoteToolExecutor.can_handle() / execute()
- ConnectorToolExecutor.can_handle() / execute()
- ToolRouter.get_executor() routing
- ToolRouter.execute() lifecycle events (tool:start, tool:delta)
- Integration-style full-flow tests through the router
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOLS, REMOTE_TOOLS
from onyx.agents.bud_agent.tool_executor import (
    ConnectorToolExecutor,
    LocalToolExecutor,
    RemoteToolExecutor,
    ToolExecutionContext,
    ToolExecutionResult,
)
from onyx.agents.bud_agent.tool_router import ToolRouter


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

TEST_SESSION_ID = "test-session-001"
TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
TEST_WORKSPACE = "/tmp/test-workspace"
TEST_TOOL_CALL_ID = "call-abc-123"
CONNECTOR_TOOL_NAMES: set[str] = {"slack_send", "jira_create", "gmail_read"}


def _make_context(
    emit: AsyncMock | None = None,
    step_number: int = 0,
) -> ToolExecutionContext:
    """Build a ToolExecutionContext with a mock emit function."""
    if emit is None:
        emit = AsyncMock()
    return ToolExecutionContext(
        session_id=TEST_SESSION_ID,
        user_id=TEST_USER_ID,
        workspace_path=TEST_WORKSPACE,
        step_number=step_number,
        emit=emit,
    )


def _make_router(
    connector_tool_names: set[str] | None = None,
) -> ToolRouter:
    """Build a ToolRouter with all three executor types."""
    if connector_tool_names is None:
        connector_tool_names = CONNECTOR_TOOL_NAMES
    return ToolRouter(
        executors=[
            LocalToolExecutor(),
            RemoteToolExecutor(),
            ConnectorToolExecutor(connector_tool_names),
        ]
    )


# ===========================================================================
# LocalToolExecutor Tests
# ===========================================================================


class TestLocalToolExecutorCanHandle:
    """Test LocalToolExecutor.can_handle() for various tool names."""

    def test_returns_true_for_bash(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("bash") is True

    def test_returns_true_for_read_file(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("read_file") is True

    def test_returns_true_for_write_file(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("write_file") is True

    def test_returns_true_for_edit_file(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("edit_file") is True

    def test_returns_true_for_glob(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("glob") is True

    def test_returns_true_for_grep(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("grep") is True

    def test_returns_true_for_browser_navigate(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("browser_navigate") is True

    def test_returns_true_for_all_local_tools(self) -> None:
        executor = LocalToolExecutor()
        for tool_name in LOCAL_TOOLS:
            assert executor.can_handle(tool_name) is True, (
                f"Expected can_handle('{tool_name}') to be True"
            )

    def test_returns_false_for_web_search(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("web_search") is False

    def test_returns_false_for_memory_store(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("memory_store") is False

    def test_returns_false_for_unknown_tool(self) -> None:
        executor = LocalToolExecutor()
        assert executor.can_handle("completely_unknown_tool") is False


class TestLocalToolExecutorExecute:
    """Test LocalToolExecutor.execute() emits tool:request and returns pending."""

    @pytest.mark.asyncio
    async def test_emits_tool_request(self) -> None:
        executor = LocalToolExecutor()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=3)
        tool_input: dict[str, Any] = {"command": "ls -la"}

        await executor.execute("bash", tool_input, TEST_TOOL_CALL_ID, context)

        emit.assert_called_once_with("tool:request", {
            "session_id": TEST_SESSION_ID,
            "ind": 3,
            "tool_name": "bash",
            "tool_input": tool_input,
            "tool_call_id": TEST_TOOL_CALL_ID,
        })

    @pytest.mark.asyncio
    async def test_returns_pending_true(self) -> None:
        executor = LocalToolExecutor()
        context = _make_context()

        result = await executor.execute(
            "bash", {"command": "echo hi"}, TEST_TOOL_CALL_ID, context
        )

        assert isinstance(result, ToolExecutionResult)
        assert result.pending is True

    @pytest.mark.asyncio
    async def test_pending_result_has_no_output(self) -> None:
        executor = LocalToolExecutor()
        context = _make_context()

        result = await executor.execute(
            "read_file", {"path": "test.py"}, TEST_TOOL_CALL_ID, context
        )

        assert result.output is None
        assert result.error is None

    @pytest.mark.asyncio
    async def test_step_number_passed_through(self) -> None:
        executor = LocalToolExecutor()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=7)

        await executor.execute(
            "glob", {"pattern": "*.py"}, TEST_TOOL_CALL_ID, context
        )

        call_args = emit.call_args
        assert call_args[0][1]["ind"] == 7


# ===========================================================================
# RemoteToolExecutor Tests
# ===========================================================================


class TestRemoteToolExecutorCanHandle:
    """Test RemoteToolExecutor.can_handle() for various tool names."""

    def test_returns_true_for_web_search(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("web_search") is True

    def test_returns_true_for_memory_store(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("memory_store") is True

    def test_returns_true_for_memory_search(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("memory_search") is True

    def test_returns_true_for_workspace_read(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("workspace_read") is True

    def test_returns_true_for_render_artifact(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("render_artifact") is True

    def test_returns_true_for_all_remote_tools(self) -> None:
        executor = RemoteToolExecutor()
        for tool_name in REMOTE_TOOLS:
            assert executor.can_handle(tool_name) is True, (
                f"Expected can_handle('{tool_name}') to be True"
            )

    def test_returns_false_for_bash(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("bash") is False

    def test_returns_false_for_read_file(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("read_file") is False

    def test_returns_false_for_unknown_tool(self) -> None:
        executor = RemoteToolExecutor()
        assert executor.can_handle("completely_unknown_tool") is False


class TestRemoteToolExecutorExecute:
    """Test RemoteToolExecutor.execute() returns placeholder result."""

    @pytest.mark.asyncio
    async def test_returns_not_implemented(self) -> None:
        executor = RemoteToolExecutor()
        context = _make_context()

        result = await executor.execute(
            "web_search",
            {"queries": ["test query"]},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert isinstance(result, ToolExecutionResult)
        assert result.output == "Not implemented"

    @pytest.mark.asyncio
    async def test_result_is_not_pending(self) -> None:
        executor = RemoteToolExecutor()
        context = _make_context()

        result = await executor.execute(
            "memory_store",
            {"content": "test memory"},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert result.pending is False

    @pytest.mark.asyncio
    async def test_result_has_no_error(self) -> None:
        executor = RemoteToolExecutor()
        context = _make_context()

        result = await executor.execute(
            "workspace_read",
            {"path": "SOUL.md"},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert result.error is None


# ===========================================================================
# ConnectorToolExecutor Tests
# ===========================================================================


class TestConnectorToolExecutorCanHandle:
    """Test ConnectorToolExecutor.can_handle() with dynamic tool names."""

    def test_returns_true_for_registered_connector_tool(self) -> None:
        executor = ConnectorToolExecutor({"slack_send", "jira_create"})
        assert executor.can_handle("slack_send") is True

    def test_returns_true_for_all_registered_tools(self) -> None:
        tools = {"slack_send", "jira_create", "gmail_read"}
        executor = ConnectorToolExecutor(tools)
        for tool_name in tools:
            assert executor.can_handle(tool_name) is True

    def test_returns_false_for_local_tools(self) -> None:
        executor = ConnectorToolExecutor({"slack_send"})
        for tool_name in LOCAL_TOOLS:
            assert executor.can_handle(tool_name) is False, (
                f"Expected can_handle('{tool_name}') to be False for connector executor"
            )

    def test_returns_false_for_remote_tools(self) -> None:
        executor = ConnectorToolExecutor({"slack_send"})
        for tool_name in REMOTE_TOOLS:
            assert executor.can_handle(tool_name) is False, (
                f"Expected can_handle('{tool_name}') to be False for connector executor"
            )

    def test_returns_false_for_unregistered_tool(self) -> None:
        executor = ConnectorToolExecutor({"slack_send"})
        assert executor.can_handle("notion_query") is False

    def test_empty_connector_set_handles_nothing(self) -> None:
        executor = ConnectorToolExecutor(set())
        assert executor.can_handle("anything") is False


class TestConnectorToolExecutorExecute:
    """Test ConnectorToolExecutor.execute() returns placeholder result."""

    @pytest.mark.asyncio
    async def test_returns_not_implemented(self) -> None:
        executor = ConnectorToolExecutor({"slack_send"})
        context = _make_context()

        result = await executor.execute(
            "slack_send",
            {"channel": "#general", "text": "hello"},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert isinstance(result, ToolExecutionResult)
        assert result.output == "Not implemented"

    @pytest.mark.asyncio
    async def test_result_is_not_pending(self) -> None:
        executor = ConnectorToolExecutor({"jira_create"})
        context = _make_context()

        result = await executor.execute(
            "jira_create",
            {"summary": "Bug fix"},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert result.pending is False

    @pytest.mark.asyncio
    async def test_result_has_no_error(self) -> None:
        executor = ConnectorToolExecutor({"gmail_read"})
        context = _make_context()

        result = await executor.execute(
            "gmail_read", {"query": "is:unread"}, TEST_TOOL_CALL_ID, context
        )

        assert result.error is None


# ===========================================================================
# ToolRouter.get_executor() Tests
# ===========================================================================


class TestToolRouterGetExecutor:
    """Test ToolRouter.get_executor() returns the correct executor type."""

    def test_returns_local_executor_for_bash(self) -> None:
        router = _make_router()
        executor = router.get_executor("bash")
        assert isinstance(executor, LocalToolExecutor)

    def test_returns_local_executor_for_read_file(self) -> None:
        router = _make_router()
        executor = router.get_executor("read_file")
        assert isinstance(executor, LocalToolExecutor)

    def test_returns_local_executor_for_all_local_tools(self) -> None:
        router = _make_router()
        for tool_name in LOCAL_TOOLS:
            executor = router.get_executor(tool_name)
            assert isinstance(executor, LocalToolExecutor), (
                f"Expected LocalToolExecutor for '{tool_name}', got {type(executor).__name__}"
            )

    def test_returns_remote_executor_for_web_search(self) -> None:
        router = _make_router()
        executor = router.get_executor("web_search")
        assert isinstance(executor, RemoteToolExecutor)

    def test_returns_remote_executor_for_memory_store(self) -> None:
        router = _make_router()
        executor = router.get_executor("memory_store")
        assert isinstance(executor, RemoteToolExecutor)

    def test_returns_remote_executor_for_all_remote_tools(self) -> None:
        router = _make_router()
        for tool_name in REMOTE_TOOLS:
            executor = router.get_executor(tool_name)
            assert isinstance(executor, RemoteToolExecutor), (
                f"Expected RemoteToolExecutor for '{tool_name}', got {type(executor).__name__}"
            )

    def test_returns_connector_executor_for_registered_connector(self) -> None:
        router = _make_router()
        executor = router.get_executor("slack_send")
        assert isinstance(executor, ConnectorToolExecutor)

    def test_returns_connector_executor_for_all_connector_tools(self) -> None:
        router = _make_router()
        for tool_name in CONNECTOR_TOOL_NAMES:
            executor = router.get_executor(tool_name)
            assert isinstance(executor, ConnectorToolExecutor), (
                f"Expected ConnectorToolExecutor for '{tool_name}', got {type(executor).__name__}"
            )

    def test_raises_value_error_for_unknown_tool(self) -> None:
        router = _make_router()
        with pytest.raises(ValueError, match="No executor registered for tool"):
            router.get_executor("completely_unknown_tool")

    def test_raises_value_error_with_tool_name_in_message(self) -> None:
        router = _make_router()
        with pytest.raises(ValueError, match="nonexistent_widget"):
            router.get_executor("nonexistent_widget")


# ===========================================================================
# ToolRouter.execute() Tests
# ===========================================================================


class TestToolRouterExecuteLifecycle:
    """Test ToolRouter.execute() lifecycle events."""

    @pytest.mark.asyncio
    async def test_emits_tool_start_before_dispatching(self) -> None:
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=2)

        await router.execute(
            "web_search",
            {"queries": ["test"]},
            TEST_TOOL_CALL_ID,
            context,
        )

        # First call should be tool:start
        first_call = emit.call_args_list[0]
        assert first_call[0][0] == "tool:start"
        assert first_call[0][1] == {
            "session_id": TEST_SESSION_ID,
            "ind": 2,
            "tool_name": "web_search",
            "tool_call_id": TEST_TOOL_CALL_ID,
        }

    @pytest.mark.asyncio
    async def test_emits_tool_delta_after_successful_remote_execution(self) -> None:
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=1)

        await router.execute(
            "memory_store",
            {"content": "remember this"},
            TEST_TOOL_CALL_ID,
            context,
        )

        # Should have two emit calls: tool:start and tool:delta
        assert emit.call_count == 2
        second_call = emit.call_args_list[1]
        assert second_call[0][0] == "tool:delta"
        payload = second_call[0][1]
        assert payload["session_id"] == TEST_SESSION_ID
        assert payload["ind"] == 1
        assert payload["tool_name"] == "memory_store"
        assert payload["tool_call_id"] == TEST_TOOL_CALL_ID
        assert payload["response_type"] == "success"
        assert payload["data"] == "Not implemented"

    @pytest.mark.asyncio
    async def test_does_not_emit_tool_delta_for_pending_local_tool(self) -> None:
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=0)

        result = await router.execute(
            "bash",
            {"command": "echo hello"},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert result.pending is True
        # Should have tool:start + tool:request only (no tool:delta)
        event_names = [call[0][0] for call in emit.call_args_list]
        assert "tool:start" in event_names
        assert "tool:delta" not in event_names

    @pytest.mark.asyncio
    async def test_local_tool_emits_start_then_request(self) -> None:
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=5)

        await router.execute(
            "read_file",
            {"path": "main.py"},
            TEST_TOOL_CALL_ID,
            context,
        )

        # First: tool:start (from router), second: tool:request (from executor)
        assert emit.call_count == 2
        assert emit.call_args_list[0][0][0] == "tool:start"
        assert emit.call_args_list[1][0][0] == "tool:request"

    @pytest.mark.asyncio
    async def test_tool_delta_contains_error_type_on_error(self) -> None:
        """When result has an error, tool:delta should have response_type='error'."""
        # Use a custom executor that returns an error result
        from onyx.agents.bud_agent.tool_executor import ToolExecutor

        class ErrorExecutor(ToolExecutor):
            def can_handle(self, tool_name: str) -> bool:
                return tool_name == "error_tool"

            async def execute(
                self,
                tool_name: str,
                tool_input: dict[str, Any],
                tool_call_id: str,
                context: ToolExecutionContext,
            ) -> ToolExecutionResult:
                return ToolExecutionResult(error="Something went wrong")

        router = ToolRouter(executors=[ErrorExecutor()])
        emit = AsyncMock()
        context = _make_context(emit=emit)

        await router.execute("error_tool", {}, TEST_TOOL_CALL_ID, context)

        delta_call = emit.call_args_list[1]
        assert delta_call[0][0] == "tool:delta"
        payload = delta_call[0][1]
        assert payload["response_type"] == "error"
        assert payload["data"] == "Something went wrong"


class TestToolRouterExecuteMetadata:
    """Test ToolRouter.execute() passes metadata through to tool:delta."""

    @pytest.mark.asyncio
    async def test_passes_openui_response_metadata(self) -> None:
        """When result metadata includes openui_response, it appears in tool:delta."""
        from onyx.agents.bud_agent.tool_executor import ToolExecutor

        class ArtifactExecutor(ToolExecutor):
            def can_handle(self, tool_name: str) -> bool:
                return tool_name == "artifact_tool"

            async def execute(
                self,
                tool_name: str,
                tool_input: dict[str, Any],
                tool_call_id: str,
                context: ToolExecutionContext,
            ) -> ToolExecutionResult:
                return ToolExecutionResult(
                    output="Artifact rendered",
                    metadata={"openui_response": "<BarChart><Series data={[]} /></BarChart>"},
                )

        router = ToolRouter(executors=[ArtifactExecutor()])
        emit = AsyncMock()
        context = _make_context(emit=emit)

        await router.execute("artifact_tool", {}, TEST_TOOL_CALL_ID, context)

        delta_call = emit.call_args_list[1]
        payload = delta_call[0][1]
        assert payload["openui_response"] == "<BarChart><Series data={[]} /></BarChart>"

    @pytest.mark.asyncio
    async def test_passes_file_ids_metadata(self) -> None:
        """When result metadata includes file_ids, they appear in tool:delta."""
        from onyx.agents.bud_agent.tool_executor import ToolExecutor

        class FileExecutor(ToolExecutor):
            def can_handle(self, tool_name: str) -> bool:
                return tool_name == "file_tool"

            async def execute(
                self,
                tool_name: str,
                tool_input: dict[str, Any],
                tool_call_id: str,
                context: ToolExecutionContext,
            ) -> ToolExecutionResult:
                return ToolExecutionResult(
                    output="Files created",
                    metadata={"file_ids": ["file-1", "file-2"]},
                )

        router = ToolRouter(executors=[FileExecutor()])
        emit = AsyncMock()
        context = _make_context(emit=emit)

        await router.execute("file_tool", {}, TEST_TOOL_CALL_ID, context)

        delta_call = emit.call_args_list[1]
        payload = delta_call[0][1]
        assert payload["file_ids"] == ["file-1", "file-2"]

    @pytest.mark.asyncio
    async def test_omits_openui_response_when_not_present(self) -> None:
        """tool:delta payload should NOT include openui_response when metadata lacks it."""
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit)

        await router.execute(
            "web_search", {"queries": ["test"]}, TEST_TOOL_CALL_ID, context
        )

        delta_call = emit.call_args_list[1]
        payload = delta_call[0][1]
        assert "openui_response" not in payload

    @pytest.mark.asyncio
    async def test_omits_file_ids_when_not_present(self) -> None:
        """tool:delta payload should NOT include file_ids when metadata lacks it."""
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit)

        await router.execute(
            "memory_store", {"content": "test"}, TEST_TOOL_CALL_ID, context
        )

        delta_call = emit.call_args_list[1]
        payload = delta_call[0][1]
        assert "file_ids" not in payload


# ===========================================================================
# Integration-Style Full Flow Tests
# ===========================================================================


class TestToolRouterFullFlow:
    """Integration-style tests: router with all 3 executors, various dispatches."""

    @pytest.mark.asyncio
    async def test_dispatch_bash_local_returns_pending(self) -> None:
        """Local tool (bash) dispatched through router returns pending=True."""
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=0)

        result = await router.execute(
            "bash", {"command": "ls"}, TEST_TOOL_CALL_ID, context
        )

        assert result.pending is True
        assert result.output is None
        # Verify event sequence: tool:start, tool:request (no tool:delta)
        event_names = [call[0][0] for call in emit.call_args_list]
        assert event_names == ["tool:start", "tool:request"]

    @pytest.mark.asyncio
    async def test_dispatch_web_search_remote_returns_success(self) -> None:
        """Remote tool (web_search) dispatched through router returns non-pending result."""
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=1)

        result = await router.execute(
            "web_search",
            {"queries": ["python async"]},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert result.pending is False
        assert result.output == "Not implemented"
        # Verify event sequence: tool:start, tool:delta
        event_names = [call[0][0] for call in emit.call_args_list]
        assert event_names == ["tool:start", "tool:delta"]

    @pytest.mark.asyncio
    async def test_dispatch_connector_tool_returns_success(self) -> None:
        """Connector tool (slack_send) dispatched through router returns non-pending result."""
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=2)

        result = await router.execute(
            "slack_send",
            {"channel": "#general", "text": "hello"},
            TEST_TOOL_CALL_ID,
            context,
        )

        assert result.pending is False
        assert result.output == "Not implemented"
        event_names = [call[0][0] for call in emit.call_args_list]
        assert event_names == ["tool:start", "tool:delta"]

    @pytest.mark.asyncio
    async def test_dispatch_unknown_tool_raises_value_error(self) -> None:
        """Unknown tool dispatched through router raises ValueError."""
        router = _make_router()
        context = _make_context()

        with pytest.raises(ValueError, match="No executor registered for tool"):
            await router.execute(
                "unknown_tool", {}, TEST_TOOL_CALL_ID, context
            )

    @pytest.mark.asyncio
    async def test_multiple_dispatches_independent(self) -> None:
        """Multiple sequential dispatches through the same router work independently."""
        router = _make_router()
        emit = AsyncMock()
        context = _make_context(emit=emit, step_number=0)

        # First: local tool
        result1 = await router.execute(
            "bash", {"command": "ls"}, "call-1", context
        )
        assert result1.pending is True

        # Second: remote tool
        result2 = await router.execute(
            "web_search", {"queries": ["test"]}, "call-2", context
        )
        assert result2.pending is False

        # Third: connector tool
        result3 = await router.execute(
            "slack_send", {"text": "hi"}, "call-3", context
        )
        assert result3.pending is False

        # All emits recorded: 2 for local (start + request), 2 for remote (start + delta), 2 for connector
        assert emit.call_count == 6

    @pytest.mark.asyncio
    async def test_router_with_no_connectors(self) -> None:
        """Router with empty connector set still routes local and remote tools."""
        router = _make_router(connector_tool_names=set())
        emit = AsyncMock()
        context = _make_context(emit=emit)

        result_local = await router.execute(
            "bash", {"command": "pwd"}, "call-1", context
        )
        assert result_local.pending is True

        result_remote = await router.execute(
            "web_search", {"queries": ["q"]}, "call-2", context
        )
        assert result_remote.pending is False

        # Without connector tools registered, slack_send should fail
        with pytest.raises(ValueError):
            await router.execute("slack_send", {}, "call-3", context)


# ===========================================================================
# ToolExecutionResult Tests
# ===========================================================================


class TestToolExecutionResult:
    """Test ToolExecutionResult dataclass defaults and construction."""

    def test_default_values(self) -> None:
        result = ToolExecutionResult()
        assert result.output is None
        assert result.error is None
        assert result.pending is False
        assert result.metadata == {}

    def test_pending_result(self) -> None:
        result = ToolExecutionResult(pending=True)
        assert result.pending is True
        assert result.output is None

    def test_success_result_with_metadata(self) -> None:
        result = ToolExecutionResult(
            output="done",
            metadata={"file_ids": ["f1"], "openui_response": "<Chart />"},
        )
        assert result.output == "done"
        assert result.metadata["file_ids"] == ["f1"]
        assert result.metadata["openui_response"] == "<Chart />"

    def test_error_result(self) -> None:
        result = ToolExecutionResult(error="timeout")
        assert result.error == "timeout"
        assert result.output is None
        assert result.pending is False


# ===========================================================================
# ToolExecutionContext Tests
# ===========================================================================


class TestToolExecutionContext:
    """Test ToolExecutionContext dataclass construction and fields."""

    def test_required_fields(self) -> None:
        emit = AsyncMock()
        ctx = ToolExecutionContext(
            session_id="s1",
            user_id=TEST_USER_ID,
            workspace_path="/ws",
            step_number=0,
            emit=emit,
        )
        assert ctx.session_id == "s1"
        assert ctx.user_id == TEST_USER_ID
        assert ctx.workspace_path == "/ws"
        assert ctx.step_number == 0
        assert ctx.emit is emit

    def test_optional_tenant_id_defaults_to_none(self) -> None:
        ctx = _make_context()
        assert ctx.tenant_id is None

    def test_tenant_id_can_be_set(self) -> None:
        emit = AsyncMock()
        ctx = ToolExecutionContext(
            session_id="s1",
            user_id=TEST_USER_ID,
            workspace_path="/ws",
            step_number=0,
            emit=emit,
            tenant_id="tenant-123",
        )
        assert ctx.tenant_id == "tenant-123"
