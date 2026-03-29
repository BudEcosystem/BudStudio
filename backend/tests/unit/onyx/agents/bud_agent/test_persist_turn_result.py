"""Unit tests for persist_turn_result().

Uses AST extraction to isolate the function from agent_context.py so we
avoid pulling in heavy transitive imports (redis, SQLAlchemy, agents SDK,
etc.).
"""

import ast
import pathlib
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# AST-extract persist_turn_result from the source file
# ---------------------------------------------------------------------------

_SOURCE_PATH = str(
    pathlib.Path(__file__).resolve().parents[5]
    / "onyx"
    / "agents"
    / "bud_agent"
    / "agent_context.py"
)

with open(_SOURCE_PATH) as _fh:
    _source = _fh.read()
    _tree = ast.parse(_source)

_func_node = None
for _node in ast.walk(_tree):
    if isinstance(_node, ast.FunctionDef) and _node.name == "persist_turn_result":
        _func_node = _node
        break

assert _func_node is not None, "persist_turn_result not found in agent_context.py"

# Build a minimal namespace with mock stubs for the DB helpers and enum
_add_session_message = MagicMock()
_update_session_stats = MagicMock()

_ns: dict = {
    "add_session_message": _add_session_message,
    "update_session_stats": _update_session_stats,
    "AgentMessageRole": type("AgentMessageRole", (), {"ASSISTANT": "assistant"}),
    # Type annotations referenced in the function signature
    "Session": Session,
    "UUID": UUID,
    "Any": Any,
}

exec(
    compile(ast.Module(body=[_func_node], type_ignores=[]), _SOURCE_PATH, "exec"),
    _ns,
)

persist_turn_result = _ns["persist_turn_result"]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_mocks() -> None:
    """Reset the shared mocks before every test."""
    _add_session_message.reset_mock()
    _update_session_stats.reset_mock()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_calls_add_session_message_with_correct_args() -> None:
    """When response_text is provided, add_session_message is called."""
    db = MagicMock()
    sid = uuid4()

    persist_turn_result(
        db_session=db,
        session_id=sid,
        response_text="Hello world",
        step_number=3,
    )

    _add_session_message.assert_called_once_with(
        db_session=db,
        session_id=sid,
        role="assistant",
        content="Hello world",
        step_number=3,
        thinking_content=None,
        ui_spec=None,
    )


def test_calls_update_session_stats_with_tool_call_count() -> None:
    """update_session_stats receives the correct tool_call_count."""
    db = MagicMock()
    sid = uuid4()

    persist_turn_result(
        db_session=db,
        session_id=sid,
        response_text="ok",
        tool_call_count=7,
    )

    _update_session_stats.assert_called_once_with(db, sid, tool_calls=7)


def test_skips_message_when_no_text_or_thinking() -> None:
    """When both response_text and thinking_content are None,
    add_session_message is NOT called but update_session_stats IS."""
    db = MagicMock()
    sid = uuid4()

    persist_turn_result(
        db_session=db,
        session_id=sid,
        response_text=None,
        thinking_content=None,
        tool_call_count=2,
    )

    _add_session_message.assert_not_called()
    _update_session_stats.assert_called_once_with(db, sid, tool_calls=2)


def test_ui_spec_passed_through() -> None:
    """The ui_spec dict is forwarded to add_session_message."""
    db = MagicMock()
    sid = uuid4()
    spec = {"type": "artifact", "artifact_id": "abc"}

    persist_turn_result(
        db_session=db,
        session_id=sid,
        response_text="done",
        ui_spec=spec,
    )

    call_kwargs = _add_session_message.call_args.kwargs
    assert call_kwargs["ui_spec"] == spec


def test_thinking_content_triggers_message() -> None:
    """When response_text is None but thinking_content is set,
    add_session_message IS called with empty content string."""
    db = MagicMock()
    sid = uuid4()

    persist_turn_result(
        db_session=db,
        session_id=sid,
        response_text=None,
        thinking_content="internal reasoning",
    )

    _add_session_message.assert_called_once()
    call_kwargs = _add_session_message.call_args.kwargs
    assert call_kwargs["content"] == ""
    assert call_kwargs["thinking_content"] == "internal reasoning"
