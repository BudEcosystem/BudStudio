"""Unit tests for artifact persistence in the chat path.

Tests:
1. update_chat_message_artifact sets artifact_data correctly
2. translate_db_message_to_packets_simple emits ArtifactGeneration when artifact_data present
3. translate_db_message_to_packets_simple omits ArtifactGeneration when artifact_data absent
4. translate_db_message_to_packets (full) emits ArtifactGeneration when artifact_data present
5. translate_db_message_to_packets (full) omits ArtifactGeneration when artifact_data absent
"""

from unittest.mock import MagicMock, patch

from onyx.configs.constants import MessageType
from onyx.server.query_and_chat.streaming_models import (
    ArtifactGeneration,
    Packet,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chat_message(
    message_type: MessageType = MessageType.ASSISTANT,
    message: str = "Hello",
    artifact_data: dict | None = None,
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
    msg.artifact_data = artifact_data
    msg.citations = citations
    msg.search_docs = search_docs or []
    msg.research_type = research_type
    msg.research_plan = research_plan
    msg.tool_call = tool_call
    msg.sub_questions = sub_questions or []
    msg.research_iterations = research_iterations or []
    return msg


# ---------------------------------------------------------------------------
# Tests for update_chat_message_artifact
# ---------------------------------------------------------------------------

def test_update_chat_message_artifact_sets_data() -> None:
    """update_chat_message_artifact persists openui_lang and title."""
    mock_msg = MagicMock()
    mock_msg.artifact_data = None

    mock_session = MagicMock()
    mock_session.query.return_value.filter.return_value.first.return_value = mock_msg

    from onyx.db.chat import update_chat_message_artifact

    update_chat_message_artifact(
        db_session=mock_session,
        chat_message_id=42,
        openui_lang='root = EmailDraft(["john@example.com"], [], "Q4", "Body")',
        title="Q4 Results",
    )

    assert mock_msg.artifact_data == {
        "openui_lang": 'root = EmailDraft(["john@example.com"], [], "Q4", "Body")',
        "title": "Q4 Results",
    }
    mock_session.commit.assert_called_once()


def test_update_chat_message_artifact_no_message_found() -> None:
    """update_chat_message_artifact does nothing when message not found."""
    mock_session = MagicMock()
    mock_session.query.return_value.filter.return_value.first.return_value = None

    from onyx.db.chat import update_chat_message_artifact

    update_chat_message_artifact(
        db_session=mock_session,
        chat_message_id=999,
        openui_lang="root = X()",
        title="Test",
    )

    mock_session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# Tests for translate_db_message_to_packets_simple
# ---------------------------------------------------------------------------

def test_simple_translation_emits_artifact_when_present() -> None:
    """translate_db_message_to_packets_simple includes ArtifactGeneration
    when artifact_data is set on the ChatMessage."""
    chat_message = _make_chat_message(
        artifact_data={
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

    artifact_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, ArtifactGeneration)
    ]
    assert len(artifact_packets) == 1
    assert artifact_packets[0].obj.openui_lang == 'root = EmailDraft(["a@b.com"], [], "Hi", "Body")'
    assert artifact_packets[0].obj.title == "Email Draft"


def test_simple_translation_omits_artifact_when_absent() -> None:
    """translate_db_message_to_packets_simple does not include ArtifactGeneration
    when artifact_data is None."""
    chat_message = _make_chat_message(artifact_data=None)

    mock_session = MagicMock()

    from onyx.server.query_and_chat.streaming_utils import (
        translate_db_message_to_packets_simple,
    )

    result = translate_db_message_to_packets_simple(
        chat_message=chat_message,
        db_session=mock_session,
    )

    artifact_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, ArtifactGeneration)
    ]
    assert len(artifact_packets) == 0


# ---------------------------------------------------------------------------
# Tests for translate_db_message_to_packets (full path)
# ---------------------------------------------------------------------------

@patch("onyx.server.query_and_chat.streaming_utils.get_current_tenant_id")
@patch("onyx.server.query_and_chat.streaming_utils.get_default_feature_flag_provider")
def test_full_translation_emits_artifact_when_present(
    mock_ff_provider: MagicMock,
    mock_tenant: MagicMock,
) -> None:
    """translate_db_message_to_packets includes ArtifactGeneration when artifact_data is set."""
    # Force the non-simple path (research_type=None skips the feature flag check)
    chat_message = _make_chat_message(
        research_type=None,
        artifact_data={
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

    artifact_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, ArtifactGeneration)
    ]
    assert len(artifact_packets) == 1
    assert artifact_packets[0].obj.openui_lang == 'root = DataTable([["A","B"]], ["Col1","Col2"])'
    assert artifact_packets[0].obj.title == "Data Table"


@patch("onyx.server.query_and_chat.streaming_utils.get_current_tenant_id")
@patch("onyx.server.query_and_chat.streaming_utils.get_default_feature_flag_provider")
def test_full_translation_omits_artifact_when_absent(
    mock_ff_provider: MagicMock,
    mock_tenant: MagicMock,
) -> None:
    """translate_db_message_to_packets does not include ArtifactGeneration
    when artifact_data is None."""
    chat_message = _make_chat_message(
        research_type=None,
        artifact_data=None,
    )

    mock_session = MagicMock()

    from onyx.server.query_and_chat.streaming_utils import (
        translate_db_message_to_packets,
    )

    result = translate_db_message_to_packets(
        chat_message=chat_message,
        db_session=mock_session,
    )

    artifact_packets = [
        p for p in result.packet_list
        if isinstance(p, Packet) and isinstance(p.obj, ArtifactGeneration)
    ]
    assert len(artifact_packets) == 0


@patch("onyx.server.query_and_chat.streaming_utils.get_current_tenant_id")
@patch("onyx.server.query_and_chat.streaming_utils.get_default_feature_flag_provider")
def test_full_translation_artifact_before_overall_stop(
    mock_ff_provider: MagicMock,
    mock_tenant: MagicMock,
) -> None:
    """ArtifactGeneration packet appears before OverallStop in the full translation."""
    chat_message = _make_chat_message(
        research_type=None,
        artifact_data={
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
    assert "artifact_generation" in types
    assert "stop" in types
    artifact_idx = types.index("artifact_generation")
    stop_idx = types.index("stop")
    assert artifact_idx < stop_idx
