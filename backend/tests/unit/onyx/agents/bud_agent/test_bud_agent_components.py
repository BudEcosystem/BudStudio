"""Unit tests for BudAgent components."""

import json
import queue
from datetime import datetime
from datetime import timezone
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch
from uuid import uuid4

import pytest


# ==============================================================================
# Streaming Models Tests
# ==============================================================================


class TestStreamingModels:
    """Test streaming model serialization."""

    def test_bud_agent_thinking_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentThinking

        packet = BudAgentThinking()
        data = packet.model_dump()
        assert data["type"] == "bud_agent_thinking"

    def test_bud_agent_text_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentText

        packet = BudAgentText(content="Hello, world!")
        data = packet.model_dump()
        assert data["type"] == "bud_agent_text"
        assert data["content"] == "Hello, world!"

    def test_bud_agent_tool_start_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentToolStart

        packet = BudAgentToolStart(
            tool_name="read_file",
            tool_input={"path": "test.py"},
            tool_call_id="abc-123",
            is_local=True,
        )
        data = packet.model_dump()
        assert data["type"] == "bud_agent_tool_start"
        assert data["tool_name"] == "read_file"
        assert data["tool_input"] == {"path": "test.py"}
        assert data["tool_call_id"] == "abc-123"
        assert data["is_local"] is True

    def test_bud_agent_tool_result_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentToolResult

        packet = BudAgentToolResult(
            tool_name="read_file",
            tool_output="file content here",
            tool_error=None,
            tool_call_id="abc-123",
        )
        data = packet.model_dump()
        assert data["type"] == "bud_agent_tool_result"
        assert data["tool_output"] == "file content here"
        assert data["tool_error"] is None

    def test_bud_agent_local_tool_request_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentLocalToolRequest

        packet = BudAgentLocalToolRequest(
            tool_name="bash",
            tool_input={"command": "ls"},
            tool_call_id="def-456",
            requires_approval=True,
        )
        data = packet.model_dump()
        assert data["type"] == "bud_agent_local_tool_request"
        assert data["requires_approval"] is True

    def test_bud_agent_complete_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentComplete

        packet = BudAgentComplete(content="Done!")
        data = packet.model_dump()
        assert data["type"] == "bud_agent_complete"
        assert data["content"] == "Done!"

    def test_bud_agent_error_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentError

        packet = BudAgentError(error="Something went wrong")
        data = packet.model_dump()
        assert data["type"] == "bud_agent_error"
        assert data["error"] == "Something went wrong"

    def test_bud_agent_done_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentDone

        packet = BudAgentDone()
        data = packet.model_dump()
        assert data["type"] == "bud_agent_done"

    def test_bud_agent_stopped_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentStopped

        packet = BudAgentStopped()
        data = packet.model_dump()
        assert data["type"] == "bud_agent_stopped"

    def test_bud_agent_approval_required_serialization(self) -> None:
        from onyx.agents.bud_agent.streaming_models import BudAgentApprovalRequired

        packet = BudAgentApprovalRequired(
            tool_name="bash",
            tool_input={"command": "rm -rf /"},
            tool_call_id="xyz-789",
        )
        data = packet.model_dump()
        assert data["type"] == "bud_agent_approval_required"
        assert data["tool_name"] == "bash"
        assert data["tool_input"] == {"command": "rm -rf /"}
        assert data["tool_call_id"] == "xyz-789"


# ==============================================================================
# Tool Definitions Tests
# ==============================================================================


class TestToolDefinitions:
    """Test tool classification and schema functions."""

    def test_local_tool_classification(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import is_local_tool

        assert is_local_tool("read_file") is True
        assert is_local_tool("write_file") is True
        assert is_local_tool("edit_file") is True
        assert is_local_tool("bash") is True
        assert is_local_tool("glob") is True
        assert is_local_tool("grep") is True
        assert is_local_tool("onyx_search") is False
        assert is_local_tool("unknown_tool") is False

    def test_remote_tool_classification(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import is_remote_tool

        assert is_remote_tool("memory_store") is True
        assert is_remote_tool("memory_search") is True
        assert is_remote_tool("read_file") is False
        # Unknown tools are treated as remote (dynamic MCP/connector tools)
        assert is_remote_tool("unknown_tool") is True

    def test_remote_tool_schemas_complete(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS
        from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOLS

        for tool_name in REMOTE_TOOLS:
            assert tool_name in REMOTE_TOOL_SCHEMAS, f"Missing schema for {tool_name}"
            schema = REMOTE_TOOL_SCHEMAS[tool_name]
            assert "description" in schema
            assert "parameters" in schema
            assert schema["parameters"]["type"] == "object"

    def test_get_remote_tool_schema(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import get_remote_tool_schema

        schema = get_remote_tool_schema("memory_store")
        assert schema is not None
        assert schema["name"] == "memory_store"
        assert "content" in schema["parameters"]["properties"]

        schema = get_remote_tool_schema("memory_search")
        assert schema is not None
        assert "query" in schema["parameters"]["properties"]

        assert get_remote_tool_schema("nonexistent") is None

    def test_approval_required(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import requires_approval

        assert requires_approval("bash") is True
        assert requires_approval("write_file") is True
        assert requires_approval("edit_file") is True
        assert requires_approval("read_file") is False
        assert requires_approval("glob") is False
        assert requires_approval("onyx_search") is False

    def test_local_tool_schemas_complete(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOL_SCHEMAS
        from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOLS

        # Every local tool should have a schema
        for tool_name in LOCAL_TOOLS:
            assert tool_name in LOCAL_TOOL_SCHEMAS, f"Missing schema for {tool_name}"
            schema = LOCAL_TOOL_SCHEMAS[tool_name]
            assert "description" in schema
            assert "parameters" in schema
            assert schema["parameters"]["type"] == "object"

    def test_get_local_tool_schema(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import get_local_tool_schema

        schema = get_local_tool_schema("read_file")
        assert schema is not None
        assert schema["name"] == "read_file"
        assert "path" in schema["parameters"]["properties"]

        assert get_local_tool_schema("nonexistent") is None

    def test_local_and_remote_tools_disjoint(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOLS
        from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOLS

        overlap = LOCAL_TOOLS & REMOTE_TOOLS
        assert len(overlap) == 0, f"Tools in both LOCAL and REMOTE: {overlap}"

    def test_approval_tools_subset_of_local(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import APPROVAL_REQUIRED_TOOLS
        from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOLS

        assert APPROVAL_REQUIRED_TOOLS.issubset(LOCAL_TOOLS), (
            f"Approval tools not in LOCAL_TOOLS: "
            f"{APPROVAL_REQUIRED_TOOLS - LOCAL_TOOLS}"
        )


# ==============================================================================
# Memory Service Tests
# ==============================================================================


class TestMemoryService:
    """Test memory service functions with mocked DB."""

    def test_format_memories_for_prompt_empty(self) -> None:
        from onyx.agents.bud_agent.memory_service import format_memories_for_prompt

        result = format_memories_for_prompt([])
        assert result == ""

    def test_format_memories_for_prompt_with_memories(self) -> None:
        from onyx.agents.bud_agent.memory_service import format_memories_for_prompt
        from onyx.db.enums import AgentMemorySource

        mock_memory_1 = MagicMock()
        mock_memory_1.source = AgentMemorySource.SESSION
        mock_memory_1.content = "User prefers dark mode"

        mock_memory_2 = MagicMock()
        mock_memory_2.source = AgentMemorySource.USER_INPUT
        mock_memory_2.content = "Project uses Python 3.11"

        result = format_memories_for_prompt([mock_memory_1, mock_memory_2])
        assert "1. [session] User prefers dark mode" in result
        assert "2. [user_input] Project uses Python 3.11" in result

    def test_store_memory_empty_content_raises(self) -> None:
        from onyx.agents.bud_agent.memory_service import store_memory

        db_session = MagicMock()
        user_id = uuid4()

        with pytest.raises(ValueError, match="Memory content cannot be empty"):
            store_memory(db_session, user_id, "")

        with pytest.raises(ValueError, match="Memory content cannot be empty"):
            store_memory(db_session, user_id, "   ")

    def test_search_memories_empty_query(self) -> None:
        from onyx.agents.bud_agent.memory_service import search_memories

        db_session = MagicMock()
        user_id = uuid4()

        result = search_memories(db_session, user_id, "")
        assert result == []

        result = search_memories(db_session, user_id, "   ")
        assert result == []

    def test_format_memories_with_none_source(self) -> None:
        from onyx.agents.bud_agent.memory_service import format_memories_for_prompt

        mock_memory = MagicMock()
        mock_memory.source = None
        mock_memory.content = "Some memory"

        result = format_memories_for_prompt([mock_memory])
        assert "1. [unknown] Some memory" in result

    @patch("onyx.agents.bud_agent.memory_service.create_memory")
    def test_store_memory_calls_create_memory(
        self, mock_create: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.memory_service import store_memory
        from onyx.db.enums import AgentMemorySource

        db_session = MagicMock()
        user_id = uuid4()
        mock_create.return_value = MagicMock(id=uuid4())

        store_memory(db_session, user_id, "Test memory content")

        mock_create.assert_called_once_with(
            db_session=db_session,
            user_id=user_id,
            content="Test memory content",
            source=AgentMemorySource.SESSION,
            source_session_id=None,
        )

    @patch("onyx.agents.bud_agent.memory_service.search_memories_by_text")
    @patch("onyx.agents.bud_agent.memory_service.update_memory_access")
    def test_search_memories_updates_access_timestamps(
        self,
        mock_update_access: MagicMock,
        mock_search_by_text: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.memory_service import search_memories

        db_session = MagicMock()
        user_id = uuid4()

        mem1 = MagicMock()
        mem1.id = uuid4()
        mem2 = MagicMock()
        mem2.id = uuid4()
        mock_search_by_text.return_value = [mem1, mem2]

        result = search_memories(db_session, user_id, "test query")

        assert len(result) == 2
        assert mock_update_access.call_count == 2
        mock_update_access.assert_any_call(db_session, mem1.id)
        mock_update_access.assert_any_call(db_session, mem2.id)


# ==============================================================================
# Context Builder Tests
# ==============================================================================


class TestContextBuilder:
    """Test context builder with mocked dependencies."""

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_with_default_soul(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder()
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")

        # Default SOUL.md content should appear via system.md template
        assert "SOUL.md" in result
        assert "## Current Date & Time" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_with_custom_soul(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder(
            context_files={"SOUL.md": "I am a custom agent."}
        )
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "I am a custom agent." in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_with_user_md(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder(
            context_files={"USER.md": "I like concise responses."}
        )
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "I like concise responses." in result
        assert "### USER.md" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_with_workspace(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder(workspace_path="/home/user/project")
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "## Workspace" in result
        assert "/home/user/project" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_includes_memory_section(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = [MagicMock(), MagicMock()]
        mock_format.return_value = "1. Memory 1\n2. Memory 2"

        builder = BudAgentContextBuilder()
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "## Relevant Memories" in result
        assert "Memory 1" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_includes_safety(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder()
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "## Safety" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_includes_memory_recall_instructions(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder()
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "## Memory Recall" in result
        assert "memory_store" in result
        assert "memory_search" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_includes_tooling(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder()
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "## Tooling" in result
        assert "read_file" in result
        assert "bash" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_includes_workspace_files(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder(
            context_files={
                "AGENTS.md": "Custom workspace rules.",
                "SOUL.md": "Custom personality.",
            }
        )
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "### AGENTS.md" in result
        assert "Custom workspace rules." in result
        assert "### SOUL.md" in result
        assert "Custom personality." in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    def test_build_gracefully_handles_memory_failure(
        self,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.side_effect = Exception("DB connection failed")

        builder = BudAgentContextBuilder()
        db_session = MagicMock()
        user_id = uuid4()

        # Should not raise -- memory failures are caught gracefully
        result = builder.build(db_session, user_id, "hello")
        assert "## Current Date & Time" in result
        assert "## Safety" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_with_timezone(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder(user_timezone="America/New_York")
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        assert "America/New_York" in result

    @patch("onyx.agents.bud_agent.context_builder.search_memories")
    @patch("onyx.agents.bud_agent.context_builder.format_memories_for_prompt")
    def test_build_includes_workspace_tool_guidance(
        self,
        mock_format: MagicMock,
        mock_search: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder

        mock_search.return_value = []
        mock_format.return_value = ""

        builder = BudAgentContextBuilder()
        db_session = MagicMock()
        user_id = uuid4()

        result = builder.build(db_session, user_id, "hello")
        # The system.md template should include workspace tool guidance
        assert "workspace_read" in result
        assert "workspace_write" in result

    def test_truncate_content(self) -> None:
        from onyx.agents.bud_agent.context_builder import _truncate_content

        # Short content should not be truncated
        short = "Hello world"
        assert _truncate_content(short, max_chars=100) == short

        # Long content should be truncated with head + tail
        long_content = "x" * 1000
        result = _truncate_content(long_content, max_chars=100)
        assert len(result) < len(long_content)
        assert "truncated" in result


# ==============================================================================
# Memory Service Edge Cases
# ==============================================================================


class TestMemoryServiceEdgeCases:
    """Additional edge case tests for memory service."""

    @patch("onyx.agents.bud_agent.memory_service.create_memory")
    def test_store_memory_with_custom_source(
        self, mock_create: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.memory_service import store_memory
        from onyx.db.enums import AgentMemorySource

        db_session = MagicMock()
        user_id = uuid4()
        session_id = uuid4()
        mock_create.return_value = MagicMock(id=uuid4())

        store_memory(
            db_session,
            user_id,
            "Custom source memory",
            source=AgentMemorySource.USER_INPUT,
            source_session_id=session_id,
        )

        mock_create.assert_called_once_with(
            db_session=db_session,
            user_id=user_id,
            content="Custom source memory",
            source=AgentMemorySource.USER_INPUT,
            source_session_id=session_id,
        )

    @patch("onyx.agents.bud_agent.memory_service.get_memories_for_user")
    def test_get_recent_memories_delegates(
        self, mock_get: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.memory_service import get_recent_memories

        db_session = MagicMock()
        user_id = uuid4()
        mock_get.return_value = [MagicMock(), MagicMock()]

        result = get_recent_memories(db_session, user_id, limit=3)

        assert len(result) == 2
        mock_get.assert_called_once_with(
            db_session=db_session,
            user_id=user_id,
            limit=3,
        )

    @patch("onyx.agents.bud_agent.memory_service.delete_memory")
    def test_remove_memory_delegates(
        self, mock_delete: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.memory_service import remove_memory

        db_session = MagicMock()
        memory_id = uuid4()
        user_id = uuid4()
        mock_delete.return_value = True

        result = remove_memory(db_session, memory_id, user_id)

        assert result is True
        mock_delete.assert_called_once_with(
            db_session=db_session,
            memory_id=memory_id,
            user_id=user_id,
        )

    @patch("onyx.agents.bud_agent.memory_service.delete_memory")
    def test_remove_memory_not_found(
        self, mock_delete: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.memory_service import remove_memory

        db_session = MagicMock()
        mock_delete.return_value = False

        result = remove_memory(db_session, uuid4(), uuid4())
        assert result is False


# ==============================================================================
# Vespa Memory Operations Tests
# ==============================================================================


class TestVespaMemorySearch:
    """Test vespa_memory module YQL building and response parsing."""

    def test_search_builds_correct_yql(self) -> None:
        """Verify the YQL query includes user_id filter and nearestNeighbor."""
        from unittest.mock import MagicMock as Mock

        from onyx.agents.bud_agent.vespa_memory import search_memories_vespa

        user_id = uuid4()
        mock_response = Mock()
        mock_response.json.return_value = {"root": {"children": []}}
        mock_response.raise_for_status = Mock()

        mock_client = Mock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = Mock(return_value=mock_client)
        mock_client.__exit__ = Mock(return_value=False)

        with patch(
            "onyx.agents.bud_agent.vespa_memory.get_vespa_http_client",
            return_value=mock_client,
        ):
            search_memories_vespa(
                query_text="test query",
                query_embedding=[0.1] * 768,
                user_id=user_id,
                limit=5,
            )

        # Verify POST was called
        mock_client.post.assert_called_once()
        call_kwargs = mock_client.post.call_args
        params = call_kwargs[1]["json"] if "json" in call_kwargs[1] else call_kwargs[0][1]

        yql = params["yql"]
        assert str(user_id) in yql
        assert "nearestNeighbor" in yql
        assert "agent_memory" in yql
        assert params["ranking.profile"] == "hybrid_memory_search"

    def test_search_filters_low_score_results(self) -> None:
        """Results below minimum relevance should be excluded."""
        from onyx.agents.bud_agent.vespa_memory import search_memories_vespa

        good_id = uuid4()
        bad_id = uuid4()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "root": {
                "children": [
                    {
                        "relevance": 0.8,
                        "fields": {"memory_id": str(good_id)},
                    },
                    {
                        "relevance": 0.1,  # below 0.35 threshold
                        "fields": {"memory_id": str(bad_id)},
                    },
                ]
            }
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        with patch(
            "onyx.agents.bud_agent.vespa_memory.get_vespa_http_client",
            return_value=mock_client,
        ):
            results = search_memories_vespa(
                query_text="test",
                query_embedding=[0.1] * 768,
                user_id=uuid4(),
                limit=10,
            )

        assert len(results) == 1
        assert results[0][0] == good_id
        assert results[0][1] == 0.8

    def test_search_returns_empty_for_no_hits(self) -> None:
        from onyx.agents.bud_agent.vespa_memory import search_memories_vespa

        mock_response = MagicMock()
        mock_response.json.return_value = {"root": {}}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        with patch(
            "onyx.agents.bud_agent.vespa_memory.get_vespa_http_client",
            return_value=mock_client,
        ):
            results = search_memories_vespa(
                query_text="nothing",
                query_embedding=[0.0] * 768,
                user_id=uuid4(),
            )

        assert results == []

    def test_search_skips_invalid_memory_ids(self) -> None:
        from onyx.agents.bud_agent.vespa_memory import search_memories_vespa

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "root": {
                "children": [
                    {
                        "relevance": 0.9,
                        "fields": {"memory_id": "not-a-uuid"},
                    },
                ]
            }
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        with patch(
            "onyx.agents.bud_agent.vespa_memory.get_vespa_http_client",
            return_value=mock_client,
        ):
            results = search_memories_vespa(
                query_text="test",
                query_embedding=[0.1] * 768,
                user_id=uuid4(),
            )

        assert results == []


class TestVespaMemoryIndex:
    """Test vespa_memory index and delete operations."""

    def test_index_memory_sends_correct_fields(self) -> None:
        from onyx.agents.bud_agent.vespa_memory import index_memory_to_vespa

        memory_id = uuid4()
        user_id = uuid4()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        with patch(
            "onyx.agents.bud_agent.vespa_memory.get_vespa_http_client",
            return_value=mock_client,
        ):
            index_memory_to_vespa(
                memory_id=memory_id,
                content="Test memory content",
                user_id=user_id,
                embedding=[0.5, 0.3, 0.1],
                created_at=1700000000,
            )

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        body = call_args[1]["json"]
        fields = body["fields"]

        assert fields["memory_id"] == str(memory_id)
        assert fields["user_id"] == str(user_id)
        assert fields["content"] == "Test memory content"
        assert fields["embedding"] == {"values": [0.5, 0.3, 0.1]}
        assert fields["created_at"] == 1700000000

    def test_delete_memory_calls_vespa(self) -> None:
        from onyx.agents.bud_agent.vespa_memory import delete_memory_from_vespa

        memory_id = uuid4()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.delete.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)

        with patch(
            "onyx.agents.bud_agent.vespa_memory.get_vespa_http_client",
            return_value=mock_client,
        ):
            delete_memory_from_vespa(memory_id)

        mock_client.delete.assert_called_once()
        url = mock_client.delete.call_args[0][0]
        assert str(memory_id) in url


class TestMemoryServiceVespaIntegration:
    """Test memory_service functions with Vespa integration (mocked)."""

    @patch("onyx.agents.bud_agent.memory_service.index_memory_to_vespa")
    @patch("onyx.agents.bud_agent.memory_service._get_embedding")
    @patch("onyx.agents.bud_agent.memory_service.create_memory")
    def test_store_memory_indexes_to_vespa(
        self,
        mock_create: MagicMock,
        mock_embedding: MagicMock,
        mock_vespa_index: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.memory_service import store_memory

        db_session = MagicMock()
        user_id = uuid4()

        mock_memory = MagicMock()
        mock_memory.id = uuid4()
        mock_memory.created_at = MagicMock()
        mock_memory.created_at.timestamp.return_value = 1700000000.0
        mock_create.return_value = mock_memory

        mock_embedding.return_value = [0.1, 0.2, 0.3]

        store_memory(db_session, user_id, "Test memory")

        mock_vespa_index.assert_called_once()
        call_kwargs = mock_vespa_index.call_args[1]
        assert call_kwargs["memory_id"] == mock_memory.id
        assert call_kwargs["content"] == "Test memory"
        assert call_kwargs["user_id"] == user_id

    @patch("onyx.agents.bud_agent.memory_service.index_memory_to_vespa")
    @patch("onyx.agents.bud_agent.memory_service._get_embedding")
    @patch("onyx.agents.bud_agent.memory_service.create_memory")
    def test_store_memory_succeeds_when_vespa_fails(
        self,
        mock_create: MagicMock,
        mock_embedding: MagicMock,
        mock_vespa_index: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.memory_service import store_memory

        db_session = MagicMock()
        user_id = uuid4()

        mock_memory = MagicMock()
        mock_memory.id = uuid4()
        mock_memory.created_at = MagicMock()
        mock_memory.created_at.timestamp.return_value = 1700000000.0
        mock_create.return_value = mock_memory

        mock_embedding.return_value = [0.1, 0.2]
        mock_vespa_index.side_effect = Exception("Vespa unavailable")

        # Should not raise — Vespa failure is best-effort
        result = store_memory(db_session, user_id, "Test memory")
        assert result == mock_memory

    @patch("onyx.agents.bud_agent.memory_service.update_memory_access")
    @patch("onyx.agents.bud_agent.memory_service.search_memories_by_text")
    @patch("onyx.agents.bud_agent.memory_service.search_memories_vespa")
    @patch("onyx.agents.bud_agent.memory_service._get_embedding")
    def test_search_falls_back_to_pg_on_vespa_failure(
        self,
        mock_embedding: MagicMock,
        mock_vespa_search: MagicMock,
        mock_pg_search: MagicMock,
        mock_update_access: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.memory_service import search_memories

        db_session = MagicMock()
        user_id = uuid4()

        mock_embedding.return_value = [0.1, 0.2]
        mock_vespa_search.side_effect = Exception("Vespa down")

        mock_mem = MagicMock()
        mock_mem.id = uuid4()
        mock_pg_search.return_value = [mock_mem]

        results = search_memories(db_session, user_id, "test query")

        assert len(results) == 1
        mock_pg_search.assert_called_once()

    @patch("onyx.agents.bud_agent.memory_service.delete_memory_from_vespa")
    @patch("onyx.agents.bud_agent.memory_service.delete_memory")
    def test_remove_memory_also_deletes_from_vespa(
        self,
        mock_pg_delete: MagicMock,
        mock_vespa_delete: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.memory_service import remove_memory

        db_session = MagicMock()
        memory_id = uuid4()
        user_id = uuid4()
        mock_pg_delete.return_value = True

        result = remove_memory(db_session, memory_id, user_id)

        assert result is True
        mock_vespa_delete.assert_called_once_with(memory_id)

    @patch("onyx.agents.bud_agent.memory_service.delete_memory_from_vespa")
    @patch("onyx.agents.bud_agent.memory_service.delete_memory")
    def test_remove_memory_skips_vespa_when_pg_not_found(
        self,
        mock_pg_delete: MagicMock,
        mock_vespa_delete: MagicMock,
    ) -> None:
        from onyx.agents.bud_agent.memory_service import remove_memory

        db_session = MagicMock()
        mock_pg_delete.return_value = False

        result = remove_memory(db_session, uuid4(), uuid4())

        assert result is False
        mock_vespa_delete.assert_not_called()


# ==============================================================================
# Prompt Template Loader Tests
# ==============================================================================


EXPECTED_TEMPLATE_FILES = [
    "soul",
    "agents",
    "identity",
    "user",
    "system",
]


class TestPromptTemplateLoader:
    """Test the prompts package loader and template rendering."""

    def test_all_expected_template_files_exist(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt

        for name in EXPECTED_TEMPLATE_FILES:
            content = load_prompt(name)
            assert len(content) > 0, f"Template '{name}.md' is empty"

    def test_load_prompt_returns_string(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt

        result = load_prompt("soul")
        assert isinstance(result, str)
        assert "SOUL.md" in result

    def test_load_prompt_nonexistent_raises(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt

        with pytest.raises(FileNotFoundError):
            load_prompt("nonexistent_template_xyz")

    def test_render_prompt_substitutes_variables(self) -> None:
        from onyx.agents.bud_agent.prompts import render_prompt

        result = render_prompt(
            "system",
            timezone="UTC",
            date_time="2025-01-15 10:30:00 UTC",
            agents_content="Test agents",
            soul_content="Test soul",
            identity_content="Test identity",
            user_content="Test user",
            tools_content="Test tools",
            memory_md_content="Test long-term memory",
            heartbeat_content="Test heartbeat",
            memories="1. User likes Python",
            workspace_info="",
        )
        assert "1. User likes Python" in result
        assert "$memories" not in result
        assert "2025-01-15 10:30:00 UTC" in result
        assert "$date_time" not in result

    def test_render_prompt_safe_substitute_leaves_stray_dollars(self) -> None:
        from onyx.agents.bud_agent.prompts import render_prompt

        # Templates without the given var should leave $placeholders intact
        result = render_prompt("soul")
        # soul.md has no template variables so it should just return content as-is
        assert "SOUL.md" in result

    def test_load_prompt_caching(self) -> None:
        from onyx.agents.bud_agent.prompts import load_prompt

        # Calling twice should return the same object (cached)
        result1 = load_prompt("soul")
        result2 = load_prompt("soul")
        assert result1 is result2


# ==============================================================================
# Workspace Service Tests
# ==============================================================================


class TestWorkspaceService:
    """Test workspace service functions with mocked DB."""

    @patch("onyx.agents.bud_agent.workspace_service.upsert_workspace_file")
    def test_write_workspace_file(
        self, mock_upsert: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.workspace_service import write_workspace_file

        db_session = MagicMock()
        user_id = uuid4()
        mock_file = MagicMock()
        mock_file.path = "SOUL.md"
        mock_file.content = "I am Bud."
        mock_upsert.return_value = mock_file

        result = write_workspace_file(db_session, user_id, "SOUL.md", "I am Bud.")

        mock_upsert.assert_called_once_with(
            db_session=db_session,
            user_id=user_id,
            path="SOUL.md",
            content="I am Bud.",
        )
        assert result.path == "SOUL.md"

    @patch("onyx.agents.bud_agent.workspace_service.get_workspace_file")
    def test_read_workspace_file_not_found(
        self, mock_get: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.workspace_service import read_workspace_file

        db_session = MagicMock()
        user_id = uuid4()
        mock_get.return_value = None

        result = read_workspace_file(db_session, user_id, "NONEXISTENT.md")

        assert result is None

    @patch("onyx.agents.bud_agent.workspace_service.get_workspace_file")
    def test_read_workspace_file_exists(
        self, mock_get: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.workspace_service import read_workspace_file

        db_session = MagicMock()
        user_id = uuid4()
        mock_file = MagicMock()
        mock_file.content = "Hello, I am your workspace file."
        mock_get.return_value = mock_file

        result = read_workspace_file(db_session, user_id, "SOUL.md")

        assert result == "Hello, I am your workspace file."

    @patch("onyx.agents.bud_agent.workspace_service.list_workspace_files")
    def test_list_workspace_files_with_prefix(
        self, mock_list: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.workspace_service import list_user_workspace_files

        db_session = MagicMock()
        user_id = uuid4()

        mock_file1 = MagicMock()
        mock_file1.path = "memory/2025-06-15.md"
        mock_file2 = MagicMock()
        mock_file2.path = "memory/2025-06-16.md"
        mock_list.return_value = [mock_file1, mock_file2]

        result = list_user_workspace_files(db_session, user_id, prefix="memory/")

        mock_list.assert_called_once_with(
            db_session=db_session,
            user_id=user_id,
            prefix="memory/",
        )
        assert len(result) == 2

    @patch("onyx.agents.bud_agent.workspace_service.delete_workspace_file")
    def test_remove_workspace_file(
        self, mock_delete: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.workspace_service import remove_workspace_file

        db_session = MagicMock()
        user_id = uuid4()
        mock_delete.return_value = True

        result = remove_workspace_file(db_session, user_id, "SOUL.md")

        assert result is True
        mock_delete.assert_called_once_with(
            db_session=db_session,
            user_id=user_id,
            path="SOUL.md",
        )

    @patch("onyx.agents.bud_agent.workspace_service.delete_workspace_file")
    def test_remove_workspace_file_not_found(
        self, mock_delete: MagicMock
    ) -> None:
        from onyx.agents.bud_agent.workspace_service import remove_workspace_file

        db_session = MagicMock()
        mock_delete.return_value = False

        result = remove_workspace_file(db_session, uuid4(), "MISSING.md")
        assert result is False

    def test_workspace_tools_count(self) -> None:
        from onyx.agents.bud_agent.workspace_service import create_workspace_tools

        db_session = MagicMock()
        user_id = uuid4()

        tools = create_workspace_tools(db_session, user_id)
        assert len(tools) == 3

    def test_workspace_tools_names(self) -> None:
        from onyx.agents.bud_agent.workspace_service import create_workspace_tools

        db_session = MagicMock()
        user_id = uuid4()

        tools = create_workspace_tools(db_session, user_id)
        tool_names = {tool.name for tool in tools}
        assert tool_names == {"workspace_read", "workspace_write", "workspace_list"}

    def test_workspace_tools_in_remote_tools_set(self) -> None:
        from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOLS

        workspace_tools = {"workspace_read", "workspace_write", "workspace_list"}
        assert workspace_tools.issubset(REMOTE_TOOLS)


# ==============================================================================
# Connector / MCP Service SectionEnd Emission Tests
# ==============================================================================


class TestConnectorServiceSectionEnd:
    """Verify that connector tool handlers emit SectionEnd after CustomToolDelta."""

    @pytest.mark.asyncio
    async def test_connector_handler_emits_section_end_on_success(self) -> None:
        from onyx.agents.bud_agent.connector_service import _make_invoke_handler
        from onyx.db.enums import AgentToolPermissionLevel
        from onyx.server.query_and_chat.streaming_models import (
            CustomToolDelta,
            CustomToolStart,
            SectionEnd,
        )

        pq: queue.Queue[Any] = queue.Queue()

        handler = _make_invoke_handler(
            tool_name="test_tool",
            mcp_url="http://fake",
            headers={"Authorization": "Bearer x"},
            permission_level=AgentToolPermissionLevel.ALWAYS_ALLOW,
            session_id="sess-1",
            packet_queue=pq,
            step_number_fn=lambda: 5,
        )

        with patch(
            "onyx.agents.bud_agent.connector_service.call_mcp_tool",
            return_value="result_data",
        ):
            ctx = MagicMock()
            result = await handler(ctx, '{"query": "test"}')

        assert result == "result_data"

        packets = []
        while not pq.empty():
            packets.append(pq.get_nowait())

        assert len(packets) == 3
        assert isinstance(packets[0].obj, CustomToolStart)
        assert packets[0].obj.tool_name == "test_tool"
        assert isinstance(packets[1].obj, CustomToolDelta)
        assert isinstance(packets[2].obj, SectionEnd)

    @pytest.mark.asyncio
    async def test_connector_handler_emits_section_end_on_error(self) -> None:
        from onyx.agents.bud_agent.connector_service import _make_invoke_handler
        from onyx.db.enums import AgentToolPermissionLevel
        from onyx.server.query_and_chat.streaming_models import (
            CustomToolDelta,
            CustomToolStart,
            SectionEnd,
        )

        pq: queue.Queue[Any] = queue.Queue()

        handler = _make_invoke_handler(
            tool_name="fail_tool",
            mcp_url="http://fake",
            headers={},
            permission_level=AgentToolPermissionLevel.ALWAYS_ALLOW,
            session_id="sess-1",
            packet_queue=pq,
            step_number_fn=lambda: 2,
        )

        with patch(
            "onyx.agents.bud_agent.connector_service.call_mcp_tool",
            side_effect=RuntimeError("connection refused"),
        ):
            ctx = MagicMock()
            result = await handler(ctx, "{}")

        assert "connection refused" in result

        packets = []
        while not pq.empty():
            packets.append(pq.get_nowait())

        assert len(packets) == 3
        assert isinstance(packets[0].obj, CustomToolStart)
        assert isinstance(packets[1].obj, CustomToolDelta)
        assert packets[1].obj.response_type == "error"
        assert isinstance(packets[2].obj, SectionEnd)


class TestMcpServiceSectionEnd:
    """Verify that MCP service handlers emit SectionEnd after CustomToolDelta."""

    @pytest.mark.asyncio
    async def test_mcp_handler_emits_section_end_on_success(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _make_invoke_handler
        from onyx.server.query_and_chat.streaming_models import (
            CustomToolDelta,
            CustomToolStart,
            SectionEnd,
        )

        pq: queue.Queue[Any] = queue.Queue()

        handler = _make_invoke_handler(
            tool_name="mcp_tool",
            server_url="http://fake-mcp",
            packet_queue=pq,
            step_number_fn=lambda: 3,
        )

        with patch(
            "onyx.agents.bud_agent.mcp_service.call_mcp_tool",
            return_value="mcp_result",
        ):
            ctx = MagicMock()
            result = await handler(ctx, '{"arg": "val"}')

        assert result == "mcp_result"

        packets = []
        while not pq.empty():
            packets.append(pq.get_nowait())

        assert len(packets) == 3
        assert isinstance(packets[0].obj, CustomToolStart)
        assert packets[0].obj.tool_name == "mcp_tool"
        assert isinstance(packets[1].obj, CustomToolDelta)
        assert isinstance(packets[2].obj, SectionEnd)

    @pytest.mark.asyncio
    async def test_mcp_handler_emits_section_end_on_error(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _make_invoke_handler
        from onyx.server.query_and_chat.streaming_models import (
            CustomToolDelta,
            CustomToolStart,
            SectionEnd,
        )

        pq: queue.Queue[Any] = queue.Queue()

        handler = _make_invoke_handler(
            tool_name="mcp_fail",
            server_url="http://fake-mcp",
            packet_queue=pq,
            step_number_fn=lambda: 1,
        )

        with patch(
            "onyx.agents.bud_agent.mcp_service.call_mcp_tool",
            side_effect=ConnectionError("timeout"),
        ):
            ctx = MagicMock()
            result = await handler(ctx, "{}")

        assert "timeout" in result

        packets = []
        while not pq.empty():
            packets.append(pq.get_nowait())

        assert len(packets) == 3
        assert isinstance(packets[0].obj, CustomToolStart)
        assert isinstance(packets[1].obj, CustomToolDelta)
        assert packets[1].obj.response_type == "error"
        assert isinstance(packets[2].obj, SectionEnd)


# ==============================================================================
# MCP Schema Sanitization Tests
# ==============================================================================


class TestSanitizeSchema:
    """Test the _sanitize_schema function from mcp_service."""

    def test_adds_items_to_array_without_items(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        schema: dict[str, Any] = {"type": "array"}
        result = _sanitize_schema(schema)
        assert result["items"] == {}

    def test_preserves_existing_items(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        schema: dict[str, Any] = {"type": "array", "items": {"type": "string"}}
        result = _sanitize_schema(schema)
        assert result["items"] == {"type": "string"}

    def test_non_array_type_unchanged(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        schema: dict[str, Any] = {"type": "object", "properties": {}}
        result = _sanitize_schema(schema)
        assert "items" not in result

    def test_nested_array_in_properties(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "subtasks": {"type": "array"},
            },
        }
        result = _sanitize_schema(schema)
        assert result["properties"]["subtasks"]["items"] == {}

    def test_deeply_nested_array(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "outer": {
                    "type": "object",
                    "properties": {
                        "inner_list": {"type": "array"},
                    },
                },
            },
        }
        result = _sanitize_schema(schema)
        assert result["properties"]["outer"]["properties"]["inner_list"]["items"] == {}

    def test_array_inside_allof(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        schema: dict[str, Any] = {
            "allOf": [
                {"type": "array"},
            ],
        }
        result = _sanitize_schema(schema)
        assert result["allOf"][0]["items"] == {}

    def test_non_dict_schema_returned_as_is(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        result = _sanitize_schema("not a dict")  # type: ignore[arg-type]
        assert result == "not a dict"

    def test_empty_dict_unchanged(self) -> None:
        from onyx.agents.bud_agent.mcp_service import _sanitize_schema

        result = _sanitize_schema({})
        assert result == {}


# ==============================================================================
# Skill System Tests
# ==============================================================================


class TestSkillParsing:
    """Test the skill markdown parsing from skills/__init__.py."""

    def test_parse_valid_skill(self) -> None:
        from onyx.agents.bud_agent.skills import parse_skill_md

        md = (
            "---\n"
            "slug: test_skill\n"
            "name: Test Skill\n"
            "description: A test skill.\n"
            "requires_tools:\n"
            "  - bash\n"
            "modes:\n"
            "  - interactive\n"
            "enabled: true\n"
            "---\n"
            "Do the thing step by step."
        )
        skill = parse_skill_md(md)
        assert skill is not None
        assert skill.slug == "test_skill"
        assert skill.name == "Test Skill"
        assert skill.description == "A test skill."
        assert skill.instructions == "Do the thing step by step."
        assert skill.requires_tools == ["bash"]
        assert skill.modes == ["interactive"]
        assert skill.enabled is True

    def test_parse_missing_frontmatter(self) -> None:
        from onyx.agents.bud_agent.skills import parse_skill_md

        result = parse_skill_md("No frontmatter here")
        assert result is None

    def test_parse_missing_closing_delimiter(self) -> None:
        from onyx.agents.bud_agent.skills import parse_skill_md

        result = parse_skill_md("---\nslug: x\nname: X\n")
        assert result is None

    def test_parse_missing_required_fields(self) -> None:
        from onyx.agents.bud_agent.skills import parse_skill_md

        md = "---\nslug: x\n---\nBody"
        result = parse_skill_md(md)
        assert result is None

    def test_parse_empty_body(self) -> None:
        from onyx.agents.bud_agent.skills import parse_skill_md

        md = "---\nslug: x\nname: X\ndescription: Desc\n---\n"
        result = parse_skill_md(md)
        assert result is None

    def test_parse_string_requires_tools(self) -> None:
        from onyx.agents.bud_agent.skills import parse_skill_md

        md = (
            "---\n"
            "slug: s\nname: S\ndescription: D\n"
            "requires_tools: bash\n"
            "---\n"
            "Instructions"
        )
        skill = parse_skill_md(md)
        assert skill is not None
        assert skill.requires_tools == ["bash"]


class TestSkillCatalog:
    """Test skill catalog formatting."""

    def test_format_empty_catalog(self) -> None:
        from onyx.agents.bud_agent.skills import format_skill_catalog

        assert format_skill_catalog([]) == ""

    def test_format_catalog_with_skills(self) -> None:
        from onyx.agents.bud_agent.skills import format_skill_catalog
        from onyx.agents.bud_agent.skills import SkillDefinition

        skills = [
            SkillDefinition(
                slug="planner",
                name="Planner",
                description="Break down goals.",
                instructions="Step 1: plan things.",
            ),
        ]
        result = format_skill_catalog(skills)
        assert "## Available Skills" in result
        assert "planner" in result
        assert "Break down goals." in result


class TestGetActiveSkills:
    """Test skill resolution logic."""

    def test_builtin_skill_loads(self) -> None:
        from onyx.agents.bud_agent.skills import get_active_skills

        # planner requires taskgraph tools — provide them
        available = {
            "taskgraph_project_create",
            "taskgraph_task_create",
        }
        skills = get_active_skills(
            db_session=None,
            available_tools=available,
            mode="interactive",
        )
        slugs = [s.slug for s in skills]
        assert "planner" in slugs

    def test_skill_filtered_by_missing_tool(self) -> None:
        from onyx.agents.bud_agent.skills import get_active_skills

        # Don't provide required tools
        skills = get_active_skills(
            db_session=None,
            available_tools=set(),
            mode="interactive",
        )
        slugs = [s.slug for s in skills]
        assert "planner" not in slugs

    def test_skill_filtered_by_mode(self) -> None:
        from onyx.agents.bud_agent.skills import get_active_skills

        # Provide required tools but wrong mode
        available = {
            "taskgraph_project_create",
            "taskgraph_task_create",
        }
        skills = get_active_skills(
            db_session=None,
            available_tools=available,
            mode="cron",
        )
        slugs = [s.slug for s in skills]
        # planner has modes: [interactive], so shouldn't be in cron
        assert "planner" not in slugs


class TestCreateSkillTools:
    """Test the create_skill_tools function."""

    def test_returns_empty_when_no_skills(self) -> None:
        from onyx.agents.bud_agent.skill_service import create_skill_tools

        tools, catalog = create_skill_tools(
            db_session=None,
            available_tools=set(),
            mode="cron",
        )
        assert tools == []
        assert catalog == ""

    def test_returns_use_skill_tool_when_skills_available(self) -> None:
        from onyx.agents.bud_agent.skill_service import create_skill_tools

        available = {
            "taskgraph_project_create",
            "taskgraph_task_create",
        }
        tools, catalog = create_skill_tools(
            db_session=None,
            available_tools=available,
            mode="interactive",
        )
        assert len(tools) == 1
        assert tools[0].name == "use_skill"
        assert "planner" in catalog
