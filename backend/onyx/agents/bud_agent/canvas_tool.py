"""Canvas tool for BudAgent — lets the agent render structured data as a canvas.

Provides a FunctionTool that converts structured input (charts, tables, emails,
code blocks, reports) into OpenUI Lang and emits it as a canvas panel via
CustomToolDelta packets.  No extra LLM call needed — conversion is deterministic.
"""

import json
import logging
import uuid
from queue import Queue
from typing import Any
from typing import Callable
from uuid import UUID

from agents import FunctionTool
from agents import RunContextWrapper

from onyx.agents.bud_agent.canvas_utils import generate_openui_for_canvas_tool
from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS
from onyx.db.agent import add_tool_message
from onyx.db.agent import update_tool_message_result
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd

logger = logging.getLogger(__name__)

TOOL_NAME = "render_canvas"


def create_canvas_tool(
    session_id: UUID,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
    db_session: Any | None = None,
) -> list[FunctionTool]:
    """Create the render_canvas FunctionTool.

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
        ),
    )
    return [tool]


def _make_invoke_handler(
    session_id: str,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
    db_session: Any | None = None,
) -> Any:
    """Create an async handler for the render_canvas tool."""

    async def handler(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        # Get step number (also closes any open message/reasoning section)
        tool_step = step_number_fn() if step_number_fn else 0
        tool_call_id = str(uuid.uuid4())

        def _emit(obj: Any) -> None:
            packet_queue.put(Packet(ind=tool_step, obj=obj))

        # Parse input
        try:
            args = json.loads(json_string) if isinstance(json_string, str) else json_string
        except (json.JSONDecodeError, TypeError):
            error_msg = "render_canvas: invalid JSON input"
            logger.warning(error_msg)
            return error_msg

        canvas_type: str = args.get("type", "")
        title: str = args.get("title", "Canvas")
        data: dict[str, Any] = args.get("data", {})

        logger.info(
            "render_canvas invoked: type=%r, title=%r, data_keys=%s",
            canvas_type,
            title,
            list(data.keys()) if isinstance(data, dict) else f"list[{len(data)}]",
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
                    "Failed to persist render_canvas tool call",
                    exc_info=True,
                )

        # Convert structured data to OpenUI Lang
        openui_lang: str | None = None
        try:
            result = generate_openui_for_canvas_tool(canvas_type, title, data)
            if result is not None:
                openui_lang, _ = result
        except Exception:
            logger.warning(
                "render_canvas: OpenUI conversion failed",
                exc_info=True,
            )

        if not openui_lang:
            error_msg = (
                f"render_canvas: could not convert type={canvas_type!r} to canvas. "
                "Check data schema matches the expected format."
            )
            _emit(
                CustomToolDelta(
                    tool_name=TOOL_NAME,
                    response_type="text",
                    data=error_msg,
                )
            )
            _emit(SectionEnd())
            return error_msg

        # Emit canvas result
        _emit(
            CustomToolDelta(
                tool_name=TOOL_NAME,
                response_type="text",
                data={"title": title, "type": canvas_type},
                openui_response=openui_lang,
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
                    tool_output={
                        "title": title,
                        "type": canvas_type,
                        "openui_lang": openui_lang,
                    },
                )
            except Exception:
                logger.warning(
                    "Failed to update render_canvas tool result",
                    exc_info=True,
                )

        return f"Canvas rendered: {title}"

    return handler
