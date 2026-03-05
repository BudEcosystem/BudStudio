"""InboxAgentOrchestrator — non-SSE agent orchestrator for inbox message processing.

Similar to CronAgentOrchestrator but tailored for processing incoming
inter-agent messages. Includes the ``escalate_to_user`` tool for escalation
and tracks whether the agent sent a reply or escalated.
"""

import json
import queue
from typing import Any
from uuid import UUID

from agents import FunctionTool
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.agent_context import AgentExecutionMode
from onyx.agents.bud_agent.agent_context import build_agent_run_context
from onyx.agents.bud_agent.agent_context import run_sync_agent_loop
from onyx.agents.bud_agent.inbox_service import create_complete_goal_tool
from onyx.agents.bud_agent.inbox_service import create_escalate_to_user_tool
from onyx.agents.bud_agent.inbox_service import create_reply_tool
from onyx.db.agent import add_session_message
from onyx.db.agent import update_session_stats
from onyx.db.enums import AgentMessageRole
from onyx.db.models import InboxMessage
from onyx.db.models import User
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
    and escalate_to_user (for escalation) tools.
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
            # 1. Build inbox-specific tools with tracking wrappers
            from onyx.db.enums import InboxSenderType as _IST

            reply_tools = create_reply_tool(
                db_session=self._db_session,
                user_id=self._user.id,
                conversation_id=self._message.conversation_id,
                tenant_id=self._tenant_id,
                skip_dispatch=self._message.sender_type == _IST.USER,
            )
            notify_tools = create_escalate_to_user_tool(
                db_session=self._db_session,
                user_id=self._user.id,
                conversation_id=self._message.conversation_id,
            )
            goal_tools = create_complete_goal_tool(
                db_session=self._db_session,
                conversation_id=self._message.conversation_id,
            )

            # Track whether send_message or escalate_to_user was called
            original_inbox_handler = reply_tools[0].on_invoke_tool
            original_notify_handler = notify_tools[0].on_invoke_tool

            async def _tracked_send_message(
                ctx: Any, json_string: str
            ) -> str:
                resp = await original_inbox_handler(ctx, json_string)
                if not resp.startswith("Error:"):
                    result.replied = True
                return resp

            async def _tracked_escalate_to_user(
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

            reply_tools[0] = FunctionTool(
                name=reply_tools[0].name,
                description=reply_tools[0].description,
                params_json_schema=reply_tools[0].params_json_schema,
                on_invoke_tool=_tracked_send_message,
            )
            notify_tools[0] = FunctionTool(
                name=notify_tools[0].name,
                description=notify_tools[0].description,
                params_json_schema=notify_tools[0].params_json_schema,
                on_invoke_tool=_tracked_escalate_to_user,
            )

            # 2. Build full agent context
            ctx = build_agent_run_context(
                session_id=self._session_id,
                user=self._user,
                db_session=self._db_session,
                user_message=user_message,
                mode=AgentExecutionMode.INBOX,
                local_tools=[],
                inbox_tools=reply_tools,
                extra_tools=notify_tools + goal_tools,
                tenant_id=self._tenant_id,
                model=self._model,
            )

            # 3. Build fresh messages (inbox doesn't load DB history)
            messages: list[dict[str, Any]] = [
                {"role": "system", "content": ctx.system_prompt},
                {"role": "user", "content": user_message},
            ]

            # Persist user message
            add_session_message(
                db_session=self._db_session,
                session_id=self._session_id,
                role=AgentMessageRole.USER,
                content=user_message,
            )

            # 4. Run the agent loop
            loop_result = run_sync_agent_loop(
                agent=ctx.agent,
                messages=messages,
                run_config=ctx.run_config,
                max_tool_calls=30,
                should_stop=lambda: result.replied or result.awaiting_user,
            )
            result.response_text = loop_result.response_text
            result.tool_call_count = loop_result.tool_call_count

            # 5. Check if no action was taken
            if (
                not result.replied
                and not result.awaiting_user
                and result.error is None
            ):
                result.no_action = True

            # 6. Persist response
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
                tool_calls=result.tool_call_count,
            )

        except Exception as e:
            logger.exception(
                "InboxAgentOrchestrator error for message %s",
                self._message.id,
            )
            result.error = str(e)

        return result
