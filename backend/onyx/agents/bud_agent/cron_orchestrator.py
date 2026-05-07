"""CronAgentOrchestrator — non-SSE agent orchestrator for scheduled cron execution.

Unlike BudAgentOrchestrator, this orchestrator:
- Does NOT stream via SSE/queue — results are accumulated in memory
- Does NOT use Redis BLPOP for local tools — suspends to DB instead
- Supports suspend/resume for local tool requests
- Implements post-LLM skip checks (NO_ACTION_NEEDED, dedup)

Now uses TurnDriver as the single LLM-turn state machine instead of
the legacy ``run_sync_agent_loop()`` helper.
"""

import asyncio
import concurrent.futures
import hashlib
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from typing import Any
from uuid import UUID

from agents import FunctionTool
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.agent_context import AgentExecutionMode
from onyx.agents.bud_agent.agent_context import build_agent_run_context
from onyx.agents.bud_agent.agent_context import build_message_history
from onyx.agents.bud_agent.agent_context import compact_session
from onyx.agents.bud_agent.llm_turn import TurnResult
from onyx.agents.bud_agent.tool_definitions import LLM_HIDDEN_LOCAL_TOOLS
from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOL_SCHEMAS
from onyx.agents.bud_agent.turn_driver import TurnDriver
from onyx.agents.bud_agent.turn_driver import TurnDriverConfig
from onyx.agents.bud_agent.turn_driver import TurnDriverResult
from onyx.db.agent import add_session_message
from onyx.db.enums import AgentMessageRole
from onyx.db.models import AgentCronExecution
from onyx.db.models import AgentCronJob
from onyx.db.models import User
from onyx.utils.logger import setup_logger

logger = setup_logger()

NO_ACTION_MARKER = "NO_ACTION_NEEDED"
DEDUP_WINDOW_HOURS = 24
# Compaction threshold: same as the interactive orchestrator
COMPACTION_THRESHOLD_CHARS = 300_000


# ---------------------------------------------------------------------------
# Async bridge
# ---------------------------------------------------------------------------


def _run_async(coro: Any) -> Any:
    """Run an async coroutine from synchronous code.

    Handles the case where an event loop may already be running
    (e.g. inside Celery workers that use gevent/eventlet).
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Local tool stub builder
# ---------------------------------------------------------------------------


def _create_local_tool_stubs() -> list[FunctionTool]:
    """Create local tool stubs that return a placeholder string.

    These are the same stubs used by the interactive handler.  When the
    LLM invokes a local tool, the stub returns
    ``AWAITING_LOCAL_EXECUTION:<name>`` and TurnDriver classifies it as
    a local tool call, triggering the awaiting_tool path.

    Tools in ``LLM_HIDDEN_LOCAL_TOOLS`` are excluded — the LLM should
    use ``cli_agent`` instead of calling them directly.
    """
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


# ---------------------------------------------------------------------------
# CronRunResult
# ---------------------------------------------------------------------------


class CronRunResult:
    """Result of a cron agent run."""

    def __init__(self) -> None:
        self.response_text: str = ""
        self.tool_call_count: int = 0
        self.tokens_used: int = 0
        self.suspended: bool = False
        # Kept for backward compatibility with Celery tasks — TurnDriver
        # now persists pending tools to the DB directly, so these will
        # remain empty in the new code path.
        self.suspended_tool_name: str | None = None
        self.suspended_tool_input: dict[str, Any] | None = None
        self.suspended_tool_call_id: str | None = None
        self.suspended_messages: list[dict[str, Any]] | None = None
        self.skipped: bool = False
        self.skip_reason: str | None = None
        self.error: str | None = None
        self.new_session_id: UUID | None = None


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


class CronAgentOrchestrator:
    """Orchestrates agent execution for cron jobs.

    Accumulates results in memory instead of streaming. When a local tool
    is needed, TurnDriver persists pending tools to the DB and returns
    ``awaiting_tool``, which this orchestrator maps to ``suspended=True``.
    """

    def __init__(
        self,
        session_id: UUID,
        user: User,
        db_session: Session,
        execution: AgentCronExecution,
        cron_job: AgentCronJob,
        tenant_id: str,
        workspace_path: str | None = None,
        model: str | None = None,
    ) -> None:
        self._session_id = session_id
        self._user = user
        self._db_session = db_session
        self._execution = execution
        self._cron_job = cron_job
        self._tenant_id = tenant_id
        self._workspace_path = workspace_path
        self._model = model

    def run(self, user_message: str) -> CronRunResult:
        """Run the agent loop synchronously, returning accumulated results.

        If a local tool is requested, TurnDriver persists it to the DB
        and result.suspended is set to True.
        """
        result = CronRunResult()

        try:
            # 1. Build local tool stubs (same pattern as interactive handler)
            local_tools = _create_local_tool_stubs()

            # 2. Build full agent context
            ctx = build_agent_run_context(
                session_id=self._session_id,
                user=self._user,
                db_session=self._db_session,
                search_query=user_message,
                mode=AgentExecutionMode.CRON,
                local_tools=local_tools,
                tenant_id=self._tenant_id,
                workspace_path=self._workspace_path,
                model=self._model,
            )

            # 3. Persist user message before building history
            add_session_message(
                db_session=self._db_session,
                session_id=self._session_id,
                role=AgentMessageRole.USER,
                content=user_message,
            )
            messages = build_message_history(
                db_session=self._db_session,
                session_id=self._session_id,
                system_prompt=ctx.system_prompt,
            )

            # 3a. Check if history exceeds compaction threshold
            history_chars = sum(
                len(str(m.get("content", "")))
                for m in messages
                if m.get("role") != "system"
            )
            if history_chars > COMPACTION_THRESHOLD_CHARS:
                try:
                    compact_result = compact_session(
                        db_session=self._db_session,
                        session_id=self._session_id,
                        user=self._user,
                        user_message=user_message,
                        llm=ctx.llm,
                        workspace_path=self._workspace_path,
                    )
                    if compact_result is not None:
                        new_sid, _summary = compact_result
                        result.new_session_id = new_sid
                        self._session_id = new_sid
                        # Rebuild context for the new session
                        ctx = build_agent_run_context(
                            session_id=new_sid,
                            user=self._user,
                            db_session=self._db_session,
                            search_query=user_message,
                            mode=AgentExecutionMode.CRON,
                            local_tools=_create_local_tool_stubs(),
                            tenant_id=self._tenant_id,
                            workspace_path=self._workspace_path,
                            model=self._model,
                        )
                        messages = build_message_history(
                            db_session=self._db_session,
                            session_id=new_sid,
                            system_prompt=ctx.system_prompt,
                        )
                except Exception:
                    logger.warning(
                        "Compaction failed for cron session %s, "
                        "falling back to truncation",
                        self._session_id,
                        exc_info=True,
                    )

            # 4. Create TurnDriver and run the next turn
            driver = self._create_turn_driver(ctx)
            driver_result = _run_async(
                driver.run_next_turn(
                    session_id=self._session_id,
                    db_session=self._db_session,
                    messages=messages,
                    step_number=0,
                )
            )

            # 5. Map TurnDriverResult to CronRunResult
            self._map_driver_result(driver_result, result)

            # 6. Post-LLM skip checks (only if not suspended/errored)
            if not result.suspended and not result.error:
                self._apply_post_llm_skip_checks(result)

        except Exception as e:
            logger.exception(
                "CronAgentOrchestrator error for execution %s",
                self._execution.id,
            )
            result.error = str(e)

        return result

    def resume(
        self,
        tool_call_id: str,
        tool_name: str,
        tool_result_output: str | None,
        tool_result_error: str | None,
        # Kept for backward compatibility with existing callers (Celery task)
        # that still pass ``messages`` from suspended state.  TurnDriver
        # rebuilds messages from DB so this parameter is ignored.
        messages: list[dict[str, Any]] | None = None,
    ) -> CronRunResult:
        """Resume a suspended execution after receiving a local tool result.

        TurnDriver.handle_tool_result() handles: persisting tool result,
        loading pending tools, dispatching next or running a new LLM turn.
        """
        result = CronRunResult()

        try:
            # Rebuild context for TurnDriver
            local_tools = _create_local_tool_stubs()
            ctx = build_agent_run_context(
                session_id=self._session_id,
                user=self._user,
                db_session=self._db_session,
                search_query=self._cron_job.payload_message,
                mode=AgentExecutionMode.CRON,
                local_tools=local_tools,
                tenant_id=self._tenant_id,
                workspace_path=self._workspace_path,
                model=self._model,
            )

            # Create TurnDriver and handle the tool result
            driver = self._create_turn_driver(ctx)
            driver_result = _run_async(
                driver.handle_tool_result(
                    session_id=self._session_id,
                    db_session=self._db_session,
                    tool_call_id=tool_call_id,
                    output=tool_result_output,
                    error=tool_result_error,
                )
            )

            # Map TurnDriverResult to CronRunResult
            self._map_driver_result(driver_result, result)

            # Post-LLM skip checks
            if not result.suspended and not result.error:
                self._apply_post_llm_skip_checks(result)

        except Exception as e:
            logger.exception(
                "CronAgentOrchestrator resume error for execution %s",
                self._execution.id,
            )
            result.error = str(e)

        return result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _create_turn_driver(self, ctx: Any) -> TurnDriver:
        """Build a TurnDriver configured for cron execution.

        - No emitter (no streaming UI).
        - No tool_requester (no Socket.IO dispatch).
        - on_turn_complete reserved for future per-turn logic.
        """
        async def _on_turn_complete(turn: TurnResult) -> None:
            """Callback fired after each LLM turn completes."""
            # Nothing needed here currently — skip checks run after
            # the full driver result is returned.  This hook is
            # reserved for future per-turn logic.
            pass

        config = TurnDriverConfig(
            mode=AgentExecutionMode.CRON,
            emitter=None,
            tool_requester=None,
            on_turn_complete=_on_turn_complete,
        )
        return TurnDriver(config=config, ctx=ctx)

    def _map_driver_result(
        self,
        driver_result: TurnDriverResult,
        result: CronRunResult,
    ) -> None:
        """Map a TurnDriverResult to CronRunResult fields.

        TurnDriver already persists assistant messages and stats via
        ``persist_turn_result``, so we only need to extract the
        response text and tool counts for the CronRunResult.
        """
        status = driver_result.status

        if status == "awaiting_tool":
            result.suspended = True
            # Populate suspended_* fields from the dispatched tool info
            # so the Celery task can persist them for later resume.
            dt = driver_result.dispatched_tool
            if dt is not None:
                result.suspended_tool_name = dt.get("name")
                result.suspended_tool_input = dt.get("input")
                result.suspended_tool_call_id = dt.get("call_id")
        elif status == "max_tools_reached":
            result.error = "Maximum tool calls reached"
        elif status == "stopped":
            # Early stop signal — treat as no-action to avoid
            # spurious output injection.
            result.skipped = True
            result.skip_reason = "early-stop"

        if driver_result.turn is not None:
            turn = driver_result.turn
            result.response_text = turn.full_response_text or ""
            result.tool_call_count = turn.tool_call_count

    def _apply_post_llm_skip_checks(self, result: CronRunResult) -> None:
        """Apply post-LLM skip checks (NO_ACTION_NEEDED and dedup)."""
        response = result.response_text.strip()
        if not response:
            return

        # Check: NO_ACTION_NEEDED — any cron job can signal nothing to report
        if NO_ACTION_MARKER in response:
            result.skipped = True
            result.skip_reason = "no-action-needed"
            return

        # Check 7: Dedup — same response within 24h
        response_hash = hashlib.sha256(response.encode("utf-8")).hexdigest()
        if (
            self._cron_job.last_response_hash == response_hash
            and self._cron_job.last_response_at is not None
        ):
            last_at = self._cron_job.last_response_at
            if last_at.tzinfo is None:
                last_at = last_at.replace(tzinfo=timezone.utc)
            cutoff = datetime.now(tz=timezone.utc) - timedelta(
                hours=DEDUP_WINDOW_HOURS
            )
            if last_at > cutoff:
                result.skipped = True
                result.skip_reason = "duplicate-response"
                return

        # Update dedup fields on the job
        self._cron_job.last_response_hash = response_hash
        self._cron_job.last_response_at = datetime.now(tz=timezone.utc)
        self._db_session.commit()
