"""Unit tests for SocketIOEmitter and SocketIOToolRequester.

All external dependencies (Socket.IO server, CitationProcessor, search
context) are mocked so these tests run without any running services.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest

from onyx.server.agent.socketio_emitter import SocketIOEmitter
from onyx.server.agent.socketio_emitter import SocketIOToolRequester

SESSION_ID = "test-session-123"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sio() -> AsyncMock:
    """Return a mock Socket.IO server with an async ``emit``."""
    sio = AsyncMock()
    sio.emit = AsyncMock()
    return sio


def _make_emitter(
    sio: AsyncMock | None = None,
    citation_processor: MagicMock | None = None,
) -> SocketIOEmitter:
    """Build a SocketIOEmitter with no search_context; optionally inject a
    pre-built CitationProcessor mock via private attribute."""
    if sio is None:
        sio = _make_sio()
    emitter = SocketIOEmitter(sio=sio, session_id=SESSION_ID)
    if citation_processor is not None:
        emitter._citation_processor = citation_processor
    return emitter


def _make_citation_info(
    citation_num: int, document_id: str
) -> MagicMock:
    """Create a lightweight CitationInfo-like mock."""
    ci = MagicMock()
    ci.citation_num = citation_num
    ci.document_id = document_id
    return ci


# ===================================================================
# SocketIOEmitter tests
# ===================================================================


class TestSocketIOEmitterConstructor:
    """Constructor wiring with and without search context."""

    def test_no_search_context(self) -> None:
        sio = _make_sio()
        emitter = SocketIOEmitter(sio=sio, session_id=SESSION_ID)
        assert emitter._citation_processor is None
        assert emitter._session_id == SESSION_ID

    @patch(
        "onyx.agents.bud_agent.citation_processor.CitationProcessor",
        autospec=False,
    )
    def test_active_search_context(self, mock_cp_cls: MagicMock) -> None:
        """When search_context is provided and processor is active, it is stored."""
        mock_cp = MagicMock()
        mock_cp.active = True
        mock_cp_cls.return_value = mock_cp

        sio = _make_sio()
        ctx = MagicMock()
        emitter = SocketIOEmitter(sio=sio, session_id=SESSION_ID, search_context=ctx)

        mock_cp_cls.assert_called_once_with(ctx)
        assert emitter._citation_processor is mock_cp

    @patch(
        "onyx.agents.bud_agent.citation_processor.CitationProcessor",
        autospec=False,
    )
    def test_inactive_search_context(self, mock_cp_cls: MagicMock) -> None:
        """When search_context is provided but processor is NOT active, it is
        left as None."""
        mock_cp = MagicMock()
        mock_cp.active = False
        mock_cp_cls.return_value = mock_cp

        sio = _make_sio()
        ctx = MagicMock()
        emitter = SocketIOEmitter(sio=sio, session_id=SESSION_ID, search_context=ctx)

        assert emitter._citation_processor is None


class TestSocketIOEmitterReasoningEvents:
    """reasoning_start / reasoning_delta."""

    @pytest.mark.asyncio
    async def test_reasoning_start(self) -> None:
        sio = _make_sio()
        emitter = _make_emitter(sio=sio)

        await emitter.reasoning_start(step=0)

        sio.emit.assert_awaited_once_with(
            "agent:reasoning_start",
            {"session_id": SESSION_ID, "ind": 0},
        )

    @pytest.mark.asyncio
    async def test_reasoning_delta(self) -> None:
        sio = _make_sio()
        emitter = _make_emitter(sio=sio)

        await emitter.reasoning_delta("thinking...", step=1)

        sio.emit.assert_awaited_once_with(
            "agent:reasoning_delta",
            {"session_id": SESSION_ID, "ind": 1, "reasoning": "thinking..."},
        )


class TestSocketIOEmitterTextEvents:
    """text_start / text_delta."""

    @pytest.mark.asyncio
    async def test_text_start(self) -> None:
        sio = _make_sio()
        emitter = _make_emitter(sio=sio)

        await emitter.text_start(step=2)

        sio.emit.assert_awaited_once_with(
            "agent:message_start",
            {
                "session_id": SESSION_ID,
                "ind": 2,
                "content": "",
                "final_documents": None,
            },
        )

    @pytest.mark.asyncio
    async def test_text_delta_without_citations(self) -> None:
        sio = _make_sio()
        emitter = _make_emitter(sio=sio)

        await emitter.text_delta("hello", step=3)

        sio.emit.assert_awaited_once_with(
            "agent:message_delta",
            {"session_id": SESSION_ID, "ind": 3, "content": "hello"},
        )

    @pytest.mark.asyncio
    async def test_text_delta_with_citations_text_only(self) -> None:
        """Citation processor returns text but no new citations."""
        cp = MagicMock()
        cp.process_token.return_value = ("processed text", [])

        sio = _make_sio()
        emitter = _make_emitter(sio=sio, citation_processor=cp)

        await emitter.text_delta("raw", step=4)

        cp.process_token.assert_called_once_with("raw")
        sio.emit.assert_awaited_once_with(
            "agent:message_delta",
            {"session_id": SESSION_ID, "ind": 4, "content": "processed text"},
        )

    @pytest.mark.asyncio
    async def test_text_delta_with_citations_emits_both(self) -> None:
        """Citation processor returns text AND new citations."""
        ci = _make_citation_info(1, "doc-abc")
        cp = MagicMock()
        cp.process_token.return_value = ("linked text", [ci])

        sio = _make_sio()
        emitter = _make_emitter(sio=sio, citation_processor=cp)

        await emitter.text_delta("[1]", step=5)

        assert sio.emit.await_count == 2
        calls = sio.emit.await_args_list

        # First call: message_delta
        assert calls[0].args[0] == "agent:message_delta"
        assert calls[0].args[1] == {
            "session_id": SESSION_ID,
            "ind": 5,
            "content": "linked text",
        }

        # Second call: citation
        assert calls[1].args[0] == "agent:citation"
        assert calls[1].args[1] == {
            "session_id": SESSION_ID,
            "ind": 5,
            "citations": [{"citation_num": 1, "document_id": "doc-abc"}],
        }

    @pytest.mark.asyncio
    async def test_text_delta_citation_buffering_empty(self) -> None:
        """When the processor buffers (partial citation), nothing is emitted."""
        cp = MagicMock()
        cp.process_token.return_value = ("", [])

        sio = _make_sio()
        emitter = _make_emitter(sio=sio, citation_processor=cp)

        await emitter.text_delta("[", step=6)

        # Empty processed text means no emit at all
        sio.emit.assert_not_awaited()


class TestSocketIOEmitterSectionEnd:
    """section_end flushes citations and emits section_end."""

    @pytest.mark.asyncio
    async def test_section_end_flushes_citation_buffer(self) -> None:
        cp = MagicMock()
        cp.flush.return_value = ("remaining text", [])

        sio = _make_sio()
        emitter = _make_emitter(sio=sio, citation_processor=cp)

        await emitter.section_end(step=7)

        assert sio.emit.await_count == 2
        calls = sio.emit.await_args_list

        # Flush emit
        assert calls[0].args[0] == "agent:message_delta"
        assert calls[0].args[1] == {
            "session_id": SESSION_ID,
            "ind": 7,
            "content": "remaining text",
        }

        # Section end emit
        assert calls[1].args[0] == "agent:section_end"
        assert calls[1].args[1] == {"session_id": SESSION_ID, "ind": 7}

    @pytest.mark.asyncio
    async def test_section_end_empty_flush(self) -> None:
        """When flush returns empty string, only section_end is emitted."""
        cp = MagicMock()
        cp.flush.return_value = ("", [])

        sio = _make_sio()
        emitter = _make_emitter(sio=sio, citation_processor=cp)

        await emitter.section_end(step=8)

        sio.emit.assert_awaited_once_with(
            "agent:section_end",
            {"session_id": SESSION_ID, "ind": 8},
        )

    @pytest.mark.asyncio
    async def test_section_end_without_citation_processor(self) -> None:
        sio = _make_sio()
        emitter = _make_emitter(sio=sio)

        await emitter.section_end(step=9)

        sio.emit.assert_awaited_once_with(
            "agent:section_end",
            {"session_id": SESSION_ID, "ind": 9},
        )


class TestSocketIOEmitterToolStart:
    """tool_start event."""

    @pytest.mark.asyncio
    async def test_tool_start(self) -> None:
        sio = _make_sio()
        emitter = _make_emitter(sio=sio)

        await emitter.tool_start("web_search", step=10)

        sio.emit.assert_awaited_once_with(
            "tool:start",
            {
                "session_id": SESSION_ID,
                "ind": 10,
                "tool_name": "web_search",
            },
        )


class TestSocketIOEmitterBuildUISpec:
    """build_ui_spec delegation."""

    def test_build_ui_spec_with_processor(self) -> None:
        cp = MagicMock()
        cp.build_ui_spec.return_value = {"citations": [], "search_docs": []}

        emitter = _make_emitter(citation_processor=cp)
        result = emitter.build_ui_spec()

        cp.build_ui_spec.assert_called_once()
        assert result == {"citations": [], "search_docs": []}

    def test_build_ui_spec_without_processor(self) -> None:
        emitter = _make_emitter()
        result = emitter.build_ui_spec()
        assert result is None


# ===================================================================
# SocketIOToolRequester tests
# ===================================================================


class TestSocketIOToolRequesterRequest:
    """request() routing: tool:request vs tool:approval_required."""

    @pytest.mark.asyncio
    async def test_non_approval_tool_emits_request(self) -> None:
        """A tool NOT in APPROVAL_REQUIRED_TOOLS emits tool:start + tool:request."""
        sio = _make_sio()
        requester = SocketIOToolRequester(sio=sio, session_id=SESSION_ID)

        tool: dict[str, Any] = {
            "name": "web_search",
            "input": {"queries": ["test"]},
            "id": "call-1",
        }
        await requester.request(tool)

        assert sio.emit.await_count == 2
        calls = sio.emit.await_args_list
        # First: tool:start
        assert calls[0].args[0] == "tool:start"
        assert calls[0].args[1]["tool_name"] == "web_search"
        # Second: tool:request
        assert calls[1].args[0] == "tool:request"
        assert calls[1].args[1]["tool_name"] == "web_search"
        assert calls[1].args[1]["tool_call_id"] == "call-1"
        assert requester.last_request_needs_approval is False

    @pytest.mark.asyncio
    async def test_approval_required_tool(self) -> None:
        """A tool in APPROVAL_REQUIRED_TOOLS emits tool:start + tool:approval_required."""
        sio = _make_sio()
        requester = SocketIOToolRequester(sio=sio, session_id=SESSION_ID)

        tool: dict[str, Any] = {
            "name": "bash",
            "input": {"command": "ls"},
            "id": "call-2",
        }
        await requester.request(tool)

        assert sio.emit.await_count == 2
        calls = sio.emit.await_args_list
        assert calls[0].args[0] == "tool:start"
        assert calls[1].args[0] == "tool:approval_required"
        assert calls[1].args[1]["tool_name"] == "bash"
        assert calls[1].args[1]["tool_call_id"] == "call-2"
        assert requester.last_request_needs_approval is True

    @pytest.mark.asyncio
    async def test_always_allowed_bypasses_approval(self) -> None:
        """A tool in always_allowed_tools skips approval even if it would
        normally require it."""
        sio = _make_sio()
        requester = SocketIOToolRequester(
            sio=sio,
            session_id=SESSION_ID,
            always_allowed_tools={"bash"},
        )

        tool: dict[str, Any] = {
            "name": "bash",
            "input": {"command": "echo hi"},
            "id": "call-3",
        }
        await requester.request(tool)

        assert sio.emit.await_count == 2
        calls = sio.emit.await_args_list
        assert calls[0].args[0] == "tool:start"
        assert calls[1].args[0] == "tool:request"
        assert calls[1].args[1]["tool_name"] == "bash"
        assert requester.last_request_needs_approval is False

    @pytest.mark.asyncio
    async def test_connector_approval_with_gateway_id(self) -> None:
        """Connector approval tools include gateway_id when available."""
        sio = _make_sio()
        requester = SocketIOToolRequester(
            sio=sio,
            session_id=SESSION_ID,
            connector_approval_tools={"slack_send"},
            connector_gateway_map={"slack_send": "gw-abc"},
        )

        tool: dict[str, Any] = {
            "name": "slack_send",
            "input": {"channel": "#general"},
            "id": "call-4",
        }
        await requester.request(tool)

        assert sio.emit.await_count == 2
        calls = sio.emit.await_args_list
        assert calls[0].args[0] == "tool:start"
        assert calls[1].args[0] == "tool:approval_required"
        approval_payload = calls[1].args[1]
        assert approval_payload["tool_name"] == "slack_send"
        assert approval_payload["gateway_id"] == "gw-abc"
        assert requester.last_request_needs_approval is True

    @pytest.mark.asyncio
    async def test_connector_approval_without_gateway_id(self) -> None:
        """Connector approval tools omit gateway_id when not mapped."""
        sio = _make_sio()
        requester = SocketIOToolRequester(
            sio=sio,
            session_id=SESSION_ID,
            connector_approval_tools={"jira_create"},
        )

        tool: dict[str, Any] = {
            "name": "jira_create",
            "input": {"summary": "bug"},
            "id": "call-5",
        }
        await requester.request(tool)

        assert sio.emit.await_count == 2
        approval_payload = sio.emit.await_args_list[1].args[1]
        assert "gateway_id" not in approval_payload
        assert approval_payload["tool_name"] == "jira_create"

    @pytest.mark.asyncio
    async def test_missing_input_and_id_defaults(self) -> None:
        """When tool dict omits ``input`` and ``id``, defaults are used."""
        sio = _make_sio()
        requester = SocketIOToolRequester(sio=sio, session_id=SESSION_ID)

        tool: dict[str, Any] = {"name": "web_search"}
        await requester.request(tool)

        assert sio.emit.await_count == 2
        request_payload = sio.emit.await_args_list[1].args[1]
        assert request_payload["tool_name"] == "web_search"
        assert request_payload["tool_input"] == {}
        assert request_payload["tool_call_id"] == ""
