"""Unit tests for agent packet reconstruction.

Tests the translate_agent_messages_to_packets() function which converts
persisted AgentMessage rows into Packet format for frontend rendering.
"""

import datetime
from unittest.mock import MagicMock
from uuid import uuid4

from onyx.agents.bud_agent.packet_utils import translate_agent_messages_to_packets
from onyx.db.enums import AgentMessageRole
from onyx.server.query_and_chat.streaming_models import (
    CustomToolDelta,
    CustomToolStart,
    MessageDelta,
    MessageStart,
    OverallStop,
    Packet,
    ReasoningDelta,
    ReasoningStart,
    SectionEnd,
)


def _make_message(
    role: AgentMessageRole,
    content: str | None = None,
    tool_name: str | None = None,
    tool_input: dict | None = None,
    tool_output: dict | None = None,
    tool_error: str | None = None,
    tool_call_id: str | None = None,
    step_number: int | None = None,
    thinking_content: str | None = None,
    ui_spec: dict | None = None,
    created_at: datetime.datetime | None = None,
) -> MagicMock:
    """Create a mock AgentMessage for testing."""
    msg = MagicMock()
    msg.id = uuid4()
    msg.role = role
    msg.content = content
    msg.tool_name = tool_name
    msg.tool_input = tool_input
    msg.tool_output = tool_output
    msg.tool_error = tool_error
    msg.tool_call_id = tool_call_id
    msg.step_number = step_number
    msg.thinking_content = thinking_content
    msg.ui_spec = ui_spec
    msg.created_at = created_at or datetime.datetime.now(tz=datetime.timezone.utc)
    return msg


def test_empty_messages() -> None:
    """Empty input produces empty output."""
    result = translate_agent_messages_to_packets([])
    assert result == []


def test_single_user_message_only() -> None:
    """A user message alone produces no packets (no assistant response)."""
    messages = [
        _make_message(AgentMessageRole.USER, content="Hello"),
    ]
    result = translate_agent_messages_to_packets(messages)
    assert result == []


def test_simple_assistant_response() -> None:
    """User -> assistant text produces message packets."""
    messages = [
        _make_message(AgentMessageRole.USER, content="Hello"),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Hi there!",
            step_number=0,
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1  # One turn
    turn = result[0]

    # Should have: MessageStart + MessageDelta + SectionEnd + OverallStop
    types = [p.obj.type for p in turn]
    assert "message_start" in types
    assert "message_delta" in types
    assert "section_end" in types
    assert "stop" in types  # OverallStop

    # Verify message content
    message_deltas = [p for p in turn if p.obj.type == "message_delta"]
    assert len(message_deltas) == 1
    delta_obj = message_deltas[0].obj
    assert isinstance(delta_obj, MessageDelta)
    assert delta_obj.content == "Hi there!"


def test_assistant_with_thinking() -> None:
    """Assistant message with thinking_content produces reasoning + message packets."""
    messages = [
        _make_message(AgentMessageRole.USER, content="Think about this"),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Here is my answer.",
            thinking_content="Let me consider...",
            step_number=0,
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]
    types = [p.obj.type for p in turn]

    # Should have reasoning packets before message packets
    assert "reasoning_start" in types
    assert "reasoning_delta" in types
    assert "message_start" in types
    assert "message_delta" in types

    # Verify ordering: reasoning comes before message
    reasoning_idx = types.index("reasoning_start")
    message_idx = types.index("message_start")
    assert reasoning_idx < message_idx

    # Verify reasoning content
    reasoning_deltas = [p for p in turn if p.obj.type == "reasoning_delta"]
    assert len(reasoning_deltas) == 1
    r_obj = reasoning_deltas[0].obj
    assert isinstance(r_obj, ReasoningDelta)
    assert r_obj.reasoning == "Let me consider..."


def test_tool_call_with_output() -> None:
    """Tool message with output produces tool start + delta packets."""
    messages = [
        _make_message(AgentMessageRole.USER, content="Read file"),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="read_file",
            tool_input={"path": "/tmp/test.txt"},
            tool_output={"output": "file contents here"},
            tool_call_id="tc-001",
            step_number=0,
        ),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="The file contains...",
            step_number=1,
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]
    types = [p.obj.type for p in turn]

    # Tool packets
    assert "custom_tool_start" in types
    assert "custom_tool_delta" in types

    # Verify tool name
    tool_starts = [p for p in turn if p.obj.type == "custom_tool_start"]
    assert len(tool_starts) == 1
    ts_obj = tool_starts[0].obj
    assert isinstance(ts_obj, CustomToolStart)
    assert ts_obj.tool_name == "read_file"

    # Verify tool output (single "output" key is unwrapped)
    tool_deltas = [p for p in turn if p.obj.type == "custom_tool_delta"]
    assert len(tool_deltas) == 1
    td_obj = tool_deltas[0].obj
    assert isinstance(td_obj, CustomToolDelta)
    assert td_obj.data == "file contents here"
    assert td_obj.response_type == "text"


def test_tool_call_with_error() -> None:
    """Tool message with error produces error-type tool delta."""
    messages = [
        _make_message(AgentMessageRole.USER, content="Run command"),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="bash",
            tool_input={"command": "exit 1"},
            tool_error="Command failed with exit code 1",
            tool_call_id="tc-002",
            step_number=0,
        ),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="The command failed.",
            step_number=1,
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]

    tool_deltas = [p for p in turn if p.obj.type == "custom_tool_delta"]
    assert len(tool_deltas) == 1
    td_obj = tool_deltas[0].obj
    assert isinstance(td_obj, CustomToolDelta)
    assert td_obj.response_type == "error"
    assert td_obj.data == "Command failed with exit code 1"


def test_multiple_tools_in_one_turn() -> None:
    """Multiple tool calls in a single turn get separate step numbers."""
    base_time = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)
    messages = [
        _make_message(
            AgentMessageRole.USER,
            content="Read two files",
            created_at=base_time,
        ),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="read_file",
            tool_input={"path": "/tmp/a.txt"},
            tool_output={"output": "aaa"},
            tool_call_id="tc-a",
            step_number=0,
            created_at=base_time + datetime.timedelta(seconds=1),
        ),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="read_file",
            tool_input={"path": "/tmp/b.txt"},
            tool_output={"output": "bbb"},
            tool_call_id="tc-b",
            step_number=1,
            created_at=base_time + datetime.timedelta(seconds=2),
        ),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Both files read.",
            step_number=2,
            created_at=base_time + datetime.timedelta(seconds=3),
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]

    # Should have two tool starts
    tool_starts = [p for p in turn if p.obj.type == "custom_tool_start"]
    assert len(tool_starts) == 2

    # Verify step numbers (ind values) are different
    assert tool_starts[0].ind != tool_starts[1].ind


def test_multiple_turns() -> None:
    """Multiple user-assistant exchanges produce multiple turns."""
    messages = [
        _make_message(AgentMessageRole.USER, content="Question 1"),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Answer 1",
            step_number=0,
        ),
        _make_message(AgentMessageRole.USER, content="Question 2"),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Answer 2",
            step_number=0,
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 2  # Two turns

    # Each turn should end with OverallStop
    for turn in result:
        assert turn[-1].obj.type == "stop"


def test_legacy_messages_without_step_number() -> None:
    """Messages without step_number get auto-assigned step numbers."""
    base_time = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)
    messages = [
        _make_message(
            AgentMessageRole.USER,
            content="Hello",
            created_at=base_time,
        ),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="read_file",
            tool_output={"output": "content"},
            step_number=None,  # Legacy: no step number
            created_at=base_time + datetime.timedelta(seconds=1),
        ),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Done.",
            step_number=None,  # Legacy: no step number
            created_at=base_time + datetime.timedelta(seconds=2),
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]

    # Should still produce valid packets
    types = [p.obj.type for p in turn]
    assert "custom_tool_start" in types
    assert "message_start" in types
    assert "stop" in types


def test_overall_stop_at_end() -> None:
    """Every non-empty turn ends with an OverallStop packet."""
    messages = [
        _make_message(AgentMessageRole.USER, content="Hi"),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Hello!",
            step_number=0,
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    last_packet = result[0][-1]
    assert isinstance(last_packet.obj, OverallStop)


def test_intermediate_texts_interleaved_with_tools() -> None:
    """Intermediate texts are emitted as reasoning steps interleaved with tools."""
    base_time = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)
    messages = [
        _make_message(
            AgentMessageRole.USER,
            content="What is the news today?",
            created_at=base_time,
        ),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Here are the latest headlines with citations.",
            step_number=4,
            ui_spec={
                "intermediate_texts": [
                    "I'm going to search for today's news.",
                    "Let me open those articles to get the full details.",
                ],
            },
            created_at=base_time + datetime.timedelta(seconds=10),
        ),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="web_search",
            tool_input={"queries": ["latest news today"]},
            tool_output={"results": [], "search_docs": []},
            tool_call_id="tc-ws",
            step_number=1,
            created_at=base_time + datetime.timedelta(seconds=2),
        ),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="open_url",
            tool_input={"urls": ["https://example.com"]},
            tool_output={"results": [], "fetch_docs": []},
            tool_call_id="tc-ou",
            step_number=3,
            created_at=base_time + datetime.timedelta(seconds=5),
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]
    types = [p.obj.type for p in turn]

    # Pattern: reasoning → tool → reasoning → tool → message → stop
    # Step 0: reasoning (intermediate_texts[0])
    # Step 1: web_search tool
    # Step 2: reasoning (intermediate_texts[1])
    # Step 3: open_url tool
    # Step 4: message (final answer)
    # Step 5: stop

    # Verify reasoning packets exist
    reasoning_starts = [p for p in turn if p.obj.type == "reasoning_start"]
    assert len(reasoning_starts) == 2

    reasoning_deltas = [p for p in turn if p.obj.type == "reasoning_delta"]
    assert len(reasoning_deltas) == 2

    # Verify reasoning content
    assert isinstance(reasoning_deltas[0].obj, ReasoningDelta)
    assert reasoning_deltas[0].obj.reasoning == "I'm going to search for today's news."
    assert isinstance(reasoning_deltas[1].obj, ReasoningDelta)
    assert reasoning_deltas[1].obj.reasoning == (
        "Let me open those articles to get the full details."
    )

    # Verify step ordering: reasoning[0] < tool[0] < reasoning[1] < tool[1] < message
    assert reasoning_starts[0].ind < reasoning_starts[1].ind
    tool_starts = [
        p for p in turn
        if p.obj.type in ("internal_search_tool_start", "fetch_tool_start")
    ]
    assert len(tool_starts) == 2
    assert reasoning_starts[0].ind < tool_starts[0].ind
    assert tool_starts[0].ind < reasoning_starts[1].ind
    assert reasoning_starts[1].ind < tool_starts[1].ind

    # Final message comes last (before stop)
    message_starts = [p for p in turn if p.obj.type == "message_start"]
    assert len(message_starts) == 1
    assert message_starts[0].ind > tool_starts[1].ind

    # Ends with OverallStop
    assert isinstance(turn[-1].obj, OverallStop)


def test_intermediate_texts_with_thinking() -> None:
    """Intermediate texts with thinking_content — thinking comes first."""
    base_time = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)
    messages = [
        _make_message(
            AgentMessageRole.USER,
            content="Search for something",
            created_at=base_time,
        ),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="Here is the answer.",
            thinking_content="Let me think about this...",
            step_number=3,
            ui_spec={
                "intermediate_texts": [
                    "I'll search for this information.",
                ],
            },
            created_at=base_time + datetime.timedelta(seconds=5),
        ),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="web_search",
            tool_input={"queries": ["something"]},
            tool_output={"results": [], "search_docs": []},
            tool_call_id="tc-1",
            step_number=1,
            created_at=base_time + datetime.timedelta(seconds=2),
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]

    reasoning_deltas = [p for p in turn if p.obj.type == "reasoning_delta"]
    # Two reasoning deltas: one for thinking, one for intermediate text
    assert len(reasoning_deltas) == 2
    assert isinstance(reasoning_deltas[0].obj, ReasoningDelta)
    assert reasoning_deltas[0].obj.reasoning == "Let me think about this..."
    assert isinstance(reasoning_deltas[1].obj, ReasoningDelta)
    assert reasoning_deltas[1].obj.reasoning == "I'll search for this information."

    # Thinking at step 0, intermediate text at step 1, tool at step 2, message at step 3
    assert reasoning_deltas[0].ind < reasoning_deltas[1].ind


def test_no_intermediate_texts_preserves_original_behavior() -> None:
    """Without intermediate_texts, the original rendering path is used."""
    base_time = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)
    messages = [
        _make_message(
            AgentMessageRole.USER,
            content="Read file",
            created_at=base_time,
        ),
        _make_message(
            AgentMessageRole.TOOL,
            tool_name="read_file",
            tool_input={"path": "/tmp/test.txt"},
            tool_output={"output": "file content"},
            tool_call_id="tc-rf",
            step_number=0,
            created_at=base_time + datetime.timedelta(seconds=1),
        ),
        _make_message(
            AgentMessageRole.ASSISTANT,
            content="The file says...",
            step_number=1,
            created_at=base_time + datetime.timedelta(seconds=2),
        ),
    ]
    result = translate_agent_messages_to_packets(messages)

    assert len(result) == 1
    turn = result[0]

    # No reasoning packets — original path
    reasoning_starts = [p for p in turn if p.obj.type == "reasoning_start"]
    assert len(reasoning_starts) == 0

    # Tool + message + stop
    types = [p.obj.type for p in turn]
    assert "custom_tool_start" in types
    assert "message_start" in types
    assert "stop" in types
