"""Unit tests for artifact_tool — render_artifact FunctionTool."""

import asyncio
import json
from queue import Queue
from typing import Any
from unittest.mock import MagicMock

from onyx.agents.bud_agent.artifact_tool import create_artifact_tool
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd


def _run_tool(args: dict[str, Any]) -> tuple[str, list[Packet]]:
    """Helper: invoke the render_artifact tool and collect emitted packets."""
    packet_queue: Queue[Any] = Queue()
    step_fn = MagicMock(return_value=0)

    tools = create_artifact_tool(
        session_id=MagicMock(),
        packet_queue=packet_queue,
        step_number_fn=step_fn,
        db_session=None,  # skip DB persistence in tests
    )
    assert len(tools) == 1
    tool = tools[0]
    assert tool.name == "render_artifact"

    ctx = MagicMock()
    result = asyncio.get_event_loop().run_until_complete(
        tool.on_invoke_tool(ctx, json.dumps(args))
    )

    packets: list[Packet] = []
    while not packet_queue.empty():
        packets.append(packet_queue.get_nowait())
    return result, packets


class TestArtifactToolCreation:
    def test_creates_single_tool(self) -> None:
        tools = create_artifact_tool(
            session_id=MagicMock(),
            packet_queue=Queue(),
        )
        assert len(tools) == 1
        assert tools[0].name == "render_artifact"


class TestArtifactToolChart:
    def test_bar_chart_emits_artifact(self) -> None:
        args = {
            "type": "chart",
            "title": "Revenue",
            "data": {
                "data": [
                    {"month": "Jan", "value": 100},
                    {"month": "Feb", "value": 200},
                ],
                "xKey": "month",
                "yKey": "value",
            },
        }
        result, packets = _run_tool(args)
        assert "Artifact rendered" in result

        # Check packet sequence: CustomToolStart → CustomToolDelta → SectionEnd
        assert len(packets) == 3
        assert isinstance(packets[0].obj, CustomToolStart)
        assert packets[0].obj.tool_name == "render_artifact"

        delta = packets[1].obj
        assert isinstance(delta, CustomToolDelta)
        assert delta.openui_response is not None
        assert "BarChart" in delta.openui_response
        assert "Series" in delta.openui_response

        assert isinstance(packets[2].obj, SectionEnd)

    def test_pie_chart(self) -> None:
        args = {
            "type": "chart",
            "title": "Market Share",
            "data": {
                "data": [
                    {"company": "A", "share": 60},
                    {"company": "B", "share": 40},
                ],
                "xKey": "company",
                "yKey": "share",
                "type": "pie",
            },
        }
        result, packets = _run_tool(args)
        assert "Artifact rendered" in result
        delta = packets[1].obj
        assert isinstance(delta, CustomToolDelta)
        assert delta.openui_response is not None
        assert "PieChart" in delta.openui_response


class TestArtifactToolTable:
    def test_table_emits_artifact(self) -> None:
        args = {
            "type": "table",
            "title": "Users",
            "data": {
                "columns": [
                    {"key": "name", "label": "Name", "type": "string"},
                    {"key": "age", "label": "Age", "type": "number"},
                ],
                "rows": [
                    {"name": "Alice", "age": 30},
                ],
            },
        }
        result, packets = _run_tool(args)
        assert "Artifact rendered" in result
        delta = packets[1].obj
        assert isinstance(delta, CustomToolDelta)
        assert delta.openui_response is not None
        assert "Table" in delta.openui_response
        assert "Col" in delta.openui_response


class TestArtifactToolEmail:
    def test_email_emits_artifact(self) -> None:
        args = {
            "type": "email",
            "title": "Draft Email",
            "data": {
                "to": ["user@example.com"],
                "subject": "Meeting",
                "body": "Let's meet at 3pm.",
            },
        }
        result, packets = _run_tool(args)
        assert "Artifact rendered" in result
        delta = packets[1].obj
        assert isinstance(delta, CustomToolDelta)
        assert delta.openui_response is not None
        assert "EmailDraft" in delta.openui_response


class TestArtifactToolCode:
    def test_code_emits_artifact(self) -> None:
        args = {
            "type": "code",
            "title": "Python Snippet",
            "data": {
                "code": "print('hello')",
                "language": "python",
            },
        }
        result, packets = _run_tool(args)
        assert "Artifact rendered" in result
        delta = packets[1].obj
        assert isinstance(delta, CustomToolDelta)
        assert delta.openui_response is not None
        assert "CodeBlock" in delta.openui_response


class TestArtifactToolReport:
    def test_report_emits_artifact(self) -> None:
        args = {
            "type": "report",
            "title": "Analysis",
            "data": {
                "title": "Q4 Report",
                "summary": "Revenue grew 20%.",
                "sections": [
                    {"heading": "Revenue", "body": "Details here."},
                ],
            },
        }
        result, packets = _run_tool(args)
        assert "Artifact rendered" in result
        delta = packets[1].obj
        assert isinstance(delta, CustomToolDelta)
        assert delta.openui_response is not None
        assert "Accordion" in delta.openui_response


class TestArtifactToolErrors:
    def test_invalid_json_returns_error(self) -> None:
        """Bad JSON input should not crash."""
        packet_queue: Queue[Any] = Queue()
        tools = create_artifact_tool(
            session_id=MagicMock(),
            packet_queue=packet_queue,
        )
        ctx = MagicMock()
        result = asyncio.get_event_loop().run_until_complete(
            tools[0].on_invoke_tool(ctx, "not json{{{")
        )
        assert "invalid JSON" in result

    def test_unrecognized_data_shape_returns_error(self) -> None:
        args = {
            "type": "chart",
            "title": "Bad Chart",
            "data": {"foo": "bar"},
        }
        result, packets = _run_tool(args)
        assert "could not convert" in result
        # Should still emit start + error delta + section end
        assert len(packets) == 3
        delta = packets[1].obj
        assert isinstance(delta, CustomToolDelta)
        assert delta.openui_response is None
