"""Per-turn LLM streaming core.

Extracts the shared "one LLM turn" pattern into a reusable async function
so that the interactive orchestrator, Socket.IO handler, and any future
callers can share the same streaming / callback logic without duplicating
event classification, tool-call extraction, or section transition handling.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agents import Agent
from agents import RawResponsesStreamEvent
from agents import RunConfig
from agents import Runner
from agents import ToolCallItem

from onyx.utils.logger import setup_logger

logger = setup_logger()


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ToolCallInfo:
    """Parsed representation of a single tool call detected in the stream."""

    name: str
    input: dict[str, Any]
    call_id: str
    raw_item: Any


@dataclass
class TurnCallbacks:
    """Optional callbacks that the caller can supply to observe stream events.

    Every callback is fire-and-forget from the perspective of ``run_llm_turn``;
    exceptions raised by callbacks are logged but do not abort the stream.
    """

    on_reasoning_start: Callable[[int], Awaitable[None]] | None = None
    on_reasoning_delta: Callable[[str, int], Awaitable[None]] | None = None
    on_text_start: Callable[[int], Awaitable[None]] | None = None
    on_text_delta: Callable[[str, int], Awaitable[None]] | None = None
    on_section_end: Callable[[int], Awaitable[None]] | None = None
    on_tool_call: Callable[[ToolCallInfo], Awaitable[None]] | None = None
    should_stop: Callable[[], bool] | None = None


@dataclass
class TurnResult:
    """Accumulated output from a single LLM turn."""

    full_response_text: str = ""
    thinking_content: str = ""
    tool_calls: list[ToolCallInfo] = field(default_factory=list)
    tool_call_count: int = 0
    final_messages: list[dict[str, Any]] | None = None
    stopped: bool = False


# ---------------------------------------------------------------------------
# Helper functions — extract tool metadata from raw SDK items
# ---------------------------------------------------------------------------


def _extract_tool_name(raw: Any) -> str:
    """Extract the tool name from a raw tool-call item (object or dict)."""
    return (
        (
            getattr(raw, "name", None)
            or (raw.get("name") if isinstance(raw, dict) else None)
            or "unknown"
        )
        .replace("\n", " ")
    )


def _extract_call_id(raw: Any) -> str:
    """Extract the call ID from a raw tool-call item (object or dict)."""
    return (
        getattr(raw, "call_id", None)
        or (raw.get("call_id") if isinstance(raw, dict) else None)
        or ""
    )


def _extract_tool_input(raw: Any) -> dict[str, Any]:
    """Extract and parse tool arguments from a raw tool-call item."""
    tc_args_str: Any = (
        getattr(raw, "arguments", None)
        or (raw.get("arguments") if isinstance(raw, dict) else None)
        or "{}"
    )
    try:
        return json.loads(tc_args_str) if isinstance(tc_args_str, str) else tc_args_str
    except (json.JSONDecodeError, TypeError):
        return {"raw": tc_args_str}


# ---------------------------------------------------------------------------
# Main function
# ---------------------------------------------------------------------------


async def run_llm_turn(
    agent: Agent,
    messages: list[dict[str, Any]],
    run_config: RunConfig,
    callbacks: TurnCallbacks | None = None,
    stop_check_interval: int = 10,
    initial_step_number: int = 0,
) -> TurnResult:
    """Stream a single LLM turn and return accumulated results.

    This is the core primitive shared by every orchestrator variant.  It:

    1. Starts an ``Runner.run_streamed()`` call against the given agent.
    2. Iterates over the async stream of events, classifying each one.
    3. Fires the appropriate callback (reasoning, text, tool-call, etc.).
    4. Handles the reasoning-to-text section transition (emitting
       ``on_section_end`` to close reasoning, then ``on_text_start``).
    5. Checks ``callbacks.should_stop()`` periodically and cancels the
       stream early if requested.
    6. After the stream ends, closes any remaining open section and
       captures ``streamed.to_input_list()`` as ``final_messages``.

    Parameters
    ----------
    agent:
        The ``Agent`` instance to run.
    messages:
        Message list (system + history + user message).
    run_config:
        Agents SDK ``RunConfig`` with model/provider credentials.
    callbacks:
        Optional ``TurnCallbacks`` for observing stream events.
    stop_check_interval:
        Check ``callbacks.should_stop()`` every N events.
    initial_step_number:
        Starting step number (incremented on reasoning-to-text transition).
    """
    cb = callbacks or TurnCallbacks()
    result = TurnResult()

    step_number = initial_step_number
    reasoning_started = False
    message_started = False

    # Start the streamed run
    streamed = Runner.run_streamed(
        agent,
        messages,  # type: ignore[arg-type]
        run_config=run_config,
    )

    event_counter = 0

    async for event in streamed.stream_events():
        event_counter += 1

        # Periodically check stop flag
        if (
            event_counter % stop_check_interval == 0
            and cb.should_stop is not None
            and cb.should_stop()
        ):
            try:
                streamed.cancel()
            except Exception:
                pass
            result.stopped = True
            break

        # --- RawResponsesStreamEvent: reasoning / text deltas ---
        if isinstance(event, RawResponsesStreamEvent):
            # Reasoning / thinking content
            if (
                event.data.type
                in (
                    "response.reasoning_text.delta",
                    "response.reasoning_summary_text.delta",
                )
                and hasattr(event.data, "delta")
                and len(event.data.delta) > 0
            ):
                if not reasoning_started:
                    reasoning_started = True
                    if cb.on_reasoning_start is not None:
                        await cb.on_reasoning_start(step_number)

                result.thinking_content += event.data.delta
                if cb.on_reasoning_delta is not None:
                    await cb.on_reasoning_delta(event.data.delta, step_number)

            # Output text
            elif (
                event.data.type == "response.output_text.delta"
                and len(event.data.delta) > 0
            ):
                if not message_started:
                    # Close the reasoning section on reasoning -> text transition
                    if reasoning_started:
                        if cb.on_section_end is not None:
                            await cb.on_section_end(step_number)

                    step_number += 1

                    if cb.on_text_start is not None:
                        await cb.on_text_start(step_number)
                    message_started = True

                result.full_response_text += event.data.delta
                if cb.on_text_delta is not None:
                    await cb.on_text_delta(event.data.delta, step_number)

        # --- Tool call detection ---
        if isinstance(getattr(event, "item", None), ToolCallItem):
            result.tool_call_count += 1
            raw = getattr(event.item, "raw_item", None)

            tc_info = ToolCallInfo(
                name=_extract_tool_name(raw),
                input=_extract_tool_input(raw),
                call_id=_extract_call_id(raw),
                raw_item=raw,
            )
            result.tool_calls.append(tc_info)

            logger.info(
                "Tool call #%d: %s",
                result.tool_call_count,
                tc_info.name,
            )

            if cb.on_tool_call is not None:
                await cb.on_tool_call(tc_info)

    # --- Stream complete ---

    # Close any open section
    if (message_started or reasoning_started) and cb.on_section_end is not None:
        await cb.on_section_end(step_number)

    # Capture the final message list for the next turn
    try:
        result.final_messages = streamed.to_input_list()  # type: ignore[assignment]
    except Exception:
        logger.warning("Failed to capture final_messages from streamed run", exc_info=True)

    return result
