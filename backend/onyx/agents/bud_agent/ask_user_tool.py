"""Ask-user-questions tool for BudAgent.

Lets the agent pause and ask the user one or more clarifying questions
with selectable options.  Uses the same blocking-RPC pattern as the
tool-approval flow: emit packet → block on Redis BLPOP → frontend
shows UI → user interacts → frontend POSTs to /tool-result → Redis
unblocks → agent continues.
"""

import json
import logging
import uuid
from queue import Queue
from typing import Any
from typing import Callable
from uuid import UUID

import redis
from agents import FunctionTool
from agents import RunContextWrapper

from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS
from onyx.db.agent import add_tool_message
from onyx.db.agent import update_tool_message_result
from onyx.server.query_and_chat.streaming_models import AgentUserQuestions
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd
from onyx.server.query_and_chat.streaming_models import UserQuestionItem

logger = logging.getLogger(__name__)

TOOL_NAME = "ask_user_questions"
# Timeout waiting for user response (5 minutes)
USER_RESPONSE_TIMEOUT_SECONDS = 300


def create_ask_user_tool(
    session_id: UUID,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
    db_session: Any | None = None,
    redis_client: redis.Redis | None = None,  # type: ignore[type-arg]
) -> list[FunctionTool]:
    """Create the ask_user_questions FunctionTool.

    Returns a single-element list for consistency with other tool factories.
    """
    schema = REMOTE_TOOL_SCHEMAS[TOOL_NAME]

    tool = FunctionTool(
        name=TOOL_NAME,
        description=schema["description"],
        params_json_schema=schema["parameters"],
        on_invoke_tool=_make_invoke_handler(
            session_id=str(session_id),
            packet_queue=packet_queue,
            step_number_fn=step_number_fn,
            db_session=db_session,
            redis_client=redis_client,
        ),
    )
    return [tool]


def _make_invoke_handler(
    session_id: str,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
    db_session: Any | None = None,
    redis_client: redis.Redis | None = None,  # type: ignore[type-arg]
) -> Any:
    """Create an async handler for the ask_user_questions tool."""

    async def handler(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        # Get step number
        tool_step = step_number_fn() if step_number_fn else 0
        tool_call_id = str(uuid.uuid4())

        def _emit(obj: Any) -> None:
            packet_queue.put(Packet(ind=tool_step, obj=obj))

        # Parse input
        try:
            args = json.loads(json_string) if isinstance(json_string, str) else json_string
        except (json.JSONDecodeError, TypeError):
            error_msg = "ask_user_questions: invalid JSON input"
            logger.warning(error_msg)
            return error_msg

        raw_questions: list[dict[str, Any]] = args.get("questions", [])
        if not raw_questions:
            return "ask_user_questions: no questions provided"

        questions = [
            UserQuestionItem(
                question=q.get("question", ""),
                options=q.get("options", []),
            )
            for q in raw_questions
        ]

        logger.info(
            "ask_user_questions invoked: %d question(s), session=%s",
            len(questions),
            session_id,
        )

        # Emit tool start
        _emit(CustomToolStart(tool_name=TOOL_NAME))

        # Persist tool call to DB
        if db_session:
            try:
                add_tool_message(
                    db_session=db_session,
                    session_id=UUID(session_id),
                    tool_name=TOOL_NAME,
                    tool_input=args,
                    tool_call_id=tool_call_id,
                    step_number=tool_step,
                )
            except Exception:
                logger.warning(
                    "Failed to persist ask_user_questions tool call",
                    exc_info=True,
                )

        # Emit the questions packet so the frontend can display them
        _emit(
            AgentUserQuestions(
                questions=questions,
                tool_call_id=tool_call_id,
            )
        )

        # Block on Redis until the user answers
        if redis_client is None:
            error_msg = "ask_user_questions: no Redis client available"
            logger.error(error_msg)
            _emit(
                CustomToolDelta(
                    tool_name=TOOL_NAME,
                    response_type="error",
                    data=error_msg,
                )
            )
            _emit(SectionEnd())
            return error_msg

        key = f"bud_agent_tool_result:{session_id}:{tool_call_id}"
        try:
            result = redis_client.blpop(key, timeout=USER_RESPONSE_TIMEOUT_SECONDS)
        except Exception:
            logger.warning(
                "Redis error waiting for user response", exc_info=True
            )
            result = None
        finally:
            redis_client.delete(key)

        if result is None:
            # Timeout — user did not respond
            timeout_msg = "The user did not respond within the time limit."
            _emit(
                CustomToolDelta(
                    tool_name=TOOL_NAME,
                    response_type="text",
                    data=timeout_msg,
                )
            )
            _emit(SectionEnd())
            if db_session:
                try:
                    update_tool_message_result(
                        db_session=db_session,
                        session_id=UUID(session_id),
                        tool_call_id=tool_call_id,
                        tool_output={"error": "timeout"},
                    )
                except Exception:
                    logger.warning(
                        "Failed to update ask_user_questions timeout result",
                        exc_info=True,
                    )
            return timeout_msg

        # Parse response
        try:
            _, raw_payload = result
            payload = json.loads(raw_payload)
            output_str: str = payload.get("output", "")
            answers: list[dict[str, str]] = json.loads(output_str) if output_str else []
        except (json.JSONDecodeError, TypeError, ValueError):
            logger.warning("Failed to parse user answers", exc_info=True)
            answers = []

        # Format the answers for the LLM
        if answers:
            lines = ["User answered:"]
            for a in answers:
                q = a.get("question", "?")
                ans = a.get("answer", "?")
                lines.append(f'Q: {q} → "{ans}"')
            result_text = "\n".join(lines)
        else:
            result_text = "The user did not provide answers."

        # Emit result
        _emit(
            CustomToolDelta(
                tool_name=TOOL_NAME,
                response_type="text",
                data=result_text,
            )
        )
        _emit(SectionEnd())

        # Persist result to DB
        if db_session:
            try:
                update_tool_message_result(
                    db_session=db_session,
                    session_id=UUID(session_id),
                    tool_call_id=tool_call_id,
                    tool_output={"answers": answers},
                )
            except Exception:
                logger.warning(
                    "Failed to update ask_user_questions result",
                    exc_info=True,
                )

        return result_text

    return handler
