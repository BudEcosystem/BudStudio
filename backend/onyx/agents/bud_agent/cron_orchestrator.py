"""CronAgentOrchestrator — non-SSE agent orchestrator for scheduled cron execution.

Unlike BudAgentOrchestrator, this orchestrator:
- Does NOT stream via SSE/queue — results are accumulated in memory
- Does NOT use Redis BLPOP for local tools — suspends to DB instead
- Supports suspend/resume for local tool requests
- Implements post-LLM skip checks (HEARTBEAT_OK, dedup)
"""

import hashlib
import json
import queue
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from typing import Any
from typing import cast
from uuid import UUID

from agents import Agent
from agents import FunctionTool
from agents import RawResponsesStreamEvent
from agents import RunConfig
from agents import ToolCallItem
from agents.models.openai_provider import OpenAIProvider
from openai import AsyncOpenAI
from sqlalchemy.orm import Session

from onyx.agents.agent_sdk.sync_agent_stream_adapter import SyncAgentStream
from onyx.agents.bud_agent.connector_service import create_connector_tools
from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder
from onyx.agents.bud_agent.cron_service import create_cron_tools
from onyx.agents.bud_agent.inbox_service import create_inbox_tools
from onyx.agents.bud_agent.memory_service import create_memory_tools
from onyx.agents.bud_agent.tool_definitions import is_local_tool
from onyx.agents.bud_agent.web_search_service import BudAgentSearchContext
from onyx.agents.bud_agent.web_search_service import create_web_search_tools
from onyx.agents.bud_agent.workspace_service import create_workspace_tools
from onyx.agents.bud_agent.workspace_service import ensure_default_workspace_files
from onyx.db.agent import add_session_message
from onyx.db.agent import create_compacted_session
from onyx.db.agent import get_session
from onyx.db.agent import get_session_messages
from onyx.db.agent import get_workspace_files_as_dict
from onyx.db.agent import mark_session_compacted
from onyx.db.agent import update_session_stats
from onyx.db.agent import update_session_status
from onyx.db.agent_cron import is_heartbeat_content_empty
from onyx.db.agent_cron import suspend_cron_execution
from onyx.db.agent_cron import update_cron_execution_status
from onyx.db.enums import AgentCronExecutionStatus
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import AgentCronExecution
from onyx.db.models import AgentCronJob
from onyx.db.models import User
from onyx.llm.factory import get_default_llms
from onyx.redis.redis_pool import get_redis_client
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.utils.logger import setup_logger

logger = setup_logger()

MAX_TOOL_CALLS = 50
HEARTBEAT_OK_MARKER = "HEARTBEAT_OK"
DEDUP_WINDOW_HOURS = 24
# Compaction threshold: same as the interactive orchestrator
COMPACTION_THRESHOLD_CHARS = 300_000
MAX_HISTORY_CHARS = 400_000


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
        # Dummy packet queue — cron does not stream to a client, but
        # connector / web-search tools expect a queue for UI packets.
        self._packet_queue: queue.Queue[Packet | Exception | object] = (
            queue.Queue()
        )

    def run(self, user_message: str) -> CronRunResult:
        """Run the agent loop synchronously, returning accumulated results.

        If a local tool is requested, the execution is suspended to DB
        and result.suspended is set to True.
        """
        result = CronRunResult()

        try:
            # 1. Build context
            ensure_default_workspace_files(
                db_session=self._db_session,
                user=self._user,
            )

            db_context = get_workspace_files_as_dict(
                db_session=self._db_session,
                user_id=self._user.id,
                paths=[
                    "AGENTS.md", "SOUL.md", "IDENTITY.md",
                    "USER.md", "MEMORY.md", "HEARTBEAT.md",
                ],
            )

            current_session = get_session(
                db_session=self._db_session,
                session_id=self._session_id,
            )
            compaction_summary = (
                current_session.compaction_summary if current_session else None
            )

            # 2. Build tools
            redis_client = get_redis_client(tenant_id=self._tenant_id)

            memory_tools = create_memory_tools(
                db_session=self._db_session,
                user_id=self._user.id,
                session_id=self._session_id,
            )
            workspace_tools = create_workspace_tools(
                db_session=self._db_session,
                user_id=self._user.id,
            )
            connector_tools = create_connector_tools(
                db_session=self._db_session,
                user=self._user,
                session_id=self._session_id,
                packet_queue=self._packet_queue,
                redis_client=redis_client,
            )

            search_context = BudAgentSearchContext()
            web_search_tools = create_web_search_tools(
                db_session=self._db_session,
                packet_queue=self._packet_queue,
                search_context=search_context,
                step_number_fn=lambda: 0,
                session_id=self._session_id,
            )

            cron_tools = create_cron_tools(
                db_session=self._db_session,
                user_id=self._user.id,
            )

            inbox_tools = create_inbox_tools(
                db_session=self._db_session,
                user_id=self._user.id,
                tenant_id=self._tenant_id,
            )

            # Suspension-aware local tool stubs
            local_tools = self._create_local_tool_stubs(result)

            all_tools: list[FunctionTool] = (
                local_tools
                + memory_tools
                + workspace_tools
                + connector_tools
                + web_search_tools
                + cron_tools
                + inbox_tools
            )

            connector_tool_names = [t.name for t in connector_tools]

            context_builder = BudAgentContextBuilder(
                workspace_path=self._workspace_path,
                context_files=db_context,
                compaction_summary=compaction_summary,
            )
            system_prompt = context_builder.build(
                db_session=self._db_session,
                user_id=self._user.id,
                user_message=user_message,
                connector_tool_names=connector_tool_names,
            )

            # 3. Build RunConfig
            llm, _ = get_default_llms(user=self._user)
            model_name: str = self._model or llm.config.model_name
            run_config = _build_run_config(llm, model_name)

            # 4. Build messages
            messages = self._build_messages(system_prompt, user_message)

            # 4a. Check if history exceeds compaction threshold
            history_chars = sum(
                len(str(m.get("content", "")))
                for m in messages
                if m.get("role") != "system"
            )
            if history_chars > COMPACTION_THRESHOLD_CHARS:
                try:
                    new_sid = self._maybe_compact_session(
                        user_message=user_message,
                        llm=llm,
                    )
                    if new_sid is not None:
                        result.new_session_id = new_sid
                        # Reload context + messages for the new session
                        new_session = get_session(
                            db_session=self._db_session,
                            session_id=new_sid,
                        )
                        context_builder = BudAgentContextBuilder(
                            workspace_path=self._workspace_path,
                            context_files=db_context,
                            compaction_summary=(
                                new_session.compaction_summary
                                if new_session
                                else None
                            ),
                        )
                        system_prompt = context_builder.build(
                            db_session=self._db_session,
                            user_id=self._user.id,
                            user_message=user_message,
                            connector_tool_names=connector_tool_names,
                        )
                        messages = self._build_messages(
                            system_prompt,
                            user_message,
                            persist_user_message=False,
                        )
                except Exception:
                    logger.warning(
                        "Compaction failed for cron session %s, "
                        "falling back to truncation",
                        self._session_id,
                        exc_info=True,
                    )

            # 5. Run the agent loop
            self._run_loop(
                messages=messages,
                model_name=model_name,
                all_tools=all_tools,
                run_config=run_config,
                result=result,
            )

            # 6. Post-LLM skip checks (only if not suspended/errored)
            if not result.suspended and not result.error:
                self._apply_post_llm_skip_checks(result)

            # 7. Persist response
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

            # Rebuild tools + config
            ensure_default_workspace_files(
                db_session=self._db_session,
                user=self._user,
            )

            redis_client = get_redis_client(tenant_id=self._tenant_id)

            memory_tools = create_memory_tools(
                db_session=self._db_session,
                user_id=self._user.id,
                session_id=self._session_id,
            )
            workspace_tools = create_workspace_tools(
                db_session=self._db_session,
                user_id=self._user.id,
            )
            connector_tools = create_connector_tools(
                db_session=self._db_session,
                user=self._user,
                session_id=self._session_id,
                packet_queue=self._packet_queue,
                redis_client=redis_client,
            )

            search_context = BudAgentSearchContext()
            web_search_tools = create_web_search_tools(
                db_session=self._db_session,
                packet_queue=self._packet_queue,
                search_context=search_context,
                step_number_fn=lambda: 0,
                session_id=self._session_id,
            )

            cron_tools = create_cron_tools(
                db_session=self._db_session,
                user_id=self._user.id,
            )

            inbox_tools = create_inbox_tools(
                db_session=self._db_session,
                user_id=self._user.id,
                tenant_id=self._tenant_id,
            )

            local_tools = self._create_local_tool_stubs(result)
            all_tools: list[FunctionTool] = (
                local_tools
                + memory_tools
                + workspace_tools
                + connector_tools
                + web_search_tools
                + cron_tools
                + inbox_tools
            )

            llm, _ = get_default_llms(user=self._user)
            model_name: str = self._model or llm.config.model_name
            run_config = _build_run_config(llm, model_name)

            # Continue the agent loop
            self._run_loop(
                messages=messages,
                model_name=model_name,
                all_tools=all_tools,
                run_config=run_config,
                result=result,
            )

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

    def _run_loop(
        self,
        messages: list[dict[str, Any]],
        model_name: str,
        all_tools: list[FunctionTool],
        run_config: RunConfig,
        result: CronRunResult,
    ) -> None:
        """Run the iterative agent loop until completion or suspension."""
        agent = Agent(
            name="BudAgent",
            model=model_name,
            tools=all_tools,
            tool_use_behavior="stop_on_first_tool",
        )

        last_call_is_final = False

        while not last_call_is_final:
            if result.tool_call_count >= MAX_TOOL_CALLS:
                logger.warning(
                    "Max tool calls (%d) reached for cron execution %s",
                    MAX_TOOL_CALLS,
                    self._execution.id,
                )
                break

            # Check if a previous iteration triggered suspension
            if result.suspended:
                break

            stream = SyncAgentStream(
                agent=agent,
                input=messages,
                context=None,
                run_config=run_config,
            )

            has_tool_calls = False
            for ev in stream:
                # Handle streaming text deltas
                if isinstance(ev, RawResponsesStreamEvent):
                    if (
                        ev.data.type == "response.output_text.delta"
                        and len(ev.data.delta) > 0
                    ):
                        result.response_text += ev.data.delta

                # Detect tool calls
                if isinstance(getattr(ev, "item", None), ToolCallItem):
                    has_tool_calls = True
                    result.tool_call_count += 1

            if stream.streamed is None:
                break

            # Advance messages
            messages = cast(
                list[dict[str, Any]], stream.streamed.to_input_list()
            )

            if not has_tool_calls:
                last_call_is_final = True

            # Check if suspension was triggered by a local tool stub
            if result.suspended:
                result.suspended_messages = messages
                break

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

    def _maybe_compact_session(
        self,
        user_message: str,
        llm: Any,
    ) -> UUID | None:
        """Compact the current session by summarizing it and creating a new linked session.

        Returns the new session ID on success, or None if compaction is skipped.
        Adapted from BudAgentOrchestrator._compact_session().
        """
        previous_messages = get_session_messages(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        if not previous_messages:
            return None

        conversation_text = []
        for msg in previous_messages:
            role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
            content = msg.content or ""
            if content:
                conversation_text.append(f"[{role}]: {content}")

        conversation_str = "\n".join(conversation_text)
        if len(conversation_str) > 100_000:
            conversation_str = (
                conversation_str[:70_000]
                + "\n\n... (middle truncated) ...\n\n"
                + conversation_str[-25_000:]
            )

        summarization_prompt = (
            "You are a concise summarization assistant. Below is a conversation "
            "between a user and an AI agent. Summarize the key topics discussed, "
            "decisions made, tasks completed, and any important context that would "
            "help continue the conversation seamlessly. Be concise but comprehensive. "
            "Focus on facts, outcomes, and ongoing tasks.\n\n"
            f"Conversation:\n{conversation_str}\n\n"
            "Summary:"
        )

        summary_response = llm.invoke(summarization_prompt)
        summary = str(summary_response.content).strip()

        if not summary:
            logger.warning("Compaction produced empty summary, skipping")
            return None

        mark_session_compacted(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        new_session = create_compacted_session(
            db_session=self._db_session,
            user_id=self._user.id,
            parent_session_id=self._session_id,
            compaction_summary=summary,
            workspace_path=self._workspace_path,
        )

        # Persist the current user message in the new session
        add_session_message(
            db_session=self._db_session,
            session_id=new_session.id,
            role=AgentMessageRole.USER,
            content=user_message,
        )

        old_session_id = self._session_id
        self._session_id = new_session.id

        logger.info(
            "Compacted cron session %s -> new session %s",
            old_session_id,
            new_session.id,
        )

        return new_session.id

    def _build_messages(
        self,
        system_prompt: str,
        user_message: str,
        persist_user_message: bool = True,
    ) -> list[dict[str, Any]]:
        """Build the message list for the Agents SDK."""
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]

        # Persist user message (skipped on rebuild after compaction since
        # _maybe_compact_session already persisted it in the new session)
        if persist_user_message:
            add_session_message(
                db_session=self._db_session,
                session_id=self._session_id,
                role=AgentMessageRole.USER,
                content=user_message,
            )

        # Load session history
        previous_messages = get_session_messages(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        history: list[dict[str, Any]] = []
        # Collect consecutive TOOL messages so we can emit them as
        # Responses-API-format function_call + function_call_output pairs.
        pending_tools: list[Any] = []

        def _flush_tools() -> None:
            """Emit tool calls/outputs in Responses API item format."""
            if not pending_tools:
                return
            for t in pending_tools:
                call_id = t.tool_call_id or t.tool_name or "unknown"
                # function_call item (the assistant's tool invocation)
                history.append({
                    "type": "function_call",
                    "call_id": call_id,
                    "name": t.tool_name or "unknown",
                    "arguments": json.dumps(t.tool_input) if t.tool_input else "{}",
                })
                # function_call_output item (the tool's result)
                output = (
                    json.dumps(t.tool_output)
                    if t.tool_output
                    else (t.tool_error or "")
                )
                history.append({
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output,
                })
            pending_tools.clear()

        for msg in previous_messages:
            if msg.role == AgentMessageRole.TOOL:
                pending_tools.append(msg)
                continue

            # Flush any buffered tool messages before the next non-tool msg
            _flush_tools()

            if msg.role == AgentMessageRole.USER:
                history.append({"role": "user", "content": msg.content or ""})
            elif msg.role == AgentMessageRole.ASSISTANT:
                if msg.content:
                    history.append(
                        {"role": "assistant", "content": msg.content}
                    )

        # Flush remaining tool messages at the end
        _flush_tools()

        # Truncate history if it exceeds budget (keep most recent messages)
        system_chars = len(system_prompt)
        budget = MAX_HISTORY_CHARS - system_chars
        if budget < 0:
            budget = 50_000

        total_chars = sum(len(str(m.get("content", ""))) for m in history)
        if total_chars > budget:
            logger.info(
                "Truncating cron history for session %s: %d chars > %d budget",
                self._session_id,
                total_chars,
                budget,
            )
            while history and total_chars > budget:
                dropped = history.pop(0)
                total_chars -= len(str(dropped.get("content", "")))

        messages.extend(history)
        return messages

    def _apply_post_llm_skip_checks(self, result: CronRunResult) -> None:
        """Apply post-LLM skip checks (HEARTBEAT_OK and dedup)."""
        response = result.response_text.strip()
        if not response:
            return

        # Check 6: HEARTBEAT_OK
        if self._cron_job.is_heartbeat and HEARTBEAT_OK_MARKER in response:
            result.skipped = True
            result.skip_reason = "heartbeat-ok"
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


def _build_run_config(
    llm: Any,
    model_name: str,
) -> RunConfig:
    """Build an Agents SDK RunConfig from Onyx's LLM configuration.

    Shared with BudAgentOrchestrator._build_run_config.
    """
    api_key = llm.config.api_key or "not-needed"
    api_base = llm.config.api_base

    extra_headers: dict[str, str] = {}
    if hasattr(llm, "_model_kwargs"):
        extra_headers = llm._model_kwargs.get("extra_headers", {})

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=api_base,
        default_headers=extra_headers if extra_headers else None,
    )
    provider = OpenAIProvider(
        openai_client=client,
        use_responses=False,
    )
    return RunConfig(model_provider=provider)
