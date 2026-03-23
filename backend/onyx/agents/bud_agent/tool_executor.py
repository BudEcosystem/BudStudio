"""Tool executor abstraction for the Socket.IO agent architecture.

Provides a clean interface for routing tool execution across different
backends (local desktop, in-process remote, MCP connector gateway).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable
from uuid import UUID

from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOLS, REMOTE_TOOLS


@dataclass
class ToolExecutionContext:
    """Context passed to tool executors during execution."""

    session_id: str
    user_id: UUID
    workspace_path: str
    step_number: int
    emit: Callable[[str, dict[str, Any]], Awaitable[None]]
    tenant_id: str | None = None


@dataclass
class ToolExecutionResult:
    """Result of a tool execution."""

    output: str | None = None
    error: str | None = None
    pending: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


class ToolExecutor(ABC):
    """Abstract base class for tool execution strategies."""

    @abstractmethod
    def can_handle(self, tool_name: str) -> bool:
        ...

    @abstractmethod
    async def execute(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult:
        ...


class LocalToolExecutor(ToolExecutor):
    """Local tools break the agent loop.

    Sends tool:request to the client and returns pending=True.
    The client executes the tool and sends tool:result back,
    which triggers a new LLM turn.
    """

    def can_handle(self, tool_name: str) -> bool:
        return tool_name in LOCAL_TOOLS

    async def execute(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult:
        await context.emit("tool:request", {
            "session_id": context.session_id,
            "ind": context.step_number,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "tool_call_id": tool_call_id,
        })
        return ToolExecutionResult(pending=True)


class RemoteToolExecutor(ToolExecutor):
    """Executes tools in-process on the backend."""

    def can_handle(self, tool_name: str) -> bool:
        return tool_name in REMOTE_TOOLS

    async def execute(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult:
        # Placeholder — real handlers will be wired during orchestrator unification
        return ToolExecutionResult(output="Not implemented")


class ConnectorToolExecutor(ToolExecutor):
    """Executes tools via MCP gateway."""

    def __init__(self, connector_tool_names: set[str]) -> None:
        self._connector_tool_names = connector_tool_names

    def can_handle(self, tool_name: str) -> bool:
        return tool_name in self._connector_tool_names

    async def execute(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult:
        # Placeholder — MCP gateway call will be wired during orchestrator unification
        return ToolExecutionResult(output="Not implemented")
