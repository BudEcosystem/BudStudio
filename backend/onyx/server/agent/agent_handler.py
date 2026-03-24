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
- ``_run_llm_turn``: build agent, call LLM, stream events, handle tool
  calls, set execution_status at each state change
"""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from collections.abc import Generator
from typing import Any
from uuid import UUID

import redis
import socketio  # type: ignore[import-untyped]
from agents import RawResponsesStreamEvent, ToolCallItem
from agents.run import Runner
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
    is_local_tool,
    requires_approval,
)
from onyx.db.agent import (
    add_session_message,
    add_tool_message,
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
    update_session_stats,
    update_tool_message_result,
    upsert_workspace_file,
)
from onyx.db.agent_connector import get_tool_permissions
from onyx.db.engine.sql_engine import get_session_with_tenant
from onyx.db.enums import (
    AgentMessageRole,
    AgentSessionExecutionStatus,
    AgentToolPermissionLevel,
)
from onyx.db.models import User
from onyx.redis.redis_pool import get_redis_client
from onyx.utils.logger import setup_logger

logger = setup_logger()

# Compaction threshold in characters (matches orchestrator.py)
COMPACTION_THRESHOLD_CHARS = 300_000
# Maximum tool calls before forcing a stop
MAX_TOOL_CALLS = 500
# Check stop flag every N stream events (not every token -- too expensive)
STOP_CHECK_INTERVAL = 10


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

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @contextmanager
    def _get_db_session(self) -> Generator[Session, None, None]:
        """Create a short-lived DB session."""
        with get_session_with_tenant(tenant_id=self._tenant_id) as session:
            yield session

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
            add_session_message(
                db_session=db_session,
                session_id=session_id,
                role=AgentMessageRole.USER,
                content=message,
            )

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
            # Connector tools that need approval are identified by
            # is_connector_tool() — they always need approval unless
            # the user has "always allow"ed them (which upgrades
            # their permission to ALWAYS_ALLOW, so they never appear
            # in the pending queue as connector-pause tools).
            from onyx.agents.bud_agent.tool_definitions import is_connector_tool
            always_allowed = set()
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
                await self._emit("tool:request", {
                    "session_id": session_id_str,
                    "ind": next_step,
                    "tool_name": next_tool_name,
                    "tool_input": next_tool_input,
                    "tool_call_id": next_tool_call_id,
                })
                # Status stays AWAITING_TOOL
            return

        # All pending tools done -- start new LLM turn
        with self._get_db_session() as db_session:
            set_session_execution_status(
                db_session, session_id, AgentSessionExecutionStatus.RUNNING
            )

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

        await self._emit("tool:request", {
            "session_id": session_id_str,
            "ind": step,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "tool_call_id": tool_call_id,
        })
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
    # _run_llm_turn -- the core LLM execution
    # ------------------------------------------------------------------

    async def _run_llm_turn(
        self,
        session_id: UUID,
        workspace_path: str | None = None,
        model: str | None = None,
        timezone: str | None = None,
    ) -> None:
        """Single LLM call.  Streams response.  Stops at tool_use or end.

        No loop kept alive -- if a local tool is needed, we send the request
        and return.  The client's ``tool:result`` triggers a new call to this
        method.
        """
        session_id_str = str(session_id)

        try:
            # Load user and build context
            with self._get_db_session() as db_session:
                user = self._load_user(db_session)
                if user is None:
                    # Auth disabled mode -- we cannot proceed without a user
                    # for tool/context assembly
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

                # Build the agent context.
                # We pass local_tools=[] because for Socket.IO we do NOT use
                # the on_invoke_tool callbacks (we handle tool calls after the
                # stream completes).  Local tool schemas are already registered
                # in agent_context via their FunctionTool definitions.
                # Create stub FunctionTools for local tools so the LLM
                # sees their schemas. Actual execution happens client-side
                # via tool:request/tool:result over Socket.IO.
                from onyx.agents.bud_agent.tool_definitions import (
                    LOCAL_TOOL_SCHEMAS,
                )
                from agents import FunctionTool

                local_tool_stubs: list[FunctionTool] = []
                for schema in LOCAL_TOOL_SCHEMAS.values():
                    async def _stub_handler(
                        _ctx: Any, _args: str,
                        _name: str = schema["name"],
                    ) -> str:
                        return f"AWAITING_LOCAL_EXECUTION:{_name}"

                    local_tool_stubs.append(
                        FunctionTool(
                            name=schema["name"],
                            description=schema.get("description", ""),
                            params_json_schema=schema.get("parameters", {}),
                            on_invoke_tool=_stub_handler,
                        )
                    )

                ctx = build_agent_run_context(
                    session_id=session_id,
                    user=user,
                    db_session=db_session,
                    user_message="",  # message already persisted
                    mode=AgentExecutionMode.INTERACTIVE,
                    local_tools=local_tool_stubs,
                    redis_client=self._get_redis(),
                    tenant_id=self._tenant_id,
                    workspace_path=resolved_workspace_path,
                    model=model,
                    timezone=timezone,
                    blocking_tools=False,  # Socket.IO: no Redis blocking
                )

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
                            user_message="",
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

            # Run the LLM via the Agents SDK
            await self._stream_and_handle(
                session_id=session_id,
                session_id_str=session_id_str,
                ctx=ctx,
                messages=messages,
                step_number=step_number,
                user=user,
                always_allowed_tools=always_allowed_tools,
                workspace_path=resolved_workspace_path,
                model=model,
                timezone=timezone,
            )

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

    async def _stream_and_handle(
        self,
        session_id: UUID,
        session_id_str: str,
        ctx: AgentRunContext,
        messages: list[dict[str, Any]],
        step_number: int,
        user: User,
        always_allowed_tools: set[str],
        workspace_path: str | None,
        model: str | None,
        timezone: str | None,
    ) -> None:
        """Stream LLM output and handle tool calls."""
        redis_client = self._get_redis()
        search_context = ctx.search_context

        # Citation processing state
        citation_pattern = re.compile(
            r"(\[\[\d+\]\])|(\[\d+(?:, ?\d+)*\])"
        )
        possible_citation_pattern = re.compile(
            r"(\[+(?:\d+,? ?)*$)"
        )
        citation_buffer = ""
        emitted_citation_doc_ids: set[str] = set()

        # Section tracking
        message_started = False
        reasoning_started = False
        full_response_text = ""
        processed_response_text = ""
        thinking_content = ""
        tool_call_count = 0

        # Pending tool calls collected from the stream
        pending_tool_calls: list[dict[str, Any]] = []

        # Start the streamed run
        streamed = Runner.run_streamed(
            ctx.agent,
            messages,  # type: ignore[arg-type]
            run_config=ctx.run_config,
        )

        event_counter = 0
        stopped = False

        async for event in streamed.stream_events():
            event_counter += 1

            # Periodically check stop flag
            if event_counter % STOP_CHECK_INTERVAL == 0:
                if is_session_stopped(redis_client, session_id):
                    try:
                        streamed.cancel()
                    except Exception:
                        pass
                    stopped = True
                    break

            # Handle streaming text deltas
            if isinstance(event, RawResponsesStreamEvent):
                # Reasoning/thinking content
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
                        await self._emit("agent:reasoning_start", {
                            "session_id": session_id_str,
                            "ind": step_number,
                        })
                        reasoning_started = True
                    thinking_content += event.data.delta
                    await self._emit("agent:reasoning_delta", {
                        "session_id": session_id_str,
                        "ind": step_number,
                        "reasoning": event.data.delta,
                    })

                # Output text
                elif (
                    event.data.type == "response.output_text.delta"
                    and len(event.data.delta) > 0
                ):
                    full_response_text += event.data.delta

                    if not message_started:
                        # Close reasoning section if it was started
                        if reasoning_started:
                            await self._emit("agent:section_end", {
                                "session_id": session_id_str,
                                "ind": step_number,
                            })
                        step_number += 1
                        await self._emit("agent:message_start", {
                            "session_id": session_id_str,
                            "ind": step_number,
                            "content": "",
                            "final_documents": None,
                        })
                        message_started = True

                    # Process citations when search context has documents
                    if search_context.should_cite:
                        processed, new_citations = self._process_citation_token(
                            event.data.delta,
                            citation_buffer,
                            citation_pattern,
                            possible_citation_pattern,
                            emitted_citation_doc_ids,
                            search_context,
                        )
                        citation_buffer = processed[1]  # updated buffer
                        text_out = processed[0]
                        if text_out:
                            processed_response_text += text_out
                            await self._emit("agent:message_delta", {
                                "session_id": session_id_str,
                                "ind": step_number,
                                "content": text_out,
                            })
                        if new_citations:
                            await self._emit("agent:citation", {
                                "session_id": session_id_str,
                                "ind": step_number,
                                "citations": [
                                    {
                                        "citation_num": c["citation_num"],
                                        "document_id": c["document_id"],
                                    }
                                    for c in new_citations
                                ],
                            })
                    else:
                        processed_response_text += event.data.delta
                        await self._emit("agent:message_delta", {
                            "session_id": session_id_str,
                            "ind": step_number,
                            "content": event.data.delta,
                        })

            # Detect tool calls
            if isinstance(getattr(event, "item", None), ToolCallItem):
                tool_call_count += 1
                raw = getattr(event.item, "raw_item", None)
                tc_name = (
                    (getattr(raw, "name", None) or (raw.get("name") if isinstance(raw, dict) else None) or "unknown")
                    .replace("\n", " ")
                )
                tc_id = (
                    getattr(raw, "call_id", None)
                    or (raw.get("call_id") if isinstance(raw, dict) else None)
                    or ""
                )
                tc_args_str = (
                    getattr(raw, "arguments", None)
                    or (raw.get("arguments") if isinstance(raw, dict) else None)
                    or "{}"
                )
                try:
                    tc_input = json.loads(tc_args_str) if isinstance(tc_args_str, str) else tc_args_str
                except (json.JSONDecodeError, TypeError):
                    tc_input = {"raw": tc_args_str}

                pending_tool_calls.append({
                    "name": tc_name,
                    "input": tc_input,
                    "id": tc_id,
                })
                logger.info(
                    "Tool call #%d: %s (session %s)",
                    tool_call_count,
                    tc_name,
                    session_id,
                )

        # --- Stream complete ---

        if stopped:
            # Close any open section
            if message_started or reasoning_started:
                await self._emit("agent:section_end", {
                    "session_id": session_id_str,
                    "ind": step_number,
                })
            await self._emit("agent:stopped", {"session_id": session_id_str})
            with self._get_db_session() as db_session:
                set_session_execution_status(
                    db_session, session_id, AgentSessionExecutionStatus.IDLE
                )
                clear_session_stop_flag(redis_client, session_id)
            return

        # Close the text/reasoning section
        if message_started or reasoning_started:
            await self._emit("agent:section_end", {
                "session_id": session_id_str,
                "ind": step_number,
            })

        # Final drain of packet queue (tools may have emitted packets
        # Persist assistant message.
        # Always persist when there's text, thinking, or tool calls so that
        # build_message_history can reconstruct reasoning blocks for
        # providers that require reasoning_content on every assistant turn.
        persist_content = (
            processed_response_text
            if processed_response_text
            else full_response_text
        ) or None
        if persist_content or thinking_content or pending_tool_calls:
            with self._get_db_session() as db_session:
                add_session_message(
                    db_session=db_session,
                    session_id=session_id,
                    role=AgentMessageRole.ASSISTANT,
                    content=persist_content or "",
                    step_number=step_number,
                    thinking_content=thinking_content or None,
                )
                update_session_stats(
                    db_session, session_id, tool_calls=tool_call_count
                )

        # Handle tool calls
        if not pending_tool_calls:
            # No tools -- we're done
            with self._get_db_session() as db_session:
                set_session_execution_status(
                    db_session, session_id, AgentSessionExecutionStatus.IDLE
                )
            await self._emit("agent:done", {"session_id": session_id_str})
            return

        # Separate local vs remote tool calls.
        # ask_user_questions is treated as a "pause" tool (like local tools):
        # emit the request and stop, wait for the user's answer via
        # tool:result.  It must NOT block the event loop with Redis BLPOP.
        # Connector tools that need approval are also pause tools — their
        # on_invoke_tool returned a stub during streaming; actual execution
        # happens in handle_approval() after the user approves.
        PAUSE_TOOLS = {"ask_user_questions"}
        connector_pause = ctx.connector_approval_tools

        local_calls: list[dict[str, Any]] = []
        remote_calls: list[dict[str, Any]] = []
        for tc in pending_tool_calls:
            if (
                is_local_tool(tc["name"])
                or tc["name"] in PAUSE_TOOLS
                or tc["name"] in connector_pause
            ):
                local_calls.append(tc)
            else:
                remote_calls.append(tc)

        # Remote tools were already executed by the SDK's on_invoke_tool
        # callbacks during Runner.run_streamed(). Those callbacks persist
        # the TOOL message (with output) to the DB. We only need to emit
        # UI events here — do NOT create duplicate TOOL rows.
        #
        # Pre-load tool results from DB once (reversed = newest first).
        # Use a consumed-index set so duplicate tool names each get
        # their own result row.
        step_number += 1

        db_tool_rows: list[Any] = []
        if remote_calls:
            try:
                with self._get_db_session() as db_session:
                    from onyx.db.agent import get_session_messages
                    all_msgs = get_session_messages(
                        db_session=db_session,
                        session_id=session_id,
                    )
                    db_tool_rows = [
                        m for m in reversed(all_msgs)
                        if m.role == AgentMessageRole.TOOL
                    ]
            except Exception:
                logger.debug(
                    "Could not load tool results for session %s",
                    session_id,
                )

        consumed: set[int] = set()

        for tc in remote_calls:
            tc_name = tc["name"]
            tc_id = tc["id"]

            await self._emit("tool:start", {
                "session_id": session_id_str,
                "ind": step_number,
                "tool_name": tc_name,
                "tool_call_id": tc_id,
            })

            # Find the most recent unconsumed DB row for this tool_name
            tool_data: Any = None
            openui_resp: str | None = None
            for idx, tm in enumerate(db_tool_rows):
                if idx in consumed:
                    continue
                if tm.tool_name == tc_name:
                    tool_data = tm.tool_output
                    if isinstance(tool_data, dict):
                        openui_resp = tool_data.get("openui_lang")
                    consumed.add(idx)
                    break

            await self._emit("tool:delta", {
                "session_id": session_id_str,
                "ind": step_number,
                "tool_name": tc_name,
                "tool_call_id": tc_id,
                "response_type": "success",
                "data": tool_data,
                **({"openui_response": openui_resp} if openui_resp else {}),
            })

            step_number += 1

        # If there are local tools, dispatch the first one
        if local_calls:
            first_local = local_calls[0]
            rest_local = local_calls[1:]

            tc_name = first_local["name"]
            tc_input = first_local["input"]
            tc_id = first_local["id"]

            # Persist tool message
            with self._get_db_session() as db_session:
                add_tool_message(
                    db_session=db_session,
                    session_id=session_id,
                    tool_name=tc_name,
                    tool_input=tc_input,
                    tool_call_id=tc_id,
                    step_number=step_number,
                )

                # Persist remaining local tools as pending
                if rest_local:
                    # Include step info and gateway_id for each pending tool
                    for i, tc in enumerate(rest_local):
                        tc["step"] = step_number + i + 1
                        # Annotate connector tools with their gateway_id
                        # so handle_tool_result can pass it in approval events.
                        gw = ctx.connector_approval_gateway.get(tc["name"])
                        if gw:
                            tc["gateway_id"] = gw
                        # Also persist tool messages for pending tools
                        add_tool_message(
                            db_session=db_session,
                            session_id=session_id,
                            tool_name=tc["name"],
                            tool_input=tc["input"],
                            tool_call_id=tc["id"],
                            step_number=tc["step"],
                        )
                    persist_pending_local_tools(db_session, session_id, rest_local)
                else:
                    persist_pending_local_tools(db_session, session_id, [])

            await self._emit("tool:start", {
                "session_id": session_id_str,
                "ind": step_number,
                "tool_name": tc_name,
                "tool_call_id": tc_id,
            })

            # Check if approval is needed (local tools via APPROVAL_REQUIRED_TOOLS,
            # or connector tools that were classified as pause tools).
            needs_approval = (
                (requires_approval(tc_name) or tc_name in connector_pause)
                and tc_name not in always_allowed_tools
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
                    "ind": step_number,
                    "tool_name": tc_name,
                    "tool_input": tc_input,
                    "tool_call_id": tc_id,
                    "gateway_id": ctx.connector_approval_gateway.get(
                        tc_name, "__local__"
                    ),
                })
            else:
                with self._get_db_session() as db_session:
                    set_session_execution_status(
                        db_session,
                        session_id,
                        AgentSessionExecutionStatus.AWAITING_TOOL,
                    )
                await self._emit("tool:request", {
                    "session_id": session_id_str,
                    "ind": step_number,
                    "tool_name": tc_name,
                    "tool_input": tc_input,
                    "tool_call_id": tc_id,
                })
            # STOP -- client will send tool:result or tool:approval
            return

        # Persist TOOL rows for remote tools that did NOT self-persist.
        # Extract actual tool outputs from the SDK's streamed result
        # (ToolCallOutputItem.raw_item has call_id + output string).
        # Tools like web_search/open_url/render_artifact self-persist
        # via on_invoke_tool; the rest (workspace_read, memory_search,
        # send_message, etc.) need this.
        try:
            from agents.items import ToolCallOutputItem

            # Build a map: call_id -> output string from SDK results
            sdk_outputs: dict[str, str] = {}
            for item in streamed.new_items:
                if isinstance(item, ToolCallOutputItem):
                    raw = item.raw_item
                    if hasattr(raw, "call_id") and hasattr(raw, "output"):
                        sdk_outputs[raw.call_id] = raw.output

            with self._get_db_session() as db_session:
                # Check which tools already have DB rows
                from onyx.db.agent import get_session_messages
                existing_tool_names: set[str] = set()
                for m in get_session_messages(db_session, session_id):
                    if m.role == AgentMessageRole.TOOL and m.tool_name:
                        existing_tool_names.add(m.tool_name)

                for tc in remote_calls:
                    tc_name = tc["name"]
                    tc_sdk_id = tc["id"]
                    # Skip if the tool already self-persisted a row
                    if tc_name in existing_tool_names:
                        existing_tool_names.discard(tc_name)  # consume
                        continue
                    # Get the output from SDK results
                    output_str = sdk_outputs.get(tc_sdk_id, "")
                    try:
                        output_val = json.loads(output_str) if output_str else None
                    except (json.JSONDecodeError, TypeError):
                        output_val = {"output": output_str} if output_str else None

                    add_tool_message(
                        db_session=db_session,
                        session_id=session_id,
                        tool_name=tc_name,
                        tool_input=tc["input"],
                        tool_call_id=tc_sdk_id,
                        step_number=step_number,
                    )
                    if output_val is not None:
                        update_tool_message_result(
                            db_session=db_session,
                            session_id=session_id,
                            tool_call_id=tc_sdk_id,
                            tool_output=output_val,
                        )
        except Exception:
            logger.warning(
                "Failed to persist non-self-persisting tool rows",
                exc_info=True,
            )

        # All tools were remote -- the Agent SDK already executed them during
        # the stream (via on_invoke_tool callbacks).  Since the agent is
        # configured with stop_on_first_tool, we need to rebuild messages
        # and do another LLM turn.
        await self._run_llm_turn(
            session_id=session_id,
            workspace_path=workspace_path,
            model=model,
            timezone=timezone,
        )

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

    # ------------------------------------------------------------------
    # Citation processing
    # ------------------------------------------------------------------

    @staticmethod
    def _process_citation_token(
        token: str,
        buffer: str,
        citation_pattern: re.Pattern[str],
        possible_citation_pattern: re.Pattern[str],
        emitted_doc_ids: set[str],
        search_context: Any,
    ) -> tuple[tuple[str, str], list[dict[str, Any]]]:
        """Process a text token for citation patterns.

        Returns ``((processed_text, updated_buffer), new_citations)``.
        """
        buffer += token

        possible = bool(re.search(possible_citation_pattern, buffer))
        matches = list(citation_pattern.finditer(buffer))

        if not matches and possible:
            return ("", buffer), []

        if not matches:
            result = buffer
            return (result, ""), []

        result = ""
        new_citations: list[dict[str, Any]] = []
        last_end = 0

        for match in matches:
            result += buffer[last_end:match.start()]
            last_end = match.end()

            citation_str = match.group()
            is_formatted = match.lastindex == 1  # [[N]] format

            content = (
                citation_str[2:-2] if is_formatted else citation_str[1:-1]
            )
            for num_str in content.split(","):
                num = int(num_str.strip())
                # Look up link and doc_id from search context
                link = ""
                doc_id: str | None = None
                for section in search_context.cited_documents:
                    d_id = section.center_chunk.document_id
                    n = search_context.document_id_map.get(d_id)
                    if n == num:
                        link = section.center_chunk.source_links.get(0, "")
                        doc_id = d_id
                        break

                result += f"[[{num}]]({link})"

                if doc_id and doc_id not in emitted_doc_ids:
                    emitted_doc_ids.add(doc_id)
                    new_citations.append({
                        "citation_num": num,
                        "document_id": doc_id,
                    })

        remainder = buffer[last_end:]
        if possible and remainder:
            return (result, remainder), new_citations
        else:
            result += remainder
            return (result, ""), new_citations
