"""Unit tests for SubSessionEmitter and AutoApproveRequester.

These are no-op/auto-approve implementations used by headless sub-sessions.
All methods are async, so we use pytest-asyncio.
"""

from __future__ import annotations

from typing import Any

import pytest

from onyx.agents.bud_agent.sub_session_emitter import (
    AutoApproveRequester,
    SubSessionEmitter,
)


# ---------------------------------------------------------------------------
# SubSessionEmitter tests
# ---------------------------------------------------------------------------


class TestSubSessionEmitter:
    """Every method on SubSessionEmitter is callable and returns None."""

    @pytest.fixture()
    def emitter(self) -> SubSessionEmitter:
        return SubSessionEmitter()

    @pytest.mark.asyncio
    async def test_emitter_all_methods_callable(
        self, emitter: SubSessionEmitter
    ) -> None:
        """Call every method on the emitter; verify no exceptions are raised."""
        await emitter.reasoning_start(step=0)
        await emitter.reasoning_delta(delta="thinking...", step=0)
        await emitter.text_start(step=1)
        await emitter.text_delta(delta="hello", step=1)
        await emitter.section_end(step=1)
        await emitter.tool_start(tool_name="grep", step=2)
        await emitter.tool_result_event(
            tool_name="grep",
            tool_call_id="tc_001",
            result={"output": "found"},
            step=2,
        )

    @pytest.mark.asyncio
    async def test_emitter_returns_none(
        self, emitter: SubSessionEmitter
    ) -> None:
        """All emitter methods explicitly return None."""
        assert await emitter.reasoning_start(step=0) is None
        assert await emitter.reasoning_delta(delta="x", step=0) is None
        assert await emitter.text_start(step=0) is None
        assert await emitter.text_delta(delta="y", step=0) is None
        assert await emitter.section_end(step=0) is None
        assert await emitter.tool_start(tool_name="ls", step=0) is None
        assert (
            await emitter.tool_result_event(
                tool_name="ls",
                tool_call_id="tc_002",
                result=None,
                step=0,
            )
            is None
        )


# ---------------------------------------------------------------------------
# AutoApproveRequester tests
# ---------------------------------------------------------------------------


class TestAutoApproveRequester:
    """AutoApproveRequester.request() returns immediately without blocking."""

    @pytest.fixture()
    def requester(self) -> AutoApproveRequester:
        return AutoApproveRequester()

    @pytest.mark.asyncio
    async def test_requester_auto_approves(
        self, requester: AutoApproveRequester
    ) -> None:
        """request() should return None immediately (auto-approve)."""
        tool: dict[str, Any] = {
            "name": "bash",
            "input": {"command": "echo hi"},
            "call_id": "tc_100",
        }
        result = await requester.request(tool)
        assert result is None

    @pytest.mark.asyncio
    async def test_requester_approves_multiple_tools(
        self, requester: AutoApproveRequester
    ) -> None:
        """Calling request() multiple times always succeeds."""
        tools: list[dict[str, Any]] = [
            {"name": "grep", "input": {"pattern": "TODO"}, "call_id": "tc_1"},
            {"name": "read", "input": {"path": "/tmp/f"}, "call_id": "tc_2"},
            {"name": "write", "input": {"path": "/tmp/f", "content": "x"}, "call_id": "tc_3"},
        ]
        for tool in tools:
            result = await requester.request(tool)
            assert result is None
