"""Unit tests for context builder v2 changes.

Tests:
- search_query rename (A.1)
- AgentExecutionMode.EXTERNAL (B.1)
- MODE_TOOL_BLOCKLIST (B.2)
- tool_filter_fn hook (B.3)
- Mode prompt expansion (A.3)

Uses module-level mocking to avoid heavy transitive imports.
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest


# ---------------------------------------------------------------------------
# Pre-install mock modules to break the import chain.
# agent_context.py imports artifact_tool -> db.agent -> db.models which
# needs real SQLAlchemy.  We mock the heavy leaf modules so the import
# chain resolves without a database or installed packages.
# ---------------------------------------------------------------------------

_MOCK_MODULES: list[str] = []


def _ensure_mock(name: str) -> None:
    """Install a MagicMock for *name* if it's not already in sys.modules."""
    if name not in sys.modules:
        sys.modules[name] = MagicMock()
        _MOCK_MODULES.append(name)


# Core dependencies that agent_context transitively imports
_deps = [
    # SQLAlchemy chain
    "sqlalchemy",
    "sqlalchemy.orm",
    "sqlalchemy.dialects",
    "sqlalchemy.dialects.postgresql",
    "sqlalchemy.ext",
    "sqlalchemy.ext.mutable",
    "sqlalchemy.sql",
    "sqlalchemy.sql.expression",
    "sqlalchemy.types",
    "sqlalchemy.schema",
    "sqlalchemy.engine",
    # Redis
    "redis",
    # OpenAI / Agents SDK
    "openai",
    "agents",
    "agents.models",
    "agents.models.openai_chatcompletions",
    # Pydantic (may already be installed; mock only if missing)
    # DB models and heavy internal modules
    "onyx.db.models",
    "onyx.db.agent",
    "onyx.db.agent_inbox",
    "onyx.db.agent_connector",
    "onyx.db.enums",
    "onyx.db.engine",
    "onyx.db.engine.sql_engine",
    "onyx.db.users",
    "onyx.redis",
    "onyx.redis.redis_pool",
    "onyx.llm",
    "onyx.llm.factory",
    "onyx.server.query_and_chat",
    "onyx.server.query_and_chat.streaming_models",
    # Agent sub-modules with heavy deps
    "onyx.agents.bud_agent.artifact_tool",
    "onyx.agents.bud_agent.ask_user_tool",
    "onyx.agents.bud_agent.connector_service",
    "onyx.agents.bud_agent.cron_service",
    "onyx.agents.bud_agent.inbox_service",
    "onyx.agents.bud_agent.mcp_service",
    "onyx.agents.bud_agent.memory_service",
    "onyx.agents.bud_agent.skill_service",
    "onyx.agents.bud_agent.web_search_service",
    "onyx.agents.bud_agent.workspace_service",
    "onyx.agents.bud_agent.tool_definitions",
    "onyx.agents.bud_agent.turn_driver",
    "onyx.agents.bud_agent.llm_turn",
    "onyx.agents.bud_agent.streaming_models",
    "onyx.agents.bud_agent.skills",
    "onyx.workflow",
    "onyx.workflow.skill_discovery",
    "onyx.server.agent",
    "onyx.server.agent.socketio_emitter",
]

for dep in _deps:
    _ensure_mock(dep)


# Now we can safely import agent_context — all heavy deps are mocked.
# We need to force a fresh import since it may have failed previously.
if "onyx.agents.bud_agent.agent_context" in sys.modules:
    del sys.modules["onyx.agents.bud_agent.agent_context"]

from onyx.agents.bud_agent.agent_context import (  # noqa: E402
    AgentExecutionMode,
    MODE_TOOL_BLOCKLIST,
    build_agent_run_context,
)


# ---------------------------------------------------------------------------
# Test: AgentExecutionMode enum
# ---------------------------------------------------------------------------


class TestAgentExecutionMode:
    """Test the AgentExecutionMode enum values."""

    def test_interactive_value(self) -> None:
        assert AgentExecutionMode.INTERACTIVE == "interactive"
        assert AgentExecutionMode.INTERACTIVE.value == "interactive"

    def test_cron_value(self) -> None:
        assert AgentExecutionMode.CRON == "cron"

    def test_inbox_value(self) -> None:
        assert AgentExecutionMode.INBOX == "inbox"

    def test_external_value(self) -> None:
        assert AgentExecutionMode.EXTERNAL == "external"
        assert AgentExecutionMode.EXTERNAL.value == "external"

    def test_all_modes_present(self) -> None:
        names = {m.name for m in AgentExecutionMode}
        assert names == {"INTERACTIVE", "CRON", "INBOX", "EXTERNAL"}


# ---------------------------------------------------------------------------
# Test: MODE_TOOL_BLOCKLIST
# ---------------------------------------------------------------------------


class TestModeToolBlocklist:
    """Test the static tool blocklist per execution mode."""

    def test_interactive_no_tools_blocked(self) -> None:
        blocked = MODE_TOOL_BLOCKLIST[AgentExecutionMode.INTERACTIVE]
        assert blocked == set()

    def test_cron_blocks_ask_user_and_render_canvas(self) -> None:
        blocked = MODE_TOOL_BLOCKLIST[AgentExecutionMode.CRON]
        assert "ask_user_questions" in blocked
        assert "render_canvas" in blocked
        assert "send_message" not in blocked

    def test_inbox_blocks_ask_user_render_canvas_manage_cron(self) -> None:
        blocked = MODE_TOOL_BLOCKLIST[AgentExecutionMode.INBOX]
        assert "ask_user_questions" in blocked
        assert "render_canvas" in blocked
        assert "manage_cron" in blocked
        assert "send_message" not in blocked

    def test_external_blocks_same_as_inbox(self) -> None:
        blocked = MODE_TOOL_BLOCKLIST[AgentExecutionMode.EXTERNAL]
        assert "ask_user_questions" in blocked
        assert "render_canvas" in blocked
        assert "manage_cron" in blocked
        assert "send_message" not in blocked

    def test_send_message_not_blocked_in_any_mode(self) -> None:
        for mode in AgentExecutionMode:
            blocked = MODE_TOOL_BLOCKLIST[mode]
            assert "send_message" not in blocked, (
                f"send_message should not be blocked in {mode.value} mode"
            )

    def test_blocklist_covers_all_modes(self) -> None:
        for mode in AgentExecutionMode:
            assert mode in MODE_TOOL_BLOCKLIST, (
                f"MODE_TOOL_BLOCKLIST missing entry for {mode.value}"
            )


# ---------------------------------------------------------------------------
# Test: Blocklist application logic
# ---------------------------------------------------------------------------


class _FakeTool:
    """Minimal stand-in for agents.FunctionTool in tests."""

    def __init__(self, name: str) -> None:
        self.name = name


class TestBlocklistApplication:
    """Test that blocklist filtering logic works correctly."""

    def _apply_blocklist(
        self, mode: AgentExecutionMode, tool_names: list[str]
    ) -> list[str]:
        """Simulate the blocklist filtering from build_agent_run_context."""
        tools = [_FakeTool(n) for n in tool_names]
        blocked = MODE_TOOL_BLOCKLIST.get(mode, set())
        if blocked:
            tools = [t for t in tools if t.name not in blocked]
        return [t.name for t in tools]

    def test_interactive_keeps_all(self) -> None:
        names = ["memory_search", "ask_user_questions", "render_canvas", "manage_cron"]
        result = self._apply_blocklist(AgentExecutionMode.INTERACTIVE, names)
        assert result == names

    def test_cron_removes_blocked(self) -> None:
        names = ["memory_search", "ask_user_questions", "render_canvas", "send_message"]
        result = self._apply_blocklist(AgentExecutionMode.CRON, names)
        assert "ask_user_questions" not in result
        assert "render_canvas" not in result
        assert "memory_search" in result
        assert "send_message" in result

    def test_inbox_removes_blocked(self) -> None:
        names = ["memory_search", "ask_user_questions", "render_canvas", "manage_cron", "send_message"]
        result = self._apply_blocklist(AgentExecutionMode.INBOX, names)
        assert "ask_user_questions" not in result
        assert "render_canvas" not in result
        assert "manage_cron" not in result
        assert "memory_search" in result
        assert "send_message" in result

    def test_external_removes_blocked(self) -> None:
        names = ["memory_search", "ask_user_questions", "render_canvas", "manage_cron", "send_message"]
        result = self._apply_blocklist(AgentExecutionMode.EXTERNAL, names)
        assert "ask_user_questions" not in result
        assert "render_canvas" not in result
        assert "manage_cron" not in result
        assert "memory_search" in result
        assert "send_message" in result

    def test_extra_tools_survive_blocklist(self) -> None:
        """Source-specific extra_tools are not in the blocklist."""
        names = [
            "memory_search", "ask_user_questions", "render_canvas",
            "slack_reply", "github_comment",
        ]
        result = self._apply_blocklist(AgentExecutionMode.EXTERNAL, names)
        assert "slack_reply" in result
        assert "github_comment" in result


# ---------------------------------------------------------------------------
# Test: tool_filter_fn hook
# ---------------------------------------------------------------------------


class TestToolFilterFn:
    """Test the optional tool_filter_fn hook."""

    def test_filter_fn_applied_when_provided(self) -> None:
        tools = [_FakeTool("memory_search"), _FakeTool("web_search"), _FakeTool("send_message")]

        def my_filter(query: str, tool_list: list[Any]) -> list[Any]:
            return [t for t in tool_list if t.name.startswith("memory")]

        # Simulate the pipeline
        blocked = MODE_TOOL_BLOCKLIST.get(AgentExecutionMode.INTERACTIVE, set())
        if blocked:
            tools = [t for t in tools if t.name not in blocked]

        search_query = "test query"
        if my_filter and search_query:
            tools = my_filter(search_query, tools)

        assert len(tools) == 1
        assert tools[0].name == "memory_search"

    def test_filter_fn_none_has_no_effect(self) -> None:
        tools = [_FakeTool("memory_search"), _FakeTool("web_search")]
        tool_filter_fn = None
        search_query = "test query"
        if tool_filter_fn and search_query:
            tools = tool_filter_fn(search_query, tools)
        assert len(tools) == 2

    def test_filter_fn_skipped_when_search_query_empty(self) -> None:
        call_count = 0

        def my_filter(query: str, tool_list: list[Any]) -> list[Any]:
            nonlocal call_count
            call_count += 1
            return []

        tools = [_FakeTool("memory_search")]
        search_query = ""
        if my_filter and search_query:
            tools = my_filter(search_query, tools)

        assert call_count == 0
        assert len(tools) == 1


# ---------------------------------------------------------------------------
# Test: search_query parameter signature
# ---------------------------------------------------------------------------


class TestSearchQuerySignature:
    """Verify build_agent_run_context uses search_query parameter."""

    def test_has_search_query_param(self) -> None:
        import inspect
        sig = inspect.signature(build_agent_run_context)
        assert "search_query" in sig.parameters
        assert "user_message" not in sig.parameters

    def test_search_query_is_str(self) -> None:
        import inspect
        sig = inspect.signature(build_agent_run_context)
        param = sig.parameters["search_query"]
        assert param.annotation is str

    def test_has_tool_filter_fn_param(self) -> None:
        import inspect
        sig = inspect.signature(build_agent_run_context)
        assert "tool_filter_fn" in sig.parameters
        param = sig.parameters["tool_filter_fn"]
        assert param.default is None


# ---------------------------------------------------------------------------
# Test: Mode prompt templates
# ---------------------------------------------------------------------------


class TestModePrompts:
    """Test that mode prompts load correctly and contain expected content."""

    def test_mode_interactive_prompt_expanded(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt
        content = load_prompt("mode_interactive")
        assert "interactive conversation" in content.lower()
        assert "ask_user_questions" in content
        assert "render_canvas" in content
        assert "memory_store" in content
        assert "memory_search" in content

    def test_mode_cron_prompt_expanded(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt
        content = load_prompt("mode_cron")
        assert "scheduled background" in content.lower()
        assert "NO_ACTION_NEEDED" in content
        assert "memory_search" in content
        assert "send_message" in content

    def test_mode_inbox_prompt_expanded(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt
        content = load_prompt("mode_inbox")
        assert "send_message" in content
        assert "escalate_to_user" in content
        assert "Decision Framework" in content

    def test_mode_external_prompt_exists(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt
        content = load_prompt("mode_external")
        assert "external event" in content.lower()
        assert "NO_ACTION_NEEDED" in content
        assert "send_message" in content
        assert "memory_search" in content
        assert "memory_store" in content
