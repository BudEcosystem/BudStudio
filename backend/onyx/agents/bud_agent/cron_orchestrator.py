"""CronAgentOrchestrator — non-SSE agent orchestrator for scheduled cron execution.

Unlike BudAgentOrchestrator, this orchestrator:
- Does NOT stream via SSE/queue — results are accumulated in memory
- Does NOT use Redis BLPOP for local tools — suspends to DB instead
- Supports suspend/resume for local tool requests
- Implements post-LLM skip checks (NO_ACTION_NEEDED, dedup)
"""

import hashlib
import json
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
from onyx.agents.bud_agent.agent_context import run_sync_agent_loop
from onyx.db.agent import add_session_message
from onyx.db.agent import update_session_stats
from onyx.db.agent_cron import suspend_cron_execution
from onyx.db.agent_cron import update_cron_execution_status
from onyx.db.enums import AgentCronExecutionStatus
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import AgentCronExecution
from onyx.db.models import AgentCronJob
from onyx.db.models import User
from onyx.utils.logger import setup_logger

logger = setup_logger()

NO_ACTION_MARKER = "NO_ACTION_NEEDED"
DEDUP_WINDOW_HOURS = 24
# Compaction threshold: same as the interactive orchestrator
COMPACTION_THRESHOLD_CHARS = 300_000


class CronRunResult:
    """Result of a cron agent run."""

    def __init__(self) -> None:
        self.response_text: str = ""
        self.tool_call_count: int = 0
        self.tokens_used: int = 0
        self.suspended: bool = False
        self.suspended_tool_name: str | None = None
        self.suspended_tool_input: dict[str, Any] | None = None
        self.suspended_tool_call_id: str | None = None
        self.suspended_messages: list[dict[str, Any]] | None = None
        self.skipped: bool = False
        self.skip_reason: str | None = None
        self.error: str | None = None
        self.new_session_id: UUID | None = None


class CronAgentOrchestrator:
    """Orchestrates agent execution for cron jobs.

    Accumulates results in memory instead of streaming. When a local tool
    is needed, suspends the execution state to DB and returns immediately.
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

        If a local tool is requested, the execution is suspended to DB
        and result.suspended is set to True.
        """
        result = CronRunResult()

        try:
            # 1. Build suspension-aware local tool stubs
            local_tools = self._create_local_tool_stubs(result)

            # 2. Build full agent context
            ctx = build_agent_run_context(
                session_id=self._session_id,
                user=self._user,
                db_session=self._db_session,
                user_message=user_message,
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
                            user_message=user_message,
                            mode=AgentExecutionMode.CRON,
                            local_tools=self._create_local_tool_stubs(result),
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

            # 4. Run the agent loop
            loop_result = run_sync_agent_loop(
                agent=ctx.agent,
                messages=messages,
                run_config=ctx.run_config,
                should_stop=lambda: result.suspended,
            )
            result.response_text = loop_result.response_text
            result.tool_call_count = loop_result.tool_call_count
            if result.suspended:
                result.suspended_messages = loop_result.final_messages

            # 5. Post-LLM skip checks (only if not suspended/errored)
            if not result.suspended and not result.error:
                self._apply_post_llm_skip_checks(result)

            # 6. Persist response
            if result.response_text and not result.suspended:
                add_session_message(
                    db_session=self._db_session,
                    session_id=self._session_id,
                    role=AgentMessageRole.ASSISTANT,
                    content=result.response_text,
                )

            update_session_stats(
                self._db_session,
                self._session_id,
                tool_calls=result.tool_call_count,
            )

        except Exception as e:
            logger.exception(
                "CronAgentOrchestrator error for execution %s",
                self._execution.id,
            )
            result.error = str(e)

        return result

    def resume(
        self,
        messages: list[dict[str, Any]],
        tool_result_output: str | None,
        tool_result_error: str | None,
        tool_call_id: str,
        tool_name: str,
    ) -> CronRunResult:
        """Resume a suspended execution after receiving a local tool result.

        Appends the tool result to the message history and continues
        the agent loop from where it left off.
        """
        result = CronRunResult()

        try:
            # Append tool result to messages
            if tool_result_error:
                messages.append({
                    "role": "tool",
                    "content": f"Error: {tool_result_error}",
                    "tool_call_id": tool_call_id,
                })
            else:
                messages.append({
                    "role": "tool",
                    "content": tool_result_output or "",
                    "tool_call_id": tool_call_id,
                })

            # Persist tool result in session history
            add_session_message(
                db_session=self._db_session,
                session_id=self._session_id,
                role=AgentMessageRole.TOOL,
                tool_name=tool_name,
                tool_output={"output": tool_result_output} if tool_result_output else None,
                tool_error=tool_result_error,
            )

            # Rebuild tools + context via shared helper
            local_tools = self._create_local_tool_stubs(result)
            ctx = build_agent_run_context(
                session_id=self._session_id,
                user=self._user,
                db_session=self._db_session,
                user_message="",  # resume does not introduce a new user message
                mode=AgentExecutionMode.CRON,
                local_tools=local_tools,
                tenant_id=self._tenant_id,
                workspace_path=self._workspace_path,
                model=self._model,
            )

            # Continue the agent loop
            loop_result = run_sync_agent_loop(
                agent=ctx.agent,
                messages=messages,
                run_config=ctx.run_config,
                should_stop=lambda: result.suspended,
            )
            result.response_text = loop_result.response_text
            result.tool_call_count = loop_result.tool_call_count
            if result.suspended:
                result.suspended_messages = loop_result.final_messages

            # Post-LLM skip checks
            if not result.suspended and not result.error:
                self._apply_post_llm_skip_checks(result)

            # Persist response
            if result.response_text and not result.suspended:
                add_session_message(
                    db_session=self._db_session,
                    session_id=self._session_id,
                    role=AgentMessageRole.ASSISTANT,
                    content=result.response_text,
                )

            update_session_stats(
                self._db_session,
                self._session_id,
                tool_calls=result.tool_call_count,
            )

        except Exception as e:
            logger.exception(
                "CronAgentOrchestrator resume error for execution %s",
                self._execution.id,
            )
            result.error = str(e)

        return result

    def _create_local_tool_stubs(
        self,
        result: CronRunResult,
    ) -> list[FunctionTool]:
        """Create local tool stubs that trigger suspension instead of executing.

        When the LLM calls a local tool, the stub records the suspension
        details in the result object. The agent loop will then break and
        the execution will be persisted to DB in SUSPENDED state.
        """
        from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOL_SCHEMAS

        tools: list[FunctionTool] = []
        for tool_name, schema in LOCAL_TOOL_SCHEMAS.items():
            tool = self._create_suspension_tool(tool_name, schema, result)
            tools.append(tool)
        return tools

    def _create_suspension_tool(
        self,
        tool_name: str,
        schema: dict[str, Any],
        result: CronRunResult,
    ) -> FunctionTool:
        """Create a single FunctionTool that suspends execution on invocation."""
        from agents import RunContextWrapper

        async def handler(
            _ctx: RunContextWrapper[Any], json_string: str
        ) -> str:
            tool_input: dict[str, Any] = (
                json.loads(json_string) if json_string else {}
            )

            import uuid as _uuid
            tool_call_id = str(_uuid.uuid4())

            # Signal suspension
            result.suspended = True
            result.suspended_tool_name = tool_name
            result.suspended_tool_input = tool_input
            result.suspended_tool_call_id = tool_call_id

            # Persist tool call in session history
            add_session_message(
                db_session=self._db_session,
                session_id=self._session_id,
                role=AgentMessageRole.ASSISTANT,
                tool_name=tool_name,
                tool_input=tool_input,
            )

            # Return a placeholder that won't be used (agent loop will break)
            return f"[SUSPENDED: waiting for local execution of {tool_name}]"

        return FunctionTool(
            name=tool_name,
            description=schema["description"],
            params_json_schema=schema["parameters"],
            on_invoke_tool=handler,
        )

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
