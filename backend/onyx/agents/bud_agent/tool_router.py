"""Tool router for dispatching tool calls to the appropriate executor.

Handles the common tool lifecycle: emit tool:start → dispatch to executor →
emit tool:delta with result (skipped for pending/local tools).
"""

from __future__ import annotations

from typing import Any

from onyx.agents.bud_agent.tool_executor import (
    ToolExecutionContext,
    ToolExecutionResult,
    ToolExecutor,
)


class ToolRouter:
    """Routes tool calls to the appropriate executor and handles lifecycle."""

    def __init__(self, executors: list[ToolExecutor]) -> None:
        self._executors = executors

    def get_executor(self, tool_name: str) -> ToolExecutor:
        """Find the executor that handles the given tool name."""
        for executor in self._executors:
            if executor.can_handle(tool_name):
                return executor
        raise ValueError(f"No executor registered for tool: {tool_name}")

    async def execute(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
        context: ToolExecutionContext,
    ) -> ToolExecutionResult:
        """Execute a tool with lifecycle management."""
        executor = self.get_executor(tool_name)

        # Pre-execution: emit tool:start
        await context.emit("tool:start", {
            "session_id": context.session_id,
            "ind": context.step_number,
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
        })

        # Execute via the matched executor
        result = await executor.execute(
            tool_name, tool_input, tool_call_id, context
        )

        # Post-execution: emit tool:delta (skip for pending local tools)
        if not result.pending:
            delta_payload: dict[str, Any] = {
                "session_id": context.session_id,
                "ind": context.step_number,
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
                "response_type": "error" if result.error else "success",
                "data": result.error if result.error else result.output,
            }
            if result.metadata.get("openui_response"):
                delta_payload["openui_response"] = result.metadata["openui_response"]
            if result.metadata.get("file_ids"):
                delta_payload["file_ids"] = result.metadata["file_ids"]

            await context.emit("tool:delta", delta_payload)

        return result
