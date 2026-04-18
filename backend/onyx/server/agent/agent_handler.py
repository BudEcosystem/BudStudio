"""Stateless AgentHandler for Socket.IO-driven agent execution.

Each method handles one Socket.IO event.  No persistent loop, no blocking.
State lives in the database (messages, execution_status, pending_local_tools)
and Redis (stop flag).  The handler is instantiated fresh per event.

Key design:
- ``handle_execute``: validate session, set RUNNING, persist user message,
  call ``_run_llm_turn``
- ``handle_tool_result``: idempotency check, status check, persist result,
  dispatch next pending local tool or start new LLM turn
- ``handle_approval``: if denied persist error + continue, if approved emit
  ``tool:request`` + set AWAITING_TOOL
- ``handle_stop``: if RUNNING set stop flag (Redis), if AWAITING_* set IDLE
  and emit ``agent:stopped``
- ``handle_file_sync``: reuse workspace file upsert logic
- ``_run_llm_turn``: build agent, create TurnDriver, stream + handle tools
"""

from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Generator
from typing import Any
from uuid import UUID

import redis
import socketio  # type: ignore[import-untyped]
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.agent_context import (
    AgentExecutionMode,
    build_agent_run_context,
    build_message_history,
    compact_session,
    AgentRunContext,
)
from onyx.agents.bud_agent.tool_definitions import (
    LOCAL_GATEWAY_ID,
    LLM_HIDDEN_LOCAL_TOOLS,
    LOCAL_TOOL_SCHEMAS,
    requires_approval,
)
from onyx.agents.bud_agent.turn_driver import TurnDriver
from onyx.agents.bud_agent.turn_driver import TurnDriverConfig
from onyx.db.agent import (
    add_session_message,
    clear_session_stop_flag,
    get_next_step_number,
    get_session_execution_status,
    get_session_for_user,
    get_tool_message,
    is_session_stopped,
    load_pending_local_tools,
    persist_pending_local_tools,
    set_session_execution_status,
    set_session_stop_flag,
    tool_result_exists,
    update_session_status,
    update_tool_message_result,
    upsert_workspace_file,
)
from onyx.db.agent_events import consume_pending_events
from onyx.db.agent_connector import get_tool_permissions
from onyx.db.engine.sql_engine import get_session_with_tenant
from onyx.db.enums import (
    AgentMessageRole,
    AgentSessionExecutionStatus,
    AgentSessionStatus,
    AgentToolPermissionLevel,
)
from onyx.db.models import AgentSessionEvent
from onyx.db.models import User
from onyx.redis.redis_pool import get_redis_client
from onyx.server.agent.socketio_emitter import SocketIOEmitter
from onyx.server.agent.socketio_emitter import SocketIOToolRequester
from onyx.utils.logger import setup_logger

logger = setup_logger()

# Compaction threshold in characters (matches orchestrator.py)
COMPACTION_THRESHOLD_CHARS = 300_000
# Maximum tool calls before forcing a stop
MAX_TOOL_CALLS = 500


def format_event_as_system_message(event: AgentSessionEvent) -> str:
    """Format an ``AgentSessionEvent`` into a human-readable system message.

    The returned string is injected as a system-role message so the LLM
    can react to asynchronous events (sub-session completions, cron
    results, escalations, etc.) on the next turn.
    """
    payload: dict[str, object] = event.payload or {}
    match event.event_type:
        case "SUB_SESSION_COMPLETE":
            return (
                f"[Sub-session completed] Task: {payload.get('task', 'unknown')}. "
                f"Summary: {payload.get('summary', 'No summary available')}"
            )
        case "SUB_SESSION_FAILED":
            return (
                f"[Sub-session failed] Task: {payload.get('task', 'unknown')}. "
                f"Error: {payload.get('error', 'unknown')}. "
                f"Partial result: {payload.get('partial_result', 'none')}"
            )
        case "SUB_SESSION_TIMEOUT":
            return (
                f"[Sub-session timed out] Task: {payload.get('task', 'unknown')}. "
                f"Partial result: {payload.get('partial_result', 'none')}"
            )
        case "CRON_RESULT":
            return (
                f"[Cron job completed] Job: {payload.get('job_name', 'unknown')}. "
                f"Result: {payload.get('summary', 'No summary')}"
            )
        case "INBOX_ESCALATION":
            return (
                f"[Inbox escalation] From: {payload.get('sender', 'unknown')}. "
                f"Reason: {payload.get('reason', 'No reason given')}"
            )
        case _:
            return f"[Event: {event.event_type}] {payload}"


class AgentHandler:
    """Stateless per-event handler for Socket.IO agent communication.

    Instantiated fresh for every incoming event.  No state is held between
    events -- everything is loaded from the database or Redis.
    """

    def __init__(
        self,
        user_id: str | None,
        user_email: str | None,
        sid: str,
        sio: socketio.AsyncServer,
        tenant_id: str = "public",
        model: str | None = None,
        workspace_path: str | None = None,
        timezone: str | None = None,
        search_query: str = "",
    ) -> None:
        self._user_id_str = user_id
        self._user_email = user_email
        self._sid = sid
        self._sio = sio
        self._tenant_id = tenant_id
        # Persisted from agent:execute so follow-up events
        # (tool:result, tool:approval) use the same model.
        self._model = model
        self._workspace_path = workspace_path
        self._timezone = timezone
        # Original user message — used only for memory search and skill
        # discovery in build_agent_run_context(), not sent to the LLM.
        self._search_query = search_query
        # LLM credentials cached after first LLM turn so tool:request
        # payloads for cli_agent can include them.
        self._llm_config: dict[str, Any] | None = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @contextmanager
    def _get_db_session(self) -> Generator[Session, None, None]:
        """Create a short-lived DB session."""
        with get_session_with_tenant(tenant_id=self._tenant_id) as session:
            yield session

    def _build_tool_request_payload(
        self,
        session_id_str: str,
        step: int,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
    ) -> dict[str, Any]:
        """Build a tool:request payload, attaching llm_config for cli_agent."""
        payload: dict[str, Any] = {
            "session_id": session_id_str,
            "ind": step,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "tool_call_id": tool_call_id,
        }
        if tool_name == "cli_agent" and self._llm_config:
            payload["llm_config"] = self._llm_config
        return payload

    def _get_redis(self) -> redis.Redis:  # type: ignore[type-arg]
        return get_redis_client(tenant_id=self._tenant_id)

    async def _emit(self, event: str, data: dict[str, Any]) -> None:
        """Emit a Socket.IO event to the session room (preferred) or sid.

        Room-based routing ensures that when a client disconnects and
        reconnects with a new sid (e.g. OAuth token refresh), events
        from an in-flight LLM coroutine still reach the client as long
        as it re-joins the room via ``agent:rejoin``.
        """
        session_id = data.get("session_id", "")
        if session_id:
            await self._sio.emit(
                event, data, room=f"session:{session_id}"
            )
        else:
            await self._sio.emit(event, data, to=self._sid)

    def _parse_user_id(self) -> UUID | None:
        """Parse user_id string to UUID.  Returns None when auth is disabled."""
        if self._user_id_str is None:
            return None
        return UUID(self._user_id_str)

    def _load_user(self, db_session: Session) -> User | None:
        """Load the User ORM object.  Returns None when auth is disabled."""
        user_id = self._parse_user_id()
        if user_id is None:
            return None
        from sqlalchemy import select
        from onyx.db.models import User as UserModel

        stmt = select(UserModel).where(UserModel.id == user_id)
        return db_session.execute(stmt).unique().scalar_one_or_none()

    def _load_always_allowed_tools(
        self, db_session: Session, user_id: UUID | None
    ) -> set[str]:
        """Load local tools the user has permanently approved."""
        if user_id is None:
            return set()
        try:
            perms = get_tool_permissions(db_session, user_id, LOCAL_GATEWAY_ID)
            return {
                p.tool_name
                for p in perms
                if p.permission_level == AgentToolPermissionLevel.ALWAYS_ALLOW
            }
        except Exception:
            logger.warning("Failed to load tool permissions", exc_info=True)
            return set()

    def _create_local_tool_stubs(self) -> list[Any]:
        """Create local tool stubs that return placeholder strings.

        Tools in ``LLM_HIDDEN_LOCAL_TOOLS`` are excluded — the LLM should
        use ``cli_agent`` instead of calling them directly.
        """
        from agents import FunctionTool

        stubs: list[FunctionTool] = []
        for schema in LOCAL_TOOL_SCHEMAS.values():
            if schema["name"] in LLM_HIDDEN_LOCAL_TOOLS:
                continue

            async def _stub_handler(
                _ctx: Any,
                _args: str,
                _name: str = schema["name"],
            ) -> str:
                return f"AWAITING_LOCAL_EXECUTION:{_name}"

            stubs.append(
                FunctionTool(
                    name=schema["name"],
                    description=schema.get("description", ""),
                    params_json_schema=schema.get("parameters", {}),
                    on_invoke_tool=_stub_handler,
                )
            )
        return stubs

    # Sub-session event types that carry a pre-formatted message
    _SUB_SESSION_RESULT_TYPES = {
        "SUB_SESSION_COMPLETE",
        "SUB_SESSION_FAILED",
        "SUB_SESSION_TIMEOUT",
    }

    def _drain_pending_events(
        self, db_session: Session, session_id: UUID
    ) -> int:
        """Consume pending events and inject each as a message.

        Sub-session result events (complete/failed/timeout) are persisted
        as ASSISTANT messages using the pre-formatted ``message`` field
        from the payload. Other events are injected as SYSTEM messages.

        Returns the number of events drained.
        """
        events = consume_pending_events(db_session, session_id)
        for event in events:
            if event.event_type in self._SUB_SESSION_RESULT_TYPES:
                # Sub-session result — use the message from the payload
                payload = event.payload or {}
                msg_content = payload.get("message")
                if isinstance(msg_content, str) and msg_content:
                    add_session_message(
                        db_session=db_session,
                        session_id=session_id,
                        role=AgentMessageRole.ASSISTANT,
                        content=msg_content,
                    )
                else:
                    # Fallback: format as system message
                    formatted = format_event_as_system_message(event)
                    add_session_message(
                        db_session=db_session,
                        session_id=session_id,
                        role=AgentMessageRole.SYSTEM,
                        content=formatted,
                    )
            else:
                # Other events (follow-ups, cron, inbox, etc.)
                formatted = format_event_as_system_message(event)
                add_session_message(
                    db_session=db_session,
                    session_id=session_id,
                    role=AgentMessageRole.SYSTEM,
                    content=formatted,
                )
        if events:
            logger.info(
                "Drained %d pending events for session=%s",
                len(events),
                session_id,
            )
        return len(events)

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    async def handle_execute(self, data: dict[str, Any]) -> dict[str, Any]:
        """User sent a message -- start first LLM turn.

        Returns an ack dict: ``{"session_id": ...}`` on success, or
        ``{"error": ..., "code": ...}`` on failure.
        """
        session_id_str: str = data.get("session_id", "")
        message: str = data.get("message", "")
        workspace_path: str | None = data.get("workspace_path")
        model: str | None = data.get("model")
        timezone: str | None = data.get("timezone")

        if not session_id_str or not message:
            return {"error": "session_id and message are required", "code": "INVALID_REQUEST"}

        try:
            session_id = UUID(session_id_str)
        except ValueError:
            return {"error": "Invalid session_id", "code": "INVALID_REQUEST"}

        user_id = self._parse_user_id()

        # Validate session ownership and status
        with self._get_db_session() as db_session:
            session = get_session_for_user(db_session, session_id, user_id)
            if session is None:
                return {"error": "Session not found", "code": "INVALID_SESSION"}

            if session.status.is_terminal():
                # Allow re-activation of completed/failed sub-sessions
                if session.session_type in ("SUB_ONE_SHOT", "SUB_PERSISTENT"):
                    update_session_status(
                        db_session, session_id, AgentSessionStatus.ACTIVE
                    )
                else:
                    return {"error": "Session is terminated", "code": "SESSION_TERMINATED"}

            # Check execution_status -- reject if not IDLE
            exec_status = session.execution_status
            if exec_status != AgentSessionExecutionStatus.IDLE:
                return {"error": "Session is busy", "code": "SESSION_BUSY"}

            # Set to RUNNING
            set_session_execution_status(
                db_session, session_id, AgentSessionExecutionStatus.RUNNING
            )

            # Clear any stale stop flag
            redis_client = self._get_redis()
            clear_session_stop_flag(redis_client, session_id)

            # Persist user message
            user_msg = add_session_message(
                db_session=db_session,
                session_id=session_id,
                role=AgentMessageRole.USER,
                content=message,
            )

            # Emit the real DB message ID so the frontend can update
            # its optimistic client-generated ID.
            await self._sio.emit(
                "agent:message_ids",
                {
                    "session_id": session_id_str,
                    "user_message_id": str(user_msg.id),
                },
                room=self._sid,
            )

            # Drain any pending async events (sub-session completions,
            # cron results, escalations, etc.) before the LLM turn so
            # the model can react to them.
            self._drain_pending_events(db_session, session_id)

        logger.info(
            "agent:execute session=%s user=%s message_len=%d",
            session_id,
            self._user_email,
            len(message),
        )

        # Run the LLM turn (async, in the same coroutine)
        await self._run_llm_turn(
            session_id=session_id,
            workspace_path=workspace_path,
            model=model,
            timezone=timezone,
        )

        return {"session_id": session_id_str}

    async def handle_tool_result(self, data: dict[str, Any]) -> None:
        """Client sent tool result -- persist and continue.

        Idempotent: duplicate results are silently ignored.
        """
        session_id_str: str = data.get("session_id", "")
        tool_call_id: str = data.get("tool_call_id", "")
        output: str | None = data.get("output")
        error: str | None = data.get("error")

        if not session_id_str or not tool_call_id:
            logger.warning("tool:result missing session_id or tool_call_id")
            return

        try:
            session_id = UUID(session_id_str)
        except ValueError:
            logger.warning("tool:result invalid session_id: %s", session_id_str)
            return

        with self._get_db_session() as db_session:
            # Idempotency check
            if tool_result_exists(db_session, session_id, tool_call_id):
                # Debug: log what exists
                from sqlalchemy import select as sa_select
                from onyx.db.models import AgentMessage as AM
                existing = db_session.execute(
                    sa_select(AM.tool_call_id, AM.tool_output, AM.tool_name).where(
                        AM.session_id == session_id,
                        AM.tool_call_id == tool_call_id,
                    )
                ).all()
                logger.info(
                    "tool:result duplicate ignored session=%s tool_call_id=%s existing=%s",
                    session_id,
                    tool_call_id,
                    [(r.tool_call_id, r.tool_output is not None, r.tool_name) for r in existing],
                )
                return

            # Status check
            exec_status = get_session_execution_status(db_session, session_id)
            if exec_status != AgentSessionExecutionStatus.AWAITING_TOOL:
                logger.info(
                    "tool:result stale (status=%s) session=%s tool_call_id=%s",
                    exec_status,
                    session_id,
                    tool_call_id,
                )
                return

            # Look up the tool message to get tool_name for the delta emission
            tool_msg = get_tool_message(db_session, session_id, tool_call_id)
            tool_name = tool_msg.tool_name if tool_msg else "unknown"

            # Persist the result
            tool_output_dict: dict[str, Any] | None = (
                {"output": output} if output is not None else None
            )
            update_tool_message_result(
                db_session=db_session,
                session_id=session_id,
                tool_call_id=tool_call_id,
                tool_output=tool_output_dict,
                tool_error=error,
            )

            # Check for more pending local tools from the same LLM turn
            remaining = load_pending_local_tools(db_session, session_id)

        logger.info(
            "tool:result received session=%s tool=%s tool_call_id=%s",
            session_id,
            tool_name,
            tool_call_id,
        )

        # Emit tool:delta to echo the result back to the UI
        step = 0
        if tool_msg and tool_msg.step_number is not None:
            step = tool_msg.step_number
        await self._emit("tool:delta", {
            "session_id": session_id_str,
            "ind": step,
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "response_type": "error" if error else "success",
            "data": error if error else output,
        })

        # If there are more pending local tools, dispatch the next one
        if remaining:
            next_tool = remaining[0]
            rest = remaining[1:]
            with self._get_db_session() as db_session:
                persist_pending_local_tools(db_session, session_id, rest)

            next_tool_name: str = next_tool.get("name", "unknown")
            next_tool_input: dict[str, Any] = next_tool.get("input", {})
            next_tool_call_id: str = next_tool.get("id", "")
            next_step: int = next_tool.get("step", step + 1)

            # Check approval for the next tool.
            from onyx.agents.bud_agent.tool_definitions import is_connector_tool
            always_allowed: set[str] = set()
            with self._get_db_session() as db_session:
                user_id = self._parse_user_id()
                always_allowed = self._load_always_allowed_tools(db_session, user_id)

            is_connector = is_connector_tool(next_tool_name)
            needs_approval = (
                (requires_approval(next_tool_name) or is_connector)
                and next_tool_name not in always_allowed
            )

            if needs_approval:
                with self._get_db_session() as db_session:
                    set_session_execution_status(
                        db_session,
                        session_id,
                        AgentSessionExecutionStatus.AWAITING_APPROVAL,
                    )
                await self._emit("tool:approval_required", {
                    "session_id": session_id_str,
                    "ind": next_step,
                    "tool_name": next_tool_name,
                    "tool_input": next_tool_input,
                    "tool_call_id": next_tool_call_id,
                    "gateway_id": next_tool.get("gateway_id", "__local__"),
                })
            elif is_connector:
                # Connector tool already always-allowed — execute server-side
                # immediately, then feed the result back through
                # handle_tool_result so remaining pending tools are processed.
                from onyx.agents.bud_agent.connector_service import (
                    execute_connector_tool,
                )
                user = None
                if self._user_email:
                    from onyx.db.users import get_user_by_email
                    with self._get_db_session() as db_session:
                        user = get_user_by_email(self._user_email, db_session)

                if user is None:
                    await self.handle_tool_result({
                        "session_id": session_id_str,
                        "tool_call_id": next_tool_call_id,
                        "error": "Could not resolve user for connector tool execution",
                    })
                else:
                    result, err = await execute_connector_tool(
                        user=user,
                        session_id=session_id,
                        tool_name=next_tool_name,
                        tool_input=next_tool_input,
                        tool_call_id=next_tool_call_id,
                    )
                    await self.handle_tool_result({
                        "session_id": session_id_str,
                        "tool_call_id": next_tool_call_id,
                        **({"output": result} if result else {}),
                        **({"error": err} if err else {}),
                    })
            else:
                await self._emit(
                    "tool:request",
                    self._build_tool_request_payload(
                        session_id_str,
                        next_step,
                        next_tool_name,
                        next_tool_input,
                        next_tool_call_id,
                    ),
                )
                # Status stays AWAITING_TOOL
            return

        # All pending tools done -- start new LLM turn
        with self._get_db_session() as db_session:
            set_session_execution_status(
                db_session, session_id, AgentSessionExecutionStatus.RUNNING
            )
            # Drain async events before the next LLM turn
            self._drain_pending_events(db_session, session_id)

        await self._run_llm_turn(
            session_id=session_id,
            workspace_path=self._workspace_path,
            model=self._model,
            timezone=self._timezone,
        )

    async def handle_approval(self, data: dict[str, Any]) -> None:
        """User approved or denied a tool -- execute or skip."""
        session_id_str: str = data.get("session_id", "")
        tool_call_id: str = data.get("tool_call_id", "")
        approved: bool = data.get("approved", False)

        if not session_id_str or not tool_call_id:
            logger.warning("tool:approval missing session_id or tool_call_id")
            return

        try:
            session_id = UUID(session_id_str)
        except ValueError:
            logger.warning("tool:approval invalid session_id: %s", session_id_str)
            return

        with self._get_db_session() as db_session:
            # Status check
            exec_status = get_session_execution_status(db_session, session_id)
            if exec_status != AgentSessionExecutionStatus.AWAITING_APPROVAL:
                logger.info(
                    "tool:approval stale (status=%s) session=%s",
                    exec_status,
                    session_id,
                )
                return

            tool_msg = get_tool_message(db_session, session_id, tool_call_id)
            if tool_msg is None:
                logger.warning(
                    "tool:approval no tool message found session=%s tool_call_id=%s",
                    session_id,
                    tool_call_id,
                )
                return

            tool_name = tool_msg.tool_name or "unknown"
            tool_input = tool_msg.tool_input or {}
            step = tool_msg.step_number or 0

        logger.info(
            "tool:approval session=%s tool=%s approved=%s",
            session_id,
            tool_name,
            approved,
        )

        if not approved:
            # Persist denial as tool result and continue LLM turn
            with self._get_db_session() as db_session:
                update_tool_message_result(
                    db_session=db_session,
                    session_id=session_id,
                    tool_call_id=tool_call_id,
                    tool_error="User denied tool execution",
                )

                # Check for remaining pending local tools
                remaining = load_pending_local_tools(db_session, session_id)
                if remaining:
                    # Clear pending and continue to next LLM turn with all
                    # remaining tools treated as denied
                    persist_pending_local_tools(db_session, session_id, [])

                set_session_execution_status(
                    db_session, session_id, AgentSessionExecutionStatus.RUNNING
                )

            # Emit the denial as tool:delta for the UI
            await self._emit("tool:delta", {
                "session_id": session_id_str,
                "ind": step,
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
                "response_type": "error",
                "data": "User denied tool execution",
            })

            await self._run_llm_turn(
                session_id=session_id,
                workspace_path=self._workspace_path,
                model=self._model,
                timezone=self._timezone,
            )
            return

        # Approved — check if this is a connector tool (server-side execution)
        # or a local tool (client-side execution via tool:request).
        from onyx.agents.bud_agent.tool_definitions import is_connector_tool

        if is_connector_tool(tool_name):
            # Connector tool: execute server-side via MCP gateway.
            await self._execute_and_continue_connector_tool(
                session_id=session_id,
                session_id_str=session_id_str,
                tool_name=tool_name,
                tool_input=tool_input,
                tool_call_id=tool_call_id,
                step=step,
            )
            return

        # Local tool: send tool:request and set AWAITING_TOOL
        with self._get_db_session() as db_session:
            set_session_execution_status(
                db_session, session_id, AgentSessionExecutionStatus.AWAITING_TOOL
            )

        await self._emit(
            "tool:request",
            self._build_tool_request_payload(
                session_id_str, step, tool_name, tool_input, tool_call_id,
            ),
        )
        # STOP -- client will send tool:result later

    async def _execute_and_continue_connector_tool(
        self,
        session_id: UUID,
        session_id_str: str,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
        step: int,
    ) -> None:
        """Execute an already-approved connector tool server-side, then continue.

        Used by ``handle_approval()`` and ``handle_tool_result()`` when a
        connector tool doesn't need further approval (already always-allowed
        or just approved).
        """
        from onyx.agents.bud_agent.connector_service import (
            execute_connector_tool,
        )

        with self._get_db_session() as db_session:
            set_session_execution_status(
                db_session, session_id,
                AgentSessionExecutionStatus.RUNNING,
            )
            user = None
            if self._user_email:
                from onyx.db.users import get_user_by_email
                user = get_user_by_email(self._user_email, db_session)

        if user is None:
            error = "Could not resolve user for connector tool execution"
            logger.warning(
                "_execute_and_continue_connector_tool: %s (email=%s)",
                error, self._user_email,
            )
            await self._emit("tool:delta", {
                "session_id": session_id_str,
                "ind": step,
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
                "response_type": "error",
                "data": error,
            })
            await self._run_llm_turn(
                session_id=session_id,
                workspace_path=self._workspace_path,
                model=self._model,
                timezone=self._timezone,
            )
            return

        result, error = await execute_connector_tool(
            user=user,
            session_id=session_id,
            tool_name=tool_name,
            tool_input=tool_input,
            tool_call_id=tool_call_id,
        )

        # Persist result to DB and clear pending tools
        with self._get_db_session() as db_session:
            if error:
                update_tool_message_result(
                    db_session=db_session,
                    session_id=session_id,
                    tool_call_id=tool_call_id,
                    tool_error=error,
                )
            else:
                update_tool_message_result(
                    db_session=db_session,
                    session_id=session_id,
                    tool_call_id=tool_call_id,
                    tool_output={"output": result},
                )
            persist_pending_local_tools(db_session, session_id, [])

        # Emit result to UI
        await self._emit("tool:delta", {
            "session_id": session_id_str,
            "ind": step,
            "tool_name": tool_name,
            "tool_call_id": tool_call_id,
            "response_type": "error" if error else "success",
            "data": error or result,
        })

        # Continue LLM turn
        await self._run_llm_turn(
            session_id=session_id,
            workspace_path=self._workspace_path,
            model=self._model,
            timezone=self._timezone,
        )

    async def handle_stop(self, data: dict[str, Any]) -> dict[str, Any]:
        """Stop a running execution.

        Returns an ack dict.
        """
        session_id_str: str = data.get("session_id", "")

        if not session_id_str:
            return {"error": "session_id is required", "code": "INVALID_REQUEST"}

        try:
            session_id = UUID(session_id_str)
        except ValueError:
            return {"error": "Invalid session_id", "code": "INVALID_REQUEST"}

        with self._get_db_session() as db_session:
            try:
                exec_status = get_session_execution_status(db_session, session_id)
            except ValueError:
                return {"error": "Session not found", "code": "INVALID_SESSION"}

            if exec_status == AgentSessionExecutionStatus.RUNNING:
                # LLM is streaming -- set stop flag in Redis
                redis_client = self._get_redis()
                set_session_stop_flag(redis_client, session_id)
                # agent:stopped will be emitted by _run_llm_turn when it
                # detects the flag
                logger.info("agent:stop set stop flag session=%s", session_id)

            elif exec_status in (
                AgentSessionExecutionStatus.AWAITING_TOOL,
                AgentSessionExecutionStatus.AWAITING_APPROVAL,
            ):
                # Nothing running -- just set to IDLE
                set_session_execution_status(
                    db_session, session_id, AgentSessionExecutionStatus.IDLE
                )
                # Clear pending local tools
                persist_pending_local_tools(db_session, session_id, [])

                logger.info("agent:stop set IDLE session=%s", session_id)
                await self._emit("agent:stopped", {"session_id": session_id_str})

            else:
                # Already IDLE -- no-op
                logger.info("agent:stop already idle session=%s", session_id)

        return {"session_id": session_id_str}

    async def handle_file_sync(self, data: dict[str, Any]) -> None:
        """Sync a workspace file from the client."""
        session_id_str: str = data.get("session_id", "")
        file_path: str = data.get("file_path", "")
        content: str = data.get("content", "")

        if not file_path:
            logger.warning("file:sync missing file_path")
            return

        user_id = self._parse_user_id()
        if user_id is None:
            logger.warning("file:sync requires authenticated user")
            return

        with self._get_db_session() as db_session:
            upsert_workspace_file(
                db_session=db_session,
                user_id=user_id,
                path=file_path.strip(),
                content=content,
            )

        logger.info(
            "file:sync session=%s file=%s len=%d",
            session_id_str,
            file_path,
            len(content),
        )

    # ------------------------------------------------------------------
    # _run_llm_turn -- the core LLM execution via TurnDriver
    # ------------------------------------------------------------------

    async def _run_llm_turn(
        self,
        session_id: UUID,
        workspace_path: str | None = None,
        model: str | None = None,
        timezone: str | None = None,
    ) -> None:
        """Single LLM call via TurnDriver.  Streams response via emitter.

        No loop kept alive -- if a local tool is needed, TurnDriver
        dispatches via the SocketIOToolRequester and returns.  The client's
        ``tool:result`` triggers a new call to this method.
        """
        session_id_str = str(session_id)

        try:
            # Load user and build context
            with self._get_db_session() as db_session:
                user = self._load_user(db_session)
                if user is None:
                    await self._emit("agent:error", {
                        "session_id": session_id_str,
                        "error": "Cannot run agent without authenticated user",
                    })
                    set_session_execution_status(
                        db_session, session_id, AgentSessionExecutionStatus.IDLE
                    )
                    return

                # Load session to get workspace_path if not provided
                agent_session = get_session_for_user(
                    db_session, session_id, user.id
                )
                if agent_session is None:
                    await self._emit("agent:error", {
                        "session_id": session_id_str,
                        "error": "Session not found",
                    })
                    return

                resolved_workspace_path = (
                    workspace_path
                    or agent_session.workspace_path
                )

                # Load always-allowed tools for approval checks
                always_allowed_tools = self._load_always_allowed_tools(
                    db_session, user.id
                )

                # Create local tool stubs
                local_tool_stubs = self._create_local_tool_stubs()

                ctx = build_agent_run_context(
                    session_id=session_id,
                    user=user,
                    db_session=db_session,
                    search_query=self._search_query,
                    mode=AgentExecutionMode.INTERACTIVE,
                    local_tools=local_tool_stubs,
                    redis_client=self._get_redis(),
                    tenant_id=self._tenant_id,
                    workspace_path=resolved_workspace_path,
                    model=model,
                    timezone=timezone,
                    blocking_tools=False,  # Socket.IO: no Redis blocking
                )

                # Cache LLM credentials so tool:request payloads for
                # cli_agent can include the API key / base / model the
                # session is using.
                try:
                    self._llm_config = {
                        "api_key": ctx.llm.config.api_key or "",
                        "api_base": getattr(ctx.llm.config, "api_base", None),
                        "model": ctx.model_name,
                    }
                except Exception:
                    pass  # Non-critical: cli_agent will fall back to its own config

                # Release DB connection (tools captured in closures will
                # check out fresh connections automatically)
                db_session.rollback()

                # Build message history
                messages = build_message_history(
                    db_session=db_session,
                    session_id=session_id,
                    system_prompt=ctx.system_prompt,
                )

                step_number = get_next_step_number(db_session, session_id)

            # Check if history exceeds compaction threshold
            history_chars = sum(
                len(str(m.get("content", "")))
                for m in messages
                if m.get("role") != "system"
            )
            if history_chars > COMPACTION_THRESHOLD_CHARS:
                new_session_id = await self._handle_compaction(
                    session_id=session_id,
                    user=user,
                    ctx=ctx,
                    workspace_path=resolved_workspace_path,
                    model=model,
                    timezone=timezone,
                )
                if new_session_id is not None:
                    session_id = new_session_id
                    session_id_str = str(session_id)
                    # Rebuild messages for the new session
                    with self._get_db_session() as db_session:
                        ctx = build_agent_run_context(
                            session_id=session_id,
                            user=user,
                            db_session=db_session,
                            search_query=self._search_query,
                            mode=AgentExecutionMode.INTERACTIVE,
                            local_tools=local_tool_stubs,
                            redis_client=self._get_redis(),
                            tenant_id=self._tenant_id,
                            workspace_path=resolved_workspace_path,
                            model=model,
                            timezone=timezone,
                            blocking_tools=False,
                        )
                        db_session.rollback()
                        messages = build_message_history(
                            db_session=db_session,
                            session_id=session_id,
                            system_prompt=ctx.system_prompt,
                        )
                        step_number = get_next_step_number(db_session, session_id)

            # Create TurnDriver with SocketIO emitter + requester
            redis_client = self._get_redis()

            emitter = SocketIOEmitter(
                sio=self._sio,
                session_id=session_id_str,
                search_context=ctx.search_context,
            )

            requester = SocketIOToolRequester(
                sio=self._sio,
                session_id=session_id_str,
                always_allowed_tools=always_allowed_tools,
                connector_approval_tools=ctx.connector_approval_tools,
                connector_gateway_map=ctx.connector_approval_gateway,
            )

            config = TurnDriverConfig(
                mode=AgentExecutionMode.INTERACTIVE,
                max_tool_calls=MAX_TOOL_CALLS,
                should_stop=lambda: is_session_stopped(redis_client, session_id),
                emitter=emitter,
                tool_requester=requester,
                # Use a session factory so TurnDriver opens short-lived
                # sessions for each DB operation instead of holding one
                # connection during potentially-long LLM streaming.
                get_db_session=self._get_db_session,
            )
            driver = TurnDriver(config, ctx)

            # Run the LLM turn via TurnDriver.
            # db_session is unused when get_db_session factory is set —
            # TurnDriver opens fresh sessions for each persistence op.
            with self._get_db_session() as db_session:
                result = await driver.run_next_turn(
                    session_id=session_id,
                    db_session=db_session,
                    messages=messages,
                    step_number=step_number,
                )

            # Handle result status
            if result.status == "complete":
                # Fetch the latest assistant message ID so the frontend can
                # update its optimistic ID with the real DB UUID.
                assistant_message_id: str | None = None
                with self._get_db_session() as db_session:
                    set_session_execution_status(
                        db_session, session_id, AgentSessionExecutionStatus.IDLE
                    )
                    from sqlalchemy import select as _select
                    from onyx.db.models import AgentMessage as _AM
                    latest_assistant = db_session.execute(
                        _select(_AM.id)
                        .where(
                            _AM.session_id == session_id,
                            _AM.role == AgentMessageRole.ASSISTANT,
                            _AM.content.isnot(None),
                            _AM.content != "",
                        )
                        .order_by(_AM.created_at.desc())
                        .limit(1)
                    ).scalar_one_or_none()
                    if latest_assistant is not None:
                        assistant_message_id = str(latest_assistant)

                if assistant_message_id is not None:
                    await self._sio.emit(
                        "agent:message_ids",
                        {
                            "session_id": session_id_str,
                            "assistant_message_id": assistant_message_id,
                        },
                        room=self._sid,
                    )

                await self._emit("agent:done", {"session_id": session_id_str})

            elif result.status == "stopped":
                with self._get_db_session() as db_session:
                    set_session_execution_status(
                        db_session, session_id, AgentSessionExecutionStatus.IDLE
                    )
                    clear_session_stop_flag(redis_client, session_id)
                await self._emit("agent:stopped", {"session_id": session_id_str})

            elif result.status == "awaiting_tool":
                # TurnDriver set AWAITING_TOOL and dispatched via requester.
                # If the requester determined approval is needed, upgrade
                # the status to AWAITING_APPROVAL.
                if requester.last_request_needs_approval:
                    with self._get_db_session() as db_session:
                        set_session_execution_status(
                            db_session,
                            session_id,
                            AgentSessionExecutionStatus.AWAITING_APPROVAL,
                        )

            elif result.status == "max_tools_reached":
                with self._get_db_session() as db_session:
                    set_session_execution_status(
                        db_session, session_id, AgentSessionExecutionStatus.IDLE
                    )
                await self._emit("agent:done", {"session_id": session_id_str})

        except Exception as exc:
            logger.exception(
                "AgentHandler._run_llm_turn error session=%s", session_id
            )
            await self._emit("agent:error", {
                "session_id": session_id_str,
                "error": str(exc),
            })
            try:
                with self._get_db_session() as db_session:
                    set_session_execution_status(
                        db_session, session_id, AgentSessionExecutionStatus.IDLE
                    )
            except Exception:
                logger.warning("Failed to reset execution status", exc_info=True)

    # ------------------------------------------------------------------
    # Compaction
    # ------------------------------------------------------------------

    async def _handle_compaction(
        self,
        session_id: UUID,
        user: User,
        ctx: AgentRunContext,
        workspace_path: str | None,
        model: str | None,
        timezone: str | None,
    ) -> UUID | None:
        """Attempt session compaction.  Returns new session_id or None."""
        try:
            with self._get_db_session() as db_session:
                result = compact_session(
                    db_session=db_session,
                    session_id=session_id,
                    user=user,
                    user_message="",  # message already persisted
                    llm=ctx.llm,
                    workspace_path=workspace_path,
                )

            if result is None:
                return None

            new_session_id, summary = result

            await self._emit("agent:session_compacted", {
                "session_id": str(session_id),
                "new_session_id": str(new_session_id),
                "summary": summary,
            })

            logger.info(
                "Compacted session %s -> new session %s",
                session_id,
                new_session_id,
            )
            return new_session_id

        except Exception:
            logger.warning(
                "Compaction failed for session %s, falling back to truncation",
                session_id,
                exc_info=True,
            )
            return None
