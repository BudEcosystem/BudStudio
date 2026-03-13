"""Unit tests for canvas persistence in the chat path.

Tests:
1. update_chat_message_canvas sets canvas_data correctly
2. translate_db_message_to_packets_simple emits CanvasGeneration when canvas_data present
3. translate_db_message_to_packets_simple omits CanvasGeneration when canvas_data absent
4. translate_db_message_to_packets (full) emits CanvasGeneration when canvas_data present
5. translate_db_message_to_packets (full) omits CanvasGeneration when canvas_data absent
"""

from unittest.mock import MagicMock, patch

from onyx.configs.constants import MessageType
from onyx.server.query_and_chat.streaming_models import (
    CanvasGeneration,
    Packet,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chat_message(
    message_type: MessageType = MessageType.ASSISTANT,
    message: str = "Hello",
    canvas_data: dict | None = None,
    citations: dict | None = None,
    search_docs: list | None = None,
    research_type: str | None = None,
    research_plan: dict | None = None,
    tool_call: object | None = None,
    sub_questions: list | None = None,
    research_iterations: list | None = None,
) -> MagicMock:
    """Create a mock ChatMessage for testing."""
    msg = MagicMock()
    msg.message_type = message_type
    msg.message = message
    msg.canvas_data = canvas_data
    msg.citations = citations
    msg.search_docs = search_docs or []
    msg.research_type = research_type
    msg.research_plan = research_plan
    msg.tool_call = tool_call
    msg.sub_questions = sub_questions or []
    msg.research_iterations = research_iterations or []
    return msg


# ---------------------------------------------------------------------------
# Tests for update_chat_message_canvas
# ---------------------------------------------------------------------------

def test_update_chat_message_canvas_sets_data() -> None:
    """update_chat_message_canvas persists openui_lang and title."""
    mock_msg = MagicMock()
    mock_msg.canvas_data = None

    mock_session = MagicMock()
    mock_session.query.return_value.filter.return_value.first.return_value = mock_msg

    from onyx.db.chat import update_chat_message_canvas

    update_chat_message_canvas(
        db_session=mock_session,
        chat_message_id=42,
        openui_lang='root = EmailDraft(["john@example.com"], [], "Q4", "Body")',
        title="Q4 Results",
    )

    assert mock_msg.canvas_data == {
        "openui_lang": 'root = EmailDraft(["john@example.com"], [], "Q4", "Body")',
        "title": "Q4 Results",
    }
    mock_session.commit.assert_called_once()


def test_update_chat_message_canvas_no_message_found() -> None:
    """update_chat_message_canvas does nothing when message not found."""
    mock_session = MagicMock()
    mock_session.query.return_value.filter.return_value.first.return_value = None

    from onyx.db.chat import update_chat_message_canvas

    update_chat_message_canvas(
        db_session=mock_session,
        chat_message_id=999,
        openui_lang="root = X()",
        title="Test",
    )

    mock_session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Tests for translate_db_message_to_packets_simple
# ---------------------------------------------------------------------------

def test_simple_translation_emits_canvas_when_present() -> None:
    """translate_db_message_to_packets_simple includes CanvasGeneration
    when canvas_data is set on the ChatMessage."""
    chat_message = _make_chat_message(
        canvas_data={
            "openui_lang": 'root = EmailDraft(["a@b.com"], [], "Hi", "Body")',
            "title": "Email Draft",
        },
    )

    mock_session = MagicMock()

    from onyx.server.query_and_chat.streaming_utils import (
        translate_db_message_to_packets_simple,
    )

    result = translate_db_message_to_packets_simple(
        chat_message=chat_message,
        db_session=mock_session,
    )

    canvas_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, CanvasGeneration)
    ]
    assert len(canvas_packets) == 1
    assert canvas_packets[0].obj.openui_lang == 'root = EmailDraft(["a@b.com"], [], "Hi", "Body")'
    assert canvas_packets[0].obj.title == "Email Draft"


def test_simple_translation_omits_canvas_when_absent() -> None:
    """translate_db_message_to_packets_simple does not include CanvasGeneration
    when canvas_data is None."""
    chat_message = _make_chat_message(canvas_data=None)

    mock_session = MagicMock()

    from onyx.server.query_and_chat.streaming_utils import (
        translate_db_message_to_packets_simple,
    )

    result = translate_db_message_to_packets_simple(
        chat_message=chat_message,
        db_session=mock_session,
    )

    canvas_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, CanvasGeneration)
    ]
    assert len(canvas_packets) == 0


# ---------------------------------------------------------------------------
# Tests for translate_db_message_to_packets (full path)
# ---------------------------------------------------------------------------

@patch("onyx.server.query_and_chat.streaming_utils.get_current_tenant_id")
@patch("onyx.server.query_and_chat.streaming_utils.get_default_feature_flag_provider")
def test_full_translation_emits_canvas_when_present(
    mock_ff_provider: MagicMock,
    mock_tenant: MagicMock,
) -> None:
    """translate_db_message_to_packets includes CanvasGeneration when canvas_data is set."""
    # Force the non-simple path (research_type=None skips the feature flag check)
    chat_message = _make_chat_message(
        research_type=None,
        canvas_data={
            "openui_lang": 'root = DataTable([["A","B"]], ["Col1","Col2"])',
            "title": "Data Table",
        },
    )

    mock_session = MagicMock()

    from onyx.server.query_and_chat.streaming_utils import (
        translate_db_message_to_packets,
    )

    result = translate_db_message_to_packets(
        chat_message=chat_message,
        db_session=mock_session,
    )

    canvas_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, CanvasGeneration)
    ]
    assert len(canvas_packets) == 1
    assert canvas_packets[0].obj.openui_lang == 'root = DataTable([["A","B"]], ["Col1","Col2"])'
    assert canvas_packets[0].obj.title == "Data Table"


@patch("onyx.server.query_and_chat.streaming_utils.get_current_tenant_id")
@patch("onyx.server.query_and_chat.streaming_utils.get_default_feature_flag_provider")
def test_full_translation_omits_canvas_when_absent(
    mock_ff_provider: MagicMock,
    mock_tenant: MagicMock,
) -> None:
    """translate_db_message_to_packets does not include CanvasGeneration
    when canvas_data is None."""
    chat_message = _make_chat_message(
        research_type=None,
        canvas_data=None,
    )

    mock_session = MagicMock()

    from onyx.server.query_and_chat.streaming_utils import (
        translate_db_message_to_packets,
    )

    result = translate_db_message_to_packets(
        chat_message=chat_message,
        db_session=mock_session,
    )

    canvas_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, CanvasGeneration)
    ]
    assert len(canvas_packets) == 0


@patch("onyx.server.query_and_chat.streaming_utils.get_current_tenant_id")
@patch("onyx.server.query_and_chat.streaming_utils.get_default_feature_flag_provider")
def test_full_translation_canvas_before_overall_stop(
    mock_ff_provider: MagicMock,
    mock_tenant: MagicMock,
) -> None:
    """CanvasGeneration packet appears before OverallStop in the full translation."""
    chat_message = _make_chat_message(
        research_type=None,
        canvas_data={
            "openui_lang": "root = X()",
            "title": "Test",
        },
    )

    mock_session = MagicMock()

    from onyx.server.query_and_chat.streaming_utils import (
        translate_db_message_to_packets,
    )

    result = translate_db_message_to_packets(
        chat_message=chat_message,
        db_session=mock_session,
    )

    types = [p.obj.type for p in result.packet_list if isinstance(p, Packet)]
    assert "canvas_generation" in types
    assert "stop" in types
    canvas_idx = types.index("canvas_generation")
    stop_idx = types.index("stop")
    assert canvas_idx < stop_idx
