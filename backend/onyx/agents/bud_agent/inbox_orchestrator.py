"""InboxAgentOrchestrator — non-SSE agent orchestrator for inbox message processing.

Similar to CronAgentOrchestrator but tailored for processing incoming
inter-agent messages. Includes the ``escalate_to_user`` tool for escalation
and tracks whether the agent sent a reply or escalated.
"""

import asyncio
import concurrent.futures
import json
from typing import Any
from uuid import UUID

from agents import FunctionTool
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.agent_context import AgentExecutionMode
from onyx.agents.bud_agent.agent_context import build_agent_run_context
from onyx.agents.bud_agent.inbox_service import create_complete_goal_tool
from onyx.agents.bud_agent.inbox_service import create_escalate_to_user_tool
from onyx.agents.bud_agent.inbox_service import create_reply_tool
from onyx.agents.bud_agent.turn_driver import TurnDriver
from onyx.agents.bud_agent.turn_driver import TurnDriverConfig
from onyx.agents.bud_agent.turn_driver import TurnDriverResult
from onyx.db.agent import add_session_message
from onyx.db.enums import AgentMessageRole
from onyx.db.models import InboxMessage
from onyx.db.models import User
from onyx.utils.logger import setup_logger

logger = setup_logger()

MAX_TOOL_CALLS = 30


def _run_async(coro: Any) -> Any:
    """Bridge async coroutine into a synchronous call.

    Handles three scenarios:
    1. No event loop exists — use ``asyncio.run()``.
    2. An event loop exists but is not running — use ``loop.run_until_complete()``.
    3. An event loop is already running (e.g. inside a Celery worker with
       an active loop) — offload to a thread pool to avoid nesting.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


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
                search_query=user_message,
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

            # 4. Create TurnDriver and run the agent loop
            config = TurnDriverConfig(
                mode=AgentExecutionMode.INBOX,
                max_tool_calls=MAX_TOOL_CALLS,
                should_stop=lambda: result.replied or result.awaiting_user,
                emitter=None,
                tool_requester=None,
            )
            driver = TurnDriver(config=config, ctx=ctx)

            driver_result: TurnDriverResult = _run_async(
                driver.run_next_turn(
                    session_id=self._session_id,
                    db_session=self._db_session,
                    messages=messages,
                    step_number=0,
                )
            )

            # 5. Map TurnDriverResult to InboxRunResult
            if driver_result.turn is not None:
                result.response_text = (
                    driver_result.turn.full_response_text or ""
                )
                result.tool_call_count = driver_result.turn.tool_call_count

            # For all terminal statuses, check whether the tracking
            # wrappers actually fired.  TurnDriver persists the turn
            # via persist_turn_result already, but we still need to
            # set no_action if nothing happened.
            if driver_result.status in (
                "complete",
                "stopped",
                "max_tools_reached",
            ):
                if (
                    not result.replied
                    and not result.awaiting_user
                    and result.error is None
                ):
                    result.no_action = True
            elif driver_result.status == "awaiting_tool":
                # Should not happen for inbox (no local tools), but
                # handle gracefully.
                logger.warning(
                    "Unexpected awaiting_tool status in inbox orchestrator "
                    "for session %s",
                    self._session_id,
                )
                if (
                    not result.replied
                    and not result.awaiting_user
                    and result.error is None
                ):
                    result.no_action = True

            # 6. Persist standalone assistant message
            # NOTE: TurnDriver already persists via persist_turn_result
            # (which calls add_session_message + update_session_stats),
            # so we do NOT duplicate persistence here.

        except Exception as e:
            logger.exception(
                "InboxAgentOrchestrator error for message %s",
                self._message.id,
            )
            result.error = str(e)

        return result
