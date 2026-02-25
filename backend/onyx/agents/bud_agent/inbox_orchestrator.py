"""InboxAgentOrchestrator — non-SSE agent orchestrator for inbox message processing.

Similar to CronAgentOrchestrator but tailored for processing incoming
inter-agent messages. Includes the ``notify_user`` tool for escalation
and tracks whether the agent sent a reply or escalated.
"""

import json
import queue
from typing import Any
from typing import cast
from uuid import UUID

from agents import Agent
from agents import FunctionTool
from agents import RawResponsesStreamEvent
from agents import ToolCallItem
from sqlalchemy.orm import Session

from onyx.agents.agent_sdk.sync_agent_stream_adapter import SyncAgentStream
from onyx.agents.bud_agent.connector_service import create_connector_tools
from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder
from onyx.agents.bud_agent.cron_orchestrator import _build_run_config
from onyx.agents.bud_agent.cron_service import create_cron_tools
from onyx.agents.bud_agent.inbox_service import create_notify_user_tool
from onyx.agents.bud_agent.inbox_service import create_reply_tool
from onyx.agents.bud_agent.memory_service import create_memory_tools
from onyx.agents.bud_agent.web_search_service import BudAgentSearchContext
from onyx.agents.bud_agent.web_search_service import create_web_search_tools
from onyx.agents.bud_agent.workspace_service import create_workspace_tools
from onyx.agents.bud_agent.workspace_service import ensure_default_workspace_files
from onyx.db.agent import add_session_message
from onyx.db.agent import get_workspace_files_as_dict
from onyx.db.agent import update_session_stats
from onyx.db.enums import AgentMessageRole
from onyx.db.models import InboxMessage
from onyx.db.models import User
from onyx.llm.factory import get_default_llms
from onyx.redis.redis_pool import get_redis_client
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.utils.logger import setup_logger

logger = setup_logger()

MAX_TOOL_CALLS = 30


class InboxRunResult:
    """Result of an inbox agent run."""

    def __init__(self) -> None:
        self.response_text: str = ""
        self.tool_call_count: int = 0
        self.replied: bool = False
        self.awaiting_user: bool = False
        self.escalation_reason: str | None = None
        self.no_action: bool = False
        self.error: str | None = None


class InboxAgentOrchestrator:
    """Orchestrates agent execution for incoming inbox messages.

    Accumulates results in memory. Includes send_message (for replying)
    and notify_user (for escalation) tools.
    """

    def __init__(
        self,
        session_id: UUID,
        user: User,
        db_session: Session,
        message: InboxMessage,
        tenant_id: str,
        model: str | None = None,
    ) -> None:
        self._session_id = session_id
        self._user = user
        self._db_session = db_session
        self._message = message
        self._tenant_id = tenant_id
        self._model = model
        self._packet_queue: queue.Queue[Packet | Exception | object] = (
            queue.Queue()
        )

    def run(self, user_message: str) -> InboxRunResult:
        """Run the agent loop synchronously, returning accumulated results."""
        result = InboxRunResult()

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

            # Inbox-specific tools: reply in the same conversation.
            # Skip dispatch when the triggering message was from a USER —
            # both agents already received the user message via dual dispatch,
            # so the reply doesn't need to re-trigger the other agent.
            from onyx.db.enums import InboxSenderType as _IST

            inbox_tools = create_reply_tool(
                db_session=self._db_session,
                user_id=self._user.id,
                conversation_id=self._message.conversation_id,
                tenant_id=self._tenant_id,
                skip_dispatch=self._message.sender_type == _IST.USER,
            )
            notify_tools = create_notify_user_tool(
                db_session=self._db_session,
                user_id=self._user.id,
                conversation_id=self._message.conversation_id,
            )

            # Track whether send_message or notify_user was called
            original_inbox_handler = inbox_tools[0].on_invoke_tool
            original_notify_handler = notify_tools[0].on_invoke_tool

            async def _tracked_send_message(
                ctx: Any, json_string: str
            ) -> str:
                resp = await original_inbox_handler(ctx, json_string)
                if not resp.startswith("Error:"):
                    result.replied = True
                return resp

            async def _tracked_notify_user(
                ctx: Any, json_string: str
            ) -> str:
                resp = await original_notify_handler(ctx, json_string)
                if not resp.startswith("Error:"):
                    result.awaiting_user = True
                    try:
                        args = (
                            json.loads(json_string) if json_string else {}
                        )
                        result.escalation_reason = args.get(
                            "reason", "Agent needs your input."
                        )
                    except (json.JSONDecodeError, AttributeError):
                        result.escalation_reason = (
                            "Agent needs your input."
                        )
                return resp

            inbox_tools[0] = FunctionTool(
                name=inbox_tools[0].name,
                description=inbox_tools[0].description,
                params_json_schema=inbox_tools[0].params_json_schema,
                on_invoke_tool=_tracked_send_message,
            )
            notify_tools[0] = FunctionTool(
                name=notify_tools[0].name,
                description=notify_tools[0].description,
                params_json_schema=notify_tools[0].params_json_schema,
                on_invoke_tool=_tracked_notify_user,
            )

            all_tools: list[FunctionTool] = (
                memory_tools
                + workspace_tools
                + connector_tools
                + web_search_tools
                + cron_tools
                + inbox_tools
                + notify_tools
            )

            connector_tool_names = [t.name for t in connector_tools]

            context_builder = BudAgentContextBuilder(
                context_files=db_context,
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
            messages: list[dict[str, Any]] = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ]

            # Persist user message
            add_session_message(
                db_session=self._db_session,
                session_id=self._session_id,
                role=AgentMessageRole.USER,
                content=user_message,
            )

            # 5. Run the agent loop
            agent = Agent(
                name="BudAgent",
                model=model_name,
                tools=all_tools,
                tool_use_behavior="stop_on_first_tool",
            )

            last_call_is_final = False
            tool_call_count = 0

            while not last_call_is_final:
                if tool_call_count >= MAX_TOOL_CALLS:
                    logger.warning(
                        "Max tool calls (%d) reached for inbox message %s",
                        MAX_TOOL_CALLS,
                        self._message.id,
                    )
                    break

                # Stop if escalation or reply already happened
                if result.replied or result.awaiting_user:
                    break

                stream = SyncAgentStream(
                    agent=agent,
                    input=messages,
                    context=None,
                    run_config=run_config,
                )

                has_tool_calls = False
                for ev in stream:
                    if isinstance(ev, RawResponsesStreamEvent):
                        if (
                            ev.data.type == "response.output_text.delta"
                            and len(ev.data.delta) > 0
                        ):
                            result.response_text += ev.data.delta

                    if isinstance(getattr(ev, "item", None), ToolCallItem):
                        has_tool_calls = True
                        tool_call_count += 1

                if stream.streamed is None:
                    break

                messages = cast(
                    list[dict[str, Any]], stream.streamed.to_input_list()
                )

                if not has_tool_calls:
                    last_call_is_final = True

            result.tool_call_count = tool_call_count

            # Determine if the agent deliberately chose not to act
            if (
                not result.replied
                and not result.awaiting_user
                and result.error is None
            ):
                result.no_action = True

            # Persist response
            if result.response_text:
                add_session_message(
                    db_session=self._db_session,
                    session_id=self._session_id,
                    role=AgentMessageRole.ASSISTANT,
                    content=result.response_text,
                )

            update_session_stats(
                self._db_session,
                self._session_id,
                tool_calls=tool_call_count,
            )

        except Exception as e:
            logger.exception(
                "InboxAgentOrchestrator error for message %s",
                self._message.id,
            )
            result.error = str(e)

        return result
