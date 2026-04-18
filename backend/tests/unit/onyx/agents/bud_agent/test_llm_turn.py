"""Unit tests for onyx.agents.bud_agent.llm_turn."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest

from onyx.agents.bud_agent.llm_turn import (
    ToolCallInfo,
    TurnCallbacks,
    TurnResult,
    _extract_call_id,
    _extract_tool_input,
    _extract_tool_name,
    run_llm_turn,
)


# ---------------------------------------------------------------------------
# Helpers for building synthetic stream events
# ---------------------------------------------------------------------------


@dataclass
class _FakeStreamData:
    """Mimics the ``event.data`` shape for RawResponsesStreamEvent."""

    type: str
    delta: str = ""


@dataclass
class _FakeRawResponsesStreamEvent:
    """Fake that will stand in for ``RawResponsesStreamEvent``.

    We patch the module-level name so ``isinstance()`` checks pass naturally.
    """

    data: _FakeStreamData
    type: str = "raw_response_event"


@dataclass
class _FakeToolCallItem:
    """Fake that will stand in for ``ToolCallItem``.

    We patch the module-level name so ``isinstance()`` checks pass naturally.
    """

    raw_item: Any
    type: str = "tool_call_item"


@dataclass
class _FakeRunItemStreamEvent:
    """Event carrying a tool call item (has an ``item`` attribute)."""

    item: _FakeToolCallItem
    type: str = "run_item_stream_event"


class _FakeRawToolCall:
    """Mimics the raw tool call object with attribute access."""

    def __init__(self, name: str, call_id: str, arguments: str) -> None:
        self.name = name
        self.call_id = call_id
        self.arguments = arguments


def _make_reasoning_event(delta: str) -> _FakeRawResponsesStreamEvent:
    return _FakeRawResponsesStreamEvent(
        data=_FakeStreamData(type="response.reasoning_text.delta", delta=delta)
    )


def _make_reasoning_summary_event(delta: str) -> _FakeRawResponsesStreamEvent:
    return _FakeRawResponsesStreamEvent(
        data=_FakeStreamData(
            type="response.reasoning_summary_text.delta", delta=delta
        )
    )


def _make_text_event(delta: str) -> _FakeRawResponsesStreamEvent:
    return _FakeRawResponsesStreamEvent(
        data=_FakeStreamData(type="response.output_text.delta", delta=delta)
    )


def _make_tool_call_event(
    name: str = "my_tool",
    call_id: str = "call_1",
    arguments: str = '{"key": "value"}',
) -> _FakeRunItemStreamEvent:
    raw = _FakeRawToolCall(name=name, call_id=call_id, arguments=arguments)
    return _FakeRunItemStreamEvent(item=_FakeToolCallItem(raw_item=raw))


def _make_tool_call_event_dict(
    name: str = "dict_tool",
    call_id: str = "call_d1",
    arguments: str = '{"x": 1}',
) -> _FakeRunItemStreamEvent:
    """Tool call event where ``raw_item`` is a plain dict (not an object)."""
    raw = {"name": name, "call_id": call_id, "arguments": arguments}
    return _FakeRunItemStreamEvent(item=_FakeToolCallItem(raw_item=raw))


class _FakeStreamed:
    """Mimics ``RunResultStreaming`` with an async ``stream_events`` iterator."""

    def __init__(self, events: list[Any]) -> None:
        self._events = events
        self._cancelled = False

    async def stream_events(self):  # type: ignore[no-untyped-def]
        for event in self._events:
            if self._cancelled:
                break
            yield event

    def cancel(self) -> None:
        self._cancelled = True

    def to_input_list(self) -> list[dict[str, Any]]:
        return [{"role": "assistant", "content": "done"}]


# ---------------------------------------------------------------------------
# Shared patch context manager
# ---------------------------------------------------------------------------


def _patches(events: list[Any], streamed: _FakeStreamed | None = None):
    """Return a combined context manager that patches:

    1. ``Runner.run_streamed`` to return a ``_FakeStreamed`` wrapping *events*.
    2. ``RawResponsesStreamEvent`` in the llm_turn module to our fake class.
    3. ``ToolCallItem`` in the llm_turn module to our fake class.

    This makes the real ``isinstance()`` calls in ``run_llm_turn`` pass for
    our fake event objects without touching ``builtins.isinstance``.
    """
    fake_streamed = streamed or _FakeStreamed(events)

    class _Ctx:
        def __enter__(self) -> _Ctx:
            self._p1 = patch(
                "onyx.agents.bud_agent.llm_turn.Runner.run_streamed",
                return_value=fake_streamed,
            )
            self._p2 = patch(
                "onyx.agents.bud_agent.llm_turn.RawResponsesStreamEvent",
                _FakeRawResponsesStreamEvent,
            )
            self._p3 = patch(
                "onyx.agents.bud_agent.llm_turn.ToolCallItem",
                _FakeToolCallItem,
            )
            self._p1.__enter__()
            self._p2.__enter__()
            self._p3.__enter__()
            return self

        def __exit__(self, *args: Any) -> None:
            self._p3.__exit__(*args)
            self._p2.__exit__(*args)
            self._p1.__exit__(*args)

    return _Ctx()


# ---------------------------------------------------------------------------
# Tests for helper functions
# ---------------------------------------------------------------------------


class TestExtractToolName:
    def test_attribute_access(self) -> None:
        raw = _FakeRawToolCall(name="read_file", call_id="c1", arguments="{}")
        assert _extract_tool_name(raw) == "read_file"

    def test_dict_access(self) -> None:
        raw = {"name": "write_file", "call_id": "c2", "arguments": "{}"}
        assert _extract_tool_name(raw) == "write_file"

    def test_fallback_to_unknown(self) -> None:
        raw = 42  # no name attribute, not a dict
        assert _extract_tool_name(raw) == "unknown"

    def test_newlines_stripped(self) -> None:
        raw = _FakeRawToolCall(name="bad\nname", call_id="c3", arguments="{}")
        assert _extract_tool_name(raw) == "bad name"

    def test_none_raw(self) -> None:
        assert _extract_tool_name(None) == "unknown"


class TestExtractCallId:
    def test_attribute_access(self) -> None:
        raw = _FakeRawToolCall(name="t", call_id="abc-123", arguments="{}")
        assert _extract_call_id(raw) == "abc-123"

    def test_dict_access(self) -> None:
        raw = {"name": "t", "call_id": "xyz-456"}
        assert _extract_call_id(raw) == "xyz-456"

    def test_fallback_to_empty(self) -> None:
        raw = 42
        assert _extract_call_id(raw) == ""

    def test_none_raw(self) -> None:
        assert _extract_call_id(None) == ""


class TestExtractToolInput:
    def test_json_string(self) -> None:
        raw = _FakeRawToolCall(name="t", call_id="c", arguments='{"a": 1}')
        assert _extract_tool_input(raw) == {"a": 1}

    def test_dict_already_parsed(self) -> None:
        """When arguments is already a dict (not a string)."""
        raw = MagicMock()
        raw.arguments = {"a": 1}
        assert _extract_tool_input(raw) == {"a": 1}

    def test_invalid_json_returns_raw(self) -> None:
        raw = _FakeRawToolCall(name="t", call_id="c", arguments="not json{{{")
        result = _extract_tool_input(raw)
        assert result == {"raw": "not json{{{"}

    def test_empty_string(self) -> None:
        raw = _FakeRawToolCall(name="t", call_id="c", arguments="")
        # Empty string is falsy, so the `or` chain falls through to "{}"
        result = _extract_tool_input(raw)
        assert result == {}

    def test_dict_format(self) -> None:
        raw = {"name": "t", "call_id": "c", "arguments": '{"b": 2}'}
        assert _extract_tool_input(raw) == {"b": 2}

    def test_none_raw(self) -> None:
        result = _extract_tool_input(None)
        assert result == {}


# ---------------------------------------------------------------------------
# Tests for TurnResult defaults
# ---------------------------------------------------------------------------


class TestTurnResultDefaults:
    def test_default_values(self) -> None:
        result = TurnResult()
        assert result.full_response_text == ""
        assert result.thinking_content == ""
        assert result.tool_calls == []
        assert result.tool_call_count == 0
        assert result.final_messages is None
        assert result.stopped is False


# ---------------------------------------------------------------------------
# Tests for run_llm_turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_text_accumulation() -> None:
    """Text deltas are accumulated in full_response_text."""
    events = [_make_text_event("Hello "), _make_text_event("world!")]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.full_response_text == "Hello world!"
    assert result.thinking_content == ""
    assert result.tool_calls == []
    assert result.stopped is False


@pytest.mark.asyncio
async def test_thinking_accumulation() -> None:
    """Reasoning deltas are accumulated in thinking_content."""
    events = [
        _make_reasoning_event("Let me "),
        _make_reasoning_event("think..."),
    ]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.thinking_content == "Let me think..."
    assert result.full_response_text == ""


@pytest.mark.asyncio
async def test_reasoning_summary_event() -> None:
    """reasoning_summary_text.delta events also accumulate as thinking."""
    events = [_make_reasoning_summary_event("summary")]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.thinking_content == "summary"


@pytest.mark.asyncio
async def test_tool_call_detection_attribute_format() -> None:
    """Tool calls with attribute-based raw_item are detected and parsed."""
    events = [
        _make_tool_call_event(
            name="search", call_id="c99", arguments='{"query": "test"}'
        )
    ]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.tool_call_count == 1
    assert len(result.tool_calls) == 1
    tc = result.tool_calls[0]
    assert tc.name == "search"
    assert tc.call_id == "c99"
    assert tc.input == {"query": "test"}


@pytest.mark.asyncio
async def test_tool_call_detection_dict_format() -> None:
    """Tool calls with dict-based raw_item are detected and parsed."""
    events = [
        _make_tool_call_event_dict(
            name="read", call_id="d1", arguments='{"path": "/tmp"}'
        )
    ]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.tool_call_count == 1
    tc = result.tool_calls[0]
    assert tc.name == "read"
    assert tc.call_id == "d1"
    assert tc.input == {"path": "/tmp"}


@pytest.mark.asyncio
async def test_should_stop_early_exit() -> None:
    """When should_stop returns True the stream is cancelled and stopped=True."""
    # Generate enough events to trigger the stop check (interval=2)
    events = [
        _make_text_event("a"),
        _make_text_event("b"),  # event 2 -> stop check fires
        _make_text_event("c"),  # should not be reached
        _make_text_event("d"),
    ]

    stop_called = False

    def should_stop() -> bool:
        nonlocal stop_called
        if not stop_called:
            stop_called = True
            return True
        return True

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=TurnCallbacks(should_stop=should_stop),
            stop_check_interval=2,
        )

    assert result.stopped is True
    # Should have accumulated text up to the stop point (events 1-2 processed)
    assert "a" in result.full_response_text


@pytest.mark.asyncio
async def test_callback_ordering_reasoning_to_text() -> None:
    """Verify callback ordering: reasoning_start -> reasoning_delta ->
    section_end -> text_start -> text_delta -> section_end (final).
    """
    events = [
        _make_reasoning_event("think"),
        _make_text_event("answer"),
    ]

    call_log: list[str] = []

    async def on_reasoning_start(step: int) -> None:
        call_log.append(f"reasoning_start:{step}")

    async def on_reasoning_delta(delta: str, step: int) -> None:
        call_log.append(f"reasoning_delta:{delta}:{step}")

    async def on_text_start(step: int) -> None:
        call_log.append(f"text_start:{step}")

    async def on_text_delta(delta: str, step: int) -> None:
        call_log.append(f"text_delta:{delta}:{step}")

    async def on_section_end(step: int) -> None:
        call_log.append(f"section_end:{step}")

    cb = TurnCallbacks(
        on_reasoning_start=on_reasoning_start,
        on_reasoning_delta=on_reasoning_delta,
        on_text_start=on_text_start,
        on_text_delta=on_text_delta,
        on_section_end=on_section_end,
    )

    with _patches(events):
        await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
            initial_step_number=0,
        )

    assert call_log == [
        "reasoning_start:0",
        "reasoning_delta:think:0",
        "section_end:0",       # reasoning section closed
        "text_start:1",        # step incremented for text
        "text_delta:answer:1",
        "section_end:1",       # final section close
    ]


@pytest.mark.asyncio
async def test_section_end_fires_on_reasoning_to_text_transition() -> None:
    """on_section_end fires between reasoning and text to close the reasoning section."""
    events = [
        _make_reasoning_event("hmm"),
        _make_text_event("ok"),
    ]

    section_end_steps: list[int] = []

    async def on_section_end(step: int) -> None:
        section_end_steps.append(step)

    cb = TurnCallbacks(on_section_end=on_section_end)

    with _patches(events):
        await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
            initial_step_number=5,
        )

    # First section_end at step 5 (reasoning close), second at step 6 (final)
    assert section_end_steps == [5, 6]


@pytest.mark.asyncio
async def test_text_only_no_double_section_end() -> None:
    """When there is no reasoning, section_end fires once (final close only)."""
    events = [_make_text_event("hello")]

    section_end_count = 0

    async def on_section_end(step: int) -> None:
        nonlocal section_end_count
        section_end_count += 1

    cb = TurnCallbacks(on_section_end=on_section_end)

    with _patches(events):
        await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
        )

    assert section_end_count == 1


@pytest.mark.asyncio
async def test_empty_stream_returns_default_result() -> None:
    """An empty stream produces a default TurnResult with final_messages set."""
    events: list[Any] = []

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.full_response_text == ""
    assert result.thinking_content == ""
    assert result.tool_calls == []
    assert result.tool_call_count == 0
    assert result.stopped is False
    # final_messages should be captured from to_input_list()
    assert result.final_messages is not None


@pytest.mark.asyncio
async def test_tool_call_callback_fires() -> None:
    """on_tool_call callback is invoked with the ToolCallInfo."""
    events = [
        _make_tool_call_event(name="bash", call_id="c1", arguments='{"cmd": "ls"}')
    ]

    received: list[ToolCallInfo] = []

    async def on_tool_call(tc: ToolCallInfo) -> None:
        received.append(tc)

    cb = TurnCallbacks(on_tool_call=on_tool_call)

    with _patches(events):
        await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
        )

    assert len(received) == 1
    assert received[0].name == "bash"
    assert received[0].input == {"cmd": "ls"}


@pytest.mark.asyncio
async def test_final_messages_captured() -> None:
    """final_messages is set from streamed.to_input_list() after the stream."""
    events = [_make_text_event("x")]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.final_messages == [{"role": "assistant", "content": "done"}]


@pytest.mark.asyncio
async def test_no_callbacks_does_not_crash() -> None:
    """run_llm_turn works fine when callbacks is None (all events silently skipped)."""
    events = [
        _make_reasoning_event("think"),
        _make_text_event("answer"),
        _make_tool_call_event(),
    ]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=None,
        )

    assert result.full_response_text == "answer"
    assert result.thinking_content == "think"
    assert result.tool_call_count == 1


@pytest.mark.asyncio
async def test_step_number_increments_on_text_start() -> None:
    """The step number increments when transitioning from reasoning to text."""
    events = [
        _make_reasoning_event("r1"),
        _make_reasoning_event("r2"),
        _make_text_event("t1"),
        _make_text_event("t2"),
    ]

    text_start_steps: list[int] = []
    text_delta_steps: list[int] = []

    async def on_text_start(step: int) -> None:
        text_start_steps.append(step)

    async def on_text_delta(delta: str, step: int) -> None:
        text_delta_steps.append(step)

    cb = TurnCallbacks(
        on_text_start=on_text_start,
        on_text_delta=on_text_delta,
    )

    with _patches(events):
        await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
            initial_step_number=3,
        )

    # Reasoning at step 3, text starts at step 4
    assert text_start_steps == [4]
    assert all(s == 4 for s in text_delta_steps)


@pytest.mark.asyncio
async def test_multiple_tool_calls() -> None:
    """Multiple tool calls in a single turn are all captured."""
    events = [
        _make_tool_call_event(name="tool_a", call_id="c1", arguments='{"a": 1}'),
        _make_tool_call_event(name="tool_b", call_id="c2", arguments='{"b": 2}'),
        _make_tool_call_event_dict(name="tool_c", call_id="c3", arguments='{"c": 3}'),
    ]

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.tool_call_count == 3
    assert [tc.name for tc in result.tool_calls] == ["tool_a", "tool_b", "tool_c"]


@pytest.mark.asyncio
async def test_reasoning_only_section_end() -> None:
    """When only reasoning events occur (no text), section_end fires at the end."""
    events = [_make_reasoning_event("thinking...")]

    section_end_called = False

    async def on_section_end(step: int) -> None:
        nonlocal section_end_called
        section_end_called = True

    cb = TurnCallbacks(on_section_end=on_section_end)

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
        )

    assert result.thinking_content == "thinking..."
    assert result.full_response_text == ""
    assert section_end_called


@pytest.mark.asyncio
async def test_to_input_list_failure_does_not_crash() -> None:
    """If to_input_list raises, final_messages is None but no exception propagates."""
    events = [_make_text_event("hello")]

    class _BrokenStreamed(_FakeStreamed):
        def to_input_list(self) -> list[dict[str, Any]]:
            raise RuntimeError("broken")

    broken = _BrokenStreamed(events)

    with _patches(events, streamed=broken):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
        )

    assert result.full_response_text == "hello"
    # final_messages should be None because to_input_list raised
    assert result.final_messages is None


@pytest.mark.asyncio
async def test_mixed_events_comprehensive() -> None:
    """A comprehensive stream with reasoning, text, and tool calls."""
    events = [
        _make_reasoning_event("Let me think"),
        _make_reasoning_event(" about this"),
        _make_text_event("Here is "),
        _make_text_event("the answer."),
        _make_tool_call_event(name="search", call_id="c1", arguments='{"q": "test"}'),
    ]

    call_log: list[str] = []

    async def on_reasoning_start(step: int) -> None:
        call_log.append("reasoning_start")

    async def on_reasoning_delta(delta: str, step: int) -> None:
        call_log.append(f"reasoning:{delta}")

    async def on_text_start(step: int) -> None:
        call_log.append("text_start")

    async def on_text_delta(delta: str, step: int) -> None:
        call_log.append(f"text:{delta}")

    async def on_section_end(step: int) -> None:
        call_log.append("section_end")

    async def on_tool_call(tc: ToolCallInfo) -> None:
        call_log.append(f"tool:{tc.name}")

    cb = TurnCallbacks(
        on_reasoning_start=on_reasoning_start,
        on_reasoning_delta=on_reasoning_delta,
        on_text_start=on_text_start,
        on_text_delta=on_text_delta,
        on_section_end=on_section_end,
        on_tool_call=on_tool_call,
    )

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
        )

    assert result.thinking_content == "Let me think about this"
    assert result.full_response_text == "Here is the answer."
    assert result.tool_call_count == 1

    assert call_log == [
        "reasoning_start",
        "reasoning:Let me think",
        "reasoning: about this",
        "section_end",          # reasoning -> text transition
        "text_start",
        "text:Here is ",
        "text:the answer.",
        "tool:search",
        "section_end",          # final close
    ]


@pytest.mark.asyncio
async def test_empty_delta_ignored() -> None:
    """Events with empty delta strings are not accumulated or dispatched."""
    events = [
        _FakeRawResponsesStreamEvent(
            data=_FakeStreamData(type="response.output_text.delta", delta="")
        ),
        _FakeRawResponsesStreamEvent(
            data=_FakeStreamData(type="response.reasoning_text.delta", delta="")
        ),
        _make_text_event("ok"),
    ]

    call_log: list[str] = []

    async def on_text_delta(delta: str, step: int) -> None:
        call_log.append(delta)

    async def on_reasoning_delta(delta: str, step: int) -> None:
        call_log.append(f"r:{delta}")

    cb = TurnCallbacks(
        on_text_delta=on_text_delta,
        on_reasoning_delta=on_reasoning_delta,
    )

    with _patches(events):
        result = await run_llm_turn(
            agent=MagicMock(),
            messages=[{"role": "user", "content": "hi"}],
            run_config=MagicMock(),
            callbacks=cb,
        )

    # Only the non-empty "ok" text should have been dispatched
    assert call_log == ["ok"]
    assert result.full_response_text == "ok"
    assert result.thinking_content == ""
