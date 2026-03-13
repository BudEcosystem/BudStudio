"""Unit tests for ask_user_tool — ask_user_questions FunctionTool."""

import asyncio
import json
from queue import Queue
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import redis

from onyx.agents.bud_agent.ask_user_tool import TOOL_NAME
from onyx.agents.bud_agent.ask_user_tool import create_ask_user_tool
from onyx.server.query_and_chat.streaming_models import AgentUserQuestions
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd


TEST_SESSION_ID = UUID("00000000-0000-0000-0000-000000000001")


def _make_redis_mock(answers: list[dict[str, str]] | None = None) -> MagicMock:
    """Create a Redis mock that returns the given answers from BLPOP."""
    redis_mock = MagicMock()
    if answers is not None:
        payload = json.dumps(
            {"output": json.dumps(answers), "tool_call_id": "ignored"}
        )
        redis_mock.blpop.return_value = (b"key", payload.encode())
    else:
        redis_mock.blpop.return_value = None  # timeout
    return redis_mock


def _run_tool(
    args: dict[str, Any],
    redis_mock: MagicMock | None = None,
) -> tuple[str, list[Packet]]:
    """Invoke the ask_user_questions tool and collect emitted packets."""
    packet_queue: Queue[Any] = Queue()
    step_fn = MagicMock(return_value=0)

    if redis_mock is None:
        redis_mock = _make_redis_mock([{"question": "Q?", "answer": "A"}])

    tools = create_ask_user_tool(
        session_id=TEST_SESSION_ID,
        packet_queue=packet_queue,
        step_number_fn=step_fn,
        db_session=None,
        redis_client=redis_mock,
    )
    assert len(tools) == 1
    tool = tools[0]
    assert tool.name == TOOL_NAME

    ctx = MagicMock()
    result: str = asyncio.get_event_loop().run_until_complete(
        tool.on_invoke_tool(ctx, json.dumps(args))
    )

    packets: list[Packet] = []
    while not packet_queue.empty():
        packets.append(packet_queue.get_nowait())
    return result, packets


class TestAskUserToolCreation:
    def test_creates_single_tool(self) -> None:
        tools = create_ask_user_tool(
            session_id=TEST_SESSION_ID,
            packet_queue=Queue(),
        )
        assert len(tools) == 1
        assert tools[0].name == "ask_user_questions"


class TestAskUserToolSuccess:
    def test_single_question_with_answer(self) -> None:
        answers = [{"question": "Color?", "answer": "Blue"}]
        redis_mock = _make_redis_mock(answers)

        args = {
            "questions": [
                {"question": "Color?", "options": ["Red", "Blue", "Green"]},
            ],
        }
        result, packets = _run_tool(args, redis_mock)

        # Check result text
        assert "User answered:" in result
        assert 'Q: Color? → "Blue"' in result

        # Check packet sequence: CustomToolStart → AgentUserQuestions →
        # CustomToolDelta (result) → SectionEnd
        assert len(packets) == 4
        assert isinstance(packets[0].obj, CustomToolStart)
        assert packets[0].obj.tool_name == TOOL_NAME

        assert isinstance(packets[1].obj, AgentUserQuestions)
        assert len(packets[1].obj.questions) == 1
        assert packets[1].obj.questions[0].question == "Color?"
        assert packets[1].obj.questions[0].options == ["Red", "Blue", "Green"]
        assert packets[1].obj.tool_call_id  # non-empty

        assert isinstance(packets[2].obj, CustomToolDelta)
        assert isinstance(packets[3].obj, SectionEnd)

        # Redis BLPOP was called and key was deleted
        redis_mock.blpop.assert_called_once()
        redis_mock.delete.assert_called_once()

    def test_multiple_questions(self) -> None:
        answers = [
            {"question": "Style?", "answer": "Modern"},
            {"question": "Language?", "answer": "Python"},
        ]
        redis_mock = _make_redis_mock(answers)

        args = {
            "questions": [
                {"question": "Style?", "options": ["Modern", "Classic"]},
                {"question": "Language?", "options": ["Python", "Go"]},
            ],
        }
        result, packets = _run_tool(args, redis_mock)

        assert 'Q: Style? → "Modern"' in result
        assert 'Q: Language? → "Python"' in result

        # AgentUserQuestions should contain both questions
        q_packet = packets[1].obj
        assert isinstance(q_packet, AgentUserQuestions)
        assert len(q_packet.questions) == 2

    def test_skipped_questions(self) -> None:
        answers = [{"question": "Color?", "answer": "skipped"}]
        redis_mock = _make_redis_mock(answers)

        args = {
            "questions": [
                {"question": "Color?", "options": ["Red", "Blue"]},
            ],
        }
        result, _ = _run_tool(args, redis_mock)
        assert 'Q: Color? → "skipped"' in result


class TestAskUserToolTimeout:
    def test_timeout_returns_message(self) -> None:
        redis_mock = _make_redis_mock(None)  # None means timeout

        args = {
            "questions": [
                {"question": "Color?", "options": ["Red", "Blue"]},
            ],
        }
        result, packets = _run_tool(args, redis_mock)

        assert "did not respond" in result

        # Packets: CustomToolStart → AgentUserQuestions → CustomToolDelta (timeout) → SectionEnd
        assert len(packets) == 4
        assert isinstance(packets[2].obj, CustomToolDelta)
        assert isinstance(packets[3].obj, SectionEnd)


class TestAskUserToolErrors:
    def test_invalid_json_returns_error(self) -> None:
        packet_queue: Queue[Any] = Queue()
        tools = create_ask_user_tool(
            session_id=TEST_SESSION_ID,
            packet_queue=packet_queue,
        )
        ctx = MagicMock()
        result: str = asyncio.get_event_loop().run_until_complete(
            tools[0].on_invoke_tool(ctx, "not json{{{")
        )
        assert "invalid JSON" in result

    def test_no_questions_returns_error(self) -> None:
        redis_mock = _make_redis_mock([])
        args: dict[str, Any] = {"questions": []}
        result, packets = _run_tool(args, redis_mock)
        assert "no questions" in result
        # No packets emitted for empty questions
        assert len(packets) == 0

    def test_no_redis_returns_error(self) -> None:
        packet_queue: Queue[Any] = Queue()
        step_fn = MagicMock(return_value=0)

        tools = create_ask_user_tool(
            session_id=TEST_SESSION_ID,
            packet_queue=packet_queue,
            step_number_fn=step_fn,
            db_session=None,
            redis_client=None,
        )
        ctx = MagicMock()
        result: str = asyncio.get_event_loop().run_until_complete(
            tools[0].on_invoke_tool(ctx, json.dumps({
                "questions": [{"question": "Q?", "options": ["A", "B"]}],
            }))
        )
        assert "no Redis client" in result

        packets: list[Packet] = []
        while not packet_queue.empty():
            packets.append(packet_queue.get_nowait())

        # Should still emit: CustomToolStart → AgentUserQuestions → error CustomToolDelta → SectionEnd
        assert len(packets) == 4
        error_delta = packets[2].obj
        assert isinstance(error_delta, CustomToolDelta)
        assert error_delta.response_type == "error"

    def test_redis_exception_treated_as_timeout(self) -> None:
        redis_mock = MagicMock()
        redis_mock.blpop.side_effect = redis.exceptions.ConnectionError("gone")

        args = {
            "questions": [
                {"question": "Color?", "options": ["Red"]},
            ],
        }
        result, packets = _run_tool(args, redis_mock)

        assert "did not respond" in result
        redis_mock.delete.assert_called_once()
