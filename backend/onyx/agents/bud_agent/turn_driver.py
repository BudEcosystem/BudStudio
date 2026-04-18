"""Unified turn-by-turn state machine for BudAgent.

Replaces the divergent loop implementations across interactive, cron,
and inbox modes with a single ``TurnDriver`` class that manages the
LLM turn -> tool dispatch -> resume cycle.
"""

from __future__ import annotations

from collections.abc import Awaitable
from collections.abc import Callable
from contextlib import AbstractContextManager
from contextlib import contextmanager
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Generator
from typing import Protocol
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.orm import Session

from onyx.agents.bud_agent.llm_turn import TurnCallbacks
from onyx.agents.bud_agent.llm_turn import TurnResult
from onyx.agents.bud_agent.llm_turn import ToolCallInfo
from onyx.agents.bud_agent.llm_turn import run_llm_turn
from onyx.agents.bud_agent.tool_definitions import is_local_tool
from onyx.db.agent import add_tool_message
from onyx.db.agent import load_pending_local_tools
from onyx.db.agent import persist_pending_local_tools
from onyx.db.agent import set_session_execution_status
from onyx.db.agent import update_tool_message_result
from onyx.db.enums import AgentSessionExecutionStatus
from onyx.utils.logger import setup_logger

if TYPE_CHECKING:
    from onyx.agents.bud_agent.agent_context import AgentExecutionMode
    from onyx.agents.bud_agent.agent_context import AgentRunContext

logger = setup_logger()


# ---------------------------------------------------------------------------
# Protocols
# ---------------------------------------------------------------------------


class TurnEmitter(Protocol):
    """Protocol for emitting real-time UI events during a turn."""

    async def reasoning_start(self, step: int) -> None: ...

    async def reasoning_delta(self, delta: str, step: int) -> None: ...

    async def text_start(self, step: int) -> None: ...

    async def text_delta(self, delta: str, step: int) -> None: ...

    async def section_end(self, step: int) -> None: ...

    async def tool_start(self, tool_name: str, step: int) -> None: ...

    async def tool_result_event(
        self,
        tool_name: str,
        tool_call_id: str,
        result: Any,
        step: int,
    ) -> None:
        """Emit UI events for a remote tool's result (tool:start + tool:delta)."""
        ...


class ToolRequester(Protocol):
    """Protocol for dispatching a tool call to the client or executor."""

    async def request(self, tool: dict[str, Any]) -> None: ...


# ---------------------------------------------------------------------------
# DB session factory type
# ---------------------------------------------------------------------------

# Callers can provide a context-manager factory so TurnDriver opens
# short-lived sessions for each DB operation (interactive handler pattern).
# When None, TurnDriver uses the single ``db_session`` passed to each method.
DbSessionFactory = Callable[[], AbstractContextManager[Session]]


@contextmanager
def _passthrough_session(session: Session) -> Generator[Session, None, None]:
    """Default factory: reuse the caller-provided session."""
    yield session


# ---------------------------------------------------------------------------
# Config & Result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class TurnDriverConfig:
    """Configuration for a TurnDriver instance."""

    mode: AgentExecutionMode
    max_tool_calls: int = 500
    should_stop: Callable[[], bool] | None = None
    emitter: TurnEmitter | None = None
    tool_requester: ToolRequester | None = None
    on_turn_complete: Callable[[TurnResult], Awaitable[None]] | None = None
    # Factory for short-lived DB sessions.  When set, TurnDriver opens fresh
    # sessions for each persistence operation instead of holding a single
    # connection across potentially-long LLM calls.
    get_db_session: DbSessionFactory | None = None


@dataclass
class TurnDriverResult:
    """Outcome of a ``run_next_turn`` or ``handle_tool_result`` call."""

    status: str  # "complete", "awaiting_tool", "max_tools_reached", "stopped"
    turn: TurnResult | None = None
    pending: list[dict[str, Any]] = field(default_factory=list)
    # The tool that was just dispatched (or would have been).  Populated
    # when ``status == "awaiting_tool"`` so callers can save the tool info
    # for later resume (e.g. cron suspension).
    dispatched_tool: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Tool classification
# ---------------------------------------------------------------------------

PAUSE_TOOLS: set[str] = {"ask_user_questions"}


def classify_tool_calls(
    tool_calls: list[ToolCallInfo],
    connector_approval_tools: set[str],
) -> tuple[list[ToolCallInfo], list[ToolCallInfo]]:
    """Split tool calls into (local, remote).

    "Local" means the tool must be dispatched to the client or pauses
    execution (e.g. ``ask_user_questions``), or requires connector-level
    approval.  "Remote" tools are executed server-side automatically.

    Returns
    -------
    (local, remote) : tuple of two lists.
    """
    local: list[ToolCallInfo] = []
    remote: list[ToolCallInfo] = []
    for tc in tool_calls:
        if (
            is_local_tool(tc.name)
            or tc.name in PAUSE_TOOLS
            or tc.name in connector_approval_tools
        ):
            local.append(tc)
        else:
            remote.append(tc)
    return local, remote


# ---------------------------------------------------------------------------
# TurnDriver
# ---------------------------------------------------------------------------


class TurnDriver:
    """Unified turn-by-turn state machine.

    Manages the cycle of:
        1. Run an LLM turn (streaming).
        2. Classify resulting tool calls.
        3. Either recurse (remote-only) or pause (has local / pause tools).
        4. Resume after tool results arrive.
    """

    def __init__(self, config: TurnDriverConfig, ctx: AgentRunContext) -> None:
        self._config = config
        self._ctx = ctx
        self._total_tool_calls = 0

    def _get_session(self, fallback: Session) -> Any:
        """Return a context-manager that yields a DB session.

        If ``config.get_db_session`` is set, use it (short-lived session).
        Otherwise reuse the caller's ``fallback`` session.
        """
        if self._config.get_db_session is not None:
            return self._config.get_db_session()
        return _passthrough_session(fallback)

    async def run_next_turn(
        self,
        session_id: UUID,
        db_session: Session,
        messages: list[dict[str, Any]],
        step_number: int = 0,
    ) -> TurnDriverResult:
        """Execute one LLM turn and decide on the next action.

        Possible return statuses:
        - ``"complete"`` -- no tool calls; the turn is finished.
        - ``"awaiting_tool"`` -- local/pause tool(s) dispatched; waiting.
        - ``"max_tools_reached"`` -- safety cap hit.
        - ``"stopped"`` -- ``should_stop`` signalled early termination.
        """
        # --- guard: max tool calls ---
        if self._total_tool_calls >= self._config.max_tool_calls:
            logger.warning(
                "Max tool calls (%d) reached in TurnDriver",
                self._config.max_tool_calls,
            )
            return TurnDriverResult(status="max_tools_reached")

        # --- guard: external stop signal ---
        if self._config.should_stop is not None and self._config.should_stop():
            return TurnDriverResult(status="stopped")

        # --- build callbacks ---
        callbacks = self._build_callbacks(step_number)

        # --- run one LLM turn ---
        turn = await run_llm_turn(
            agent=self._ctx.agent,
            messages=messages,
            run_config=self._ctx.run_config,
            callbacks=callbacks,
            initial_step_number=step_number,
        )

        # Accumulate tool count
        self._total_tool_calls += turn.tool_call_count

        # --- persist turn result ---
        from onyx.agents.bud_agent.agent_context import persist_turn_result

        with self._get_session(db_session) as sess:
            persist_turn_result(
                db_session=sess,
                session_id=session_id,
                response_text=turn.full_response_text or None,
                thinking_content=turn.thinking_content or None,
                tool_call_count=turn.tool_call_count,
                step_number=step_number,
            )

        # --- fire on_turn_complete ---
        if self._config.on_turn_complete is not None:
            await self._config.on_turn_complete(turn)

        # --- early stop from LLM side ---
        if turn.stopped:
            return TurnDriverResult(status="stopped", turn=turn)

        # --- no tool calls: done ---
        if not turn.tool_calls:
            return TurnDriverResult(status="complete", turn=turn)

        # --- classify tool calls ---
        local, remote = classify_tool_calls(
            turn.tool_calls,
            self._ctx.connector_approval_tools,
        )

        # --- remote-only: persist + emit, then recurse ---
        if not local:
            # FunctionTools (web_search, open_url, render_artifact, etc.)
            # self-persist their TOOL rows with rich structured output
            # during on_invoke_tool.  Other tools (workspace_read,
            # memory_search, etc.) do NOT self-persist.
            #
            # Strategy (matching main branch):
            #  1. Load existing tool DB rows to find self-persisted ones.
            #  2. Only create new DB rows for tools that didn't self-persist.
            #  3. Emit tool:start + tool:delta using the tool's own DB
            #     record (which has structured data like search_docs,
            #     openui_lang, etc.).

            # Extract outputs from SDK final_messages (raw string results).
            tool_outputs: dict[str, str] = {}
            if turn.final_messages:
                for item in turn.final_messages:
                    if (
                        isinstance(item, dict)
                        and item.get("type") == "function_call_output"
                    ):
                        tool_outputs[item.get("call_id", "")] = item.get(
                            "output", ""
                        )

            # Load self-persisted tool rows from DB.
            from onyx.db.agent import get_session_messages
            from onyx.db.models import AgentMessageRole

            db_tool_rows: list[Any] = []
            with self._get_session(db_session) as sess:
                existing_tool_names: set[str] = set()
                try:
                    all_msgs = get_session_messages(sess, session_id)
                    db_tool_rows = [
                        m for m in reversed(all_msgs)
                        if m.role == AgentMessageRole.TOOL
                    ]
                    for m in db_tool_rows:
                        if m.tool_name:
                            existing_tool_names.add(m.tool_name)
                except Exception:
                    logger.debug(
                        "Could not load tool results for session %s",
                        session_id,
                    )

            # Persist only tools that didn't self-persist.
            remote_step = step_number + 1
            with self._get_session(db_session) as sess:
                seen_names: set[str] = set()
                for tc in remote:
                    if tc.name in existing_tool_names and tc.name not in seen_names:
                        seen_names.add(tc.name)
                        continue  # self-persisted
                    output_str = tool_outputs.get(tc.call_id, "")
                    try:
                        import json as _json
                        output_val = _json.loads(output_str) if output_str else None
                    except (ValueError, TypeError):
                        output_val = {"output": output_str} if output_str else None
                    add_tool_message(
                        db_session=sess,
                        session_id=session_id,
                        tool_name=tc.name,
                        tool_input=tc.input,
                        tool_call_id=tc.call_id,
                        step_number=remote_step,
                        tool_output=output_val,
                    )
                    remote_step += 1

            # Emit UI events using the tool's own DB records (rich data).
            if self._config.emitter is not None:
                consumed: set[int] = set()
                remote_step = step_number + 1
                for tc in remote:
                    # Find the most recent unconsumed DB row for this tool
                    tool_data: Any = None
                    openui_resp: str | None = None
                    for idx, tm in enumerate(db_tool_rows):
                        if idx in consumed:
                            continue
                        if tm.tool_name == tc.name:
                            tool_data = tm.tool_output
                            if isinstance(tool_data, dict):
                                openui_resp = tool_data.get("openui_lang")
                            consumed.add(idx)
                            break

                    await self._config.emitter.tool_result_event(
                        tool_name=tc.name,
                        tool_call_id=tc.call_id,
                        result=tool_data,
                        step=remote_step,
                    )
                    remote_step += 1

            next_messages = turn.final_messages or messages
            # Advance step_number past the remote tool events so the
            # next turn's messages don't collide with this one's steps.
            next_step = step_number + len(remote) + 1
            return await self.run_next_turn(
                session_id=session_id,
                db_session=db_session,
                messages=next_messages,
                step_number=next_step,
            )

        # --- has local tools: create messages, persist pending, pause ---
        pending_dicts = [
            {
                "name": tc.name,
                "input": tc.input,
                "call_id": tc.call_id,
            }
            for tc in local
        ]

        # First tool is dispatched immediately; rest are persisted
        first_tool = pending_dicts[0]
        remaining = pending_dicts[1:]

        # Also persist + emit remote tool events before pausing (if any
        # remote tools were in the same turn alongside local tools)
        if remote:
            # Same self-persist-aware pattern as remote-only path above.
            tool_outputs_mixed: dict[str, str] = {}
            if turn.final_messages:
                for item in turn.final_messages:
                    if (
                        isinstance(item, dict)
                        and item.get("type") == "function_call_output"
                    ):
                        tool_outputs_mixed[item.get("call_id", "")] = item.get(
                            "output", ""
                        )

            from onyx.db.agent import get_session_messages
            from onyx.db.models import AgentMessageRole

            db_tool_rows_mixed: list[Any] = []
            with self._get_session(db_session) as sess:
                existing_mixed: set[str] = set()
                try:
                    for m in reversed(get_session_messages(sess, session_id)):
                        if m.role == AgentMessageRole.TOOL and m.tool_name:
                            existing_mixed.add(m.tool_name)
                            db_tool_rows_mixed.append(m)
                except Exception:
                    pass

            remote_step = step_number + 1
            with self._get_session(db_session) as sess:
                seen_mixed: set[str] = set()
                for tc in remote:
                    if tc.name in existing_mixed and tc.name not in seen_mixed:
                        seen_mixed.add(tc.name)
                        continue
                    output_str = tool_outputs_mixed.get(tc.call_id, "")
                    try:
                        import json as _json
                        output_val = _json.loads(output_str) if output_str else None
                    except (ValueError, TypeError):
                        output_val = (
                            {"output": output_str} if output_str else None
                        )
                    add_tool_message(
                        db_session=sess,
                        session_id=session_id,
                        tool_name=tc.name,
                        tool_input=tc.input,
                        tool_call_id=tc.call_id,
                        step_number=remote_step,
                        tool_output=output_val,
                    )
                    remote_step += 1

            if self._config.emitter is not None:
                consumed_mixed: set[int] = set()
                remote_step = step_number + 1
                for tc in remote:
                    tool_data: Any = None
                    for idx, tm in enumerate(db_tool_rows_mixed):
                        if idx in consumed_mixed:
                            continue
                        if tm.tool_name == tc.name:
                            tool_data = tm.tool_output
                            consumed_mixed.add(idx)
                            break
                    await self._config.emitter.tool_result_event(
                        tool_name=tc.name,
                        tool_call_id=tc.call_id,
                        result=tool_data,
                        step=remote_step,
                    )
                    remote_step += 1

        # Create tool messages in DB and persist pending
        tool_step = step_number + 1
        with self._get_session(db_session) as sess:
            # Create tool message for the first local tool
            add_tool_message(
                db_session=sess,
                session_id=session_id,
                tool_name=first_tool["name"],
                tool_input=first_tool["input"],
                tool_call_id=first_tool["call_id"],
                step_number=tool_step,
            )
            first_tool["step"] = tool_step

            # Create tool messages for remaining local tools
            for i, tc in enumerate(remaining):
                tc_step = tool_step + i + 1
                tc["step"] = tc_step
                # Annotate connector tools with gateway_id
                gw = self._ctx.connector_approval_gateway.get(tc["name"])
                if gw:
                    tc["gateway_id"] = gw
                add_tool_message(
                    db_session=sess,
                    session_id=session_id,
                    tool_name=tc["name"],
                    tool_input=tc["input"],
                    tool_call_id=tc["call_id"],
                    step_number=tc_step,
                )

            persist_pending_local_tools(
                db_session=sess,
                session_id=session_id,
                tools=remaining,
            )

            set_session_execution_status(
                db_session=sess,
                session_id=session_id,
                status=AgentSessionExecutionStatus.AWAITING_TOOL,
            )

        # Dispatch the first tool if we have a requester
        if self._config.tool_requester is not None:
            await self._config.tool_requester.request(first_tool)

        return TurnDriverResult(
            status="awaiting_tool",
            turn=turn,
            pending=remaining,
            dispatched_tool=first_tool,
        )

    async def handle_tool_result(
        self,
        session_id: UUID,
        db_session: Session,
        tool_call_id: str,
        output: str | None,
        error: str | None,
    ) -> TurnDriverResult:
        """Process an incoming tool result and decide on the next action.

        If more pending tools remain, dispatches the next one and returns
        ``"awaiting_tool"``.  If all tools are done, builds a fresh message
        history and runs the next LLM turn.
        """
        # 1. Update the tool message in the DB
        with self._get_session(db_session) as sess:
            update_tool_message_result(
                db_session=sess,
                session_id=session_id,
                tool_call_id=tool_call_id,
                tool_output={"result": output} if output else None,
                tool_error=error,
            )

            # 2. Load remaining pending tools
            remaining = load_pending_local_tools(
                db_session=sess,
                session_id=session_id,
            )

        # 3. If more pending, dispatch next and stay in awaiting_tool
        if remaining:
            next_tool = remaining[0]
            rest = remaining[1:]

            with self._get_session(db_session) as sess:
                persist_pending_local_tools(
                    db_session=sess,
                    session_id=session_id,
                    tools=rest,
                )

            if self._config.tool_requester is not None:
                await self._config.tool_requester.request(next_tool)

            return TurnDriverResult(
                status="awaiting_tool",
                pending=rest,
                dispatched_tool=next_tool,
            )

        # 4. All tools done: build message history and run next LLM turn
        from onyx.agents.bud_agent.agent_context import build_message_history
        from onyx.db.agent import get_next_step_number

        with self._get_session(db_session) as sess:
            messages = build_message_history(
                db_session=sess,
                session_id=session_id,
                system_prompt=self._ctx.system_prompt,
            )

            # Resume at the correct step number (after prior tool steps)
            next_step = get_next_step_number(sess, session_id)

            set_session_execution_status(
                db_session=sess,
                session_id=session_id,
                status=AgentSessionExecutionStatus.RUNNING,
            )

        return await self.run_next_turn(
            session_id=session_id,
            db_session=db_session,
            messages=messages,
            step_number=next_step,
        )

    async def _load_tool_result(
        self,
        db_session: Session,
        session_id: UUID,
        tool_call_id: str,
    ) -> Any:
        """Load a tool's output from the DB for UI emission."""
        from onyx.db.agent import get_tool_message

        with self._get_session(db_session) as sess:
            msg = get_tool_message(sess, session_id, tool_call_id)
            if msg and msg.tool_output:
                return msg.tool_output
        return None

    def _build_callbacks(self, step_number: int) -> TurnCallbacks:
        """Wire the emitter (if any) and should_stop into TurnCallbacks."""
        emitter = self._config.emitter

        if emitter is None:
            return TurnCallbacks(
                should_stop=self._config.should_stop,
            )

        return TurnCallbacks(
            on_reasoning_start=lambda step: emitter.reasoning_start(step),
            on_reasoning_delta=lambda delta, step: emitter.reasoning_delta(delta, step),
            on_text_start=lambda step: emitter.text_start(step),
            on_text_delta=lambda delta, step: emitter.text_delta(delta, step),
            on_section_end=lambda step: emitter.section_end(step),
            should_stop=self._config.should_stop,
        )
