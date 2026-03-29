"""Socket.IO protocol implementations for TurnEmitter and ToolRequester.

Provides ``SocketIOEmitter`` (streaming events) and ``SocketIOToolRequester``
(tool request / approval routing) that the ``TurnDriver`` uses to push
real-time updates to connected Socket.IO clients.
"""

from __future__ import annotations

from typing import Any
from typing import TYPE_CHECKING

from onyx.agents.bud_agent.tool_definitions import requires_approval
from onyx.utils.logger import setup_logger

if TYPE_CHECKING:
    from onyx.agents.bud_agent.citation_processor import CitationProcessor
    from onyx.agents.bud_agent.web_search_service import BudAgentSearchContext

logger = setup_logger()


class SocketIOEmitter:
    """Emits streaming events via Socket.IO, implementing TurnEmitter protocol."""

    def __init__(
        self,
        sio: Any,
        session_id: str,
        search_context: Any | None = None,
    ) -> None:
        self._sio = sio
        self._session_id = session_id
        self._citation_processor: CitationProcessor | None = None

        if search_context is not None:
            from onyx.agents.bud_agent.citation_processor import CitationProcessor

            cp = CitationProcessor(search_context)
            if cp.active:
                self._citation_processor = cp

    # ------------------------------------------------------------------
    # Reasoning events
    # ------------------------------------------------------------------

    async def reasoning_start(self, step: int) -> None:
        await self._sio.emit(
            "agent:reasoning_start",
            {"session_id": self._session_id, "ind": step},
        )

    async def reasoning_delta(self, delta: str, step: int) -> None:
        await self._sio.emit(
            "agent:reasoning_delta",
            {
                "session_id": self._session_id,
                "ind": step,
                "reasoning": delta,
            },
        )

    # ------------------------------------------------------------------
    # Text / message events
    # ------------------------------------------------------------------

    async def text_start(self, step: int) -> None:
        await self._sio.emit(
            "agent:message_start",
            {
                "session_id": self._session_id,
                "ind": step,
                "content": "",
                "final_documents": None,
            },
        )

    async def text_delta(self, delta: str, step: int) -> None:
        if self._citation_processor is not None:
            processed, new_citations = self._citation_processor.process_token(
                delta
            )
            if processed:
                await self._sio.emit(
                    "agent:message_delta",
                    {
                        "session_id": self._session_id,
                        "ind": step,
                        "content": processed,
                    },
                )
            if new_citations:
                await self._sio.emit(
                    "agent:citation",
                    {
                        "session_id": self._session_id,
                        "ind": step,
                        "citations": [
                            {
                                "citation_num": c.citation_num,
                                "document_id": c.document_id,
                            }
                            for c in new_citations
                        ],
                    },
                )
        else:
            await self._sio.emit(
                "agent:message_delta",
                {
                    "session_id": self._session_id,
                    "ind": step,
                    "content": delta,
                },
            )

    # ------------------------------------------------------------------
    # Section boundary
    # ------------------------------------------------------------------

    async def section_end(self, step: int) -> None:
        if self._citation_processor is not None:
            flushed, _ = self._citation_processor.flush()
            if flushed:
                await self._sio.emit(
                    "agent:message_delta",
                    {
                        "session_id": self._session_id,
                        "ind": step,
                        "content": flushed,
                    },
                )
        await self._sio.emit(
            "agent:section_end",
            {"session_id": self._session_id, "ind": step},
        )

    # ------------------------------------------------------------------
    # Tool events
    # ------------------------------------------------------------------

    async def tool_start(self, tool_name: str, step: int) -> None:
        await self._sio.emit(
            "tool:start",
            {
                "session_id": self._session_id,
                "ind": step,
                "tool_name": tool_name,
            },
        )

    async def tool_result_event(
        self,
        tool_name: str,
        tool_call_id: str,
        result: Any,
        step: int,
    ) -> None:
        """Emit tool:start + tool:delta for a remote tool's result."""
        await self._sio.emit(
            "tool:start",
            {
                "session_id": self._session_id,
                "ind": step,
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
            },
        )

        openui_resp: str | None = None
        if isinstance(result, dict):
            openui_resp = result.get("openui_lang")

        payload: dict[str, Any] = {
            "session_id": self._session_id,
            "ind": step,
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "response_type": "success",
            "data": result,
        }
        if openui_resp:
            payload["openui_response"] = openui_resp
        await self._sio.emit("tool:delta", payload)

    # ------------------------------------------------------------------
    # UI metadata
    # ------------------------------------------------------------------

    def build_ui_spec(self) -> dict[str, Any] | None:
        if self._citation_processor is not None:
            return self._citation_processor.build_ui_spec()
        return None


class SocketIOToolRequester:
    """Emits tool:request / tool:approval_required via Socket.IO.

    After each ``request()`` call, ``last_request_needs_approval`` is set
    so the caller can adjust session status (AWAITING_TOOL vs
    AWAITING_APPROVAL).
    """

    def __init__(
        self,
        sio: Any,
        session_id: str,
        always_allowed_tools: set[str] | None = None,
        connector_approval_tools: set[str] | None = None,
        connector_gateway_map: dict[str, str] | None = None,
    ) -> None:
        self._sio = sio
        self._session_id = session_id
        self._always_allowed_tools = always_allowed_tools or set()
        self._connector_approval_tools = connector_approval_tools or set()
        self._connector_gateway_map = connector_gateway_map or {}
        self.last_request_needs_approval: bool = False

    async def request(self, tool: dict[str, Any]) -> None:
        tool_name: str = tool["name"]
        tool_input: dict[str, Any] = tool.get("input", {})
        tool_id: str = tool.get("call_id") or tool.get("id", "")
        tool_step: int = tool.get("step", 0)

        needs_approval = (
            requires_approval(tool_name)
            and tool_name not in self._always_allowed_tools
        )
        is_connector_approval = tool_name in self._connector_approval_tools

        self.last_request_needs_approval = needs_approval or is_connector_approval

        # Emit tool:start first (mirrors the existing handler behavior)
        await self._sio.emit(
            "tool:start",
            {
                "session_id": self._session_id,
                "ind": tool_step,
                "tool_name": tool_name,
                "tool_call_id": tool_id,
            },
        )

        if self.last_request_needs_approval:
            gateway_id = self._connector_gateway_map.get(tool_name)
            payload: dict[str, Any] = {
                "session_id": self._session_id,
                "ind": tool_step,
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_call_id": tool_id,
            }
            if gateway_id:
                payload["gateway_id"] = gateway_id
            await self._sio.emit("tool:approval_required", payload)
        else:
            await self._sio.emit(
                "tool:request",
                {
                    "session_id": self._session_id,
                    "ind": tool_step,
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                    "tool_call_id": tool_id,
                },
            )
