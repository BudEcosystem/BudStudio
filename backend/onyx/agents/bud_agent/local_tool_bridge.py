"""Local tool bridge -- creates FunctionTool objects that delegate execution to the desktop.

When the LLM requests a local tool (file ops, bash, etc.), the bridge:
1. Emits Packet objects (CustomToolStart, AgentLocalToolRequest, etc.)
2. Persists tool messages to the database
3. Blocks on Redis BLPOP waiting for the desktop to execute and POST the result
4. Returns the result to the Agents SDK
"""

from __future__ import annotations

import json
import uuid
from queue import Queue
from typing import Any
from typing import Callable
from typing import Coroutine
from typing import TYPE_CHECKING

import redis

from agents import FunctionTool
from agents import RunContextWrapper

from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOL_SCHEMAS
from onyx.agents.bud_agent.tool_definitions import requires_approval
from onyx.db.agent import add_tool_message
from onyx.db.agent import update_tool_message_result
from onyx.server.query_and_chat.streaming_models import AgentApprovalRequired
from onyx.server.query_and_chat.streaming_models import AgentLocalToolRequest
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd
from onyx.utils.logger import setup_logger

if TYPE_CHECKING:
    from onyx.agents.bud_agent.orchestrator import BudAgentOrchestrator
    from sqlalchemy.orm import Session

logger = setup_logger()

TOOL_TIMEOUT_SECONDS = 300  # 5 minutes
REDIS_KEY_TTL_SECONDS = 600  # 10 minutes

# Type alias for the on_invoke_tool callback signature
InvokeHandler = Callable[
    [RunContextWrapper[Any], str],
    Coroutine[Any, Any, str],
]


class LocalToolBridge:
    """Creates FunctionTool objects that delegate execution to the desktop via Redis."""

    def __init__(
        self,
        session_id: str,
        packet_queue: Queue[Any],
        redis_client: redis.Redis,  # type: ignore[type-arg]
        db_session: Session | None = None,
        orchestrator: BudAgentOrchestrator | None = None,
    ) -> None:
        self._session_id = session_id
        self._packet_queue = packet_queue
        self._redis_client = redis_client
        self._db_session = db_session
        self._orchestrator = orchestrator

    def _emit(self, obj: Any, step: int | None = None) -> None:
        """Helper to put a Packet on the queue."""
        ind = step if step is not None else (
            self._orchestrator.step_number if self._orchestrator else 0
        )
        self._packet_queue.put(Packet(ind=ind, obj=obj))

    def create_all_local_tools(self) -> list[FunctionTool]:
        """Create FunctionTool objects for all local tools."""
        tools: list[FunctionTool] = []
        for tool_name, schema in LOCAL_TOOL_SCHEMAS.items():
            tool = self._create_function_tool(tool_name, schema)
            tools.append(tool)
        return tools

    def _create_function_tool(
        self,
        tool_name: str,
        schema: dict[str, Any],
    ) -> FunctionTool:
        """Create a single FunctionTool that bridges to the desktop."""
        return FunctionTool(
            name=tool_name,
            description=schema["description"],
            params_json_schema=schema["parameters"],
            on_invoke_tool=self._make_invoke_handler(tool_name),
        )

    def _make_invoke_handler(
        self, tool_name: str
    ) -> InvokeHandler:
        """Create an async handler for a specific tool."""

        async def handler(
            context: RunContextWrapper[Any], json_string: str
        ) -> str:
            tool_call_id = str(uuid.uuid4())
            tool_input: dict[str, Any] = (
                json.loads(json_string) if json_string else {}
            )

            # Assign a step number for this tool call, closing any open
            # text/reasoning section so the tool gets its own step index.
            if self._orchestrator:
                step = self._orchestrator.close_open_section_for_tool()
                self._orchestrator.step_number += 1
            else:
                step = 0

            # Emit CustomToolStart packet
            self._emit(CustomToolStart(tool_name=tool_name), step=step)

            # Persist tool message to DB
            if self._db_session:
                try:
                    from uuid import UUID as UUIDType
                    add_tool_message(
                        db_session=self._db_session,
                        session_id=UUIDType(self._session_id),
                        tool_name=tool_name,
                        tool_input=tool_input,
                        tool_call_id=tool_call_id,
                        step_number=step,
                    )
                except Exception:
                    logger.warning("Failed to persist tool message", exc_info=True)

            # Handle approval if required
            if requires_approval(tool_name):
                approved = self._wait_for_approval(
                    tool_name, tool_input, tool_call_id
                )
                if not approved:
                    error_msg = f"Tool '{tool_name}' was denied by the user."
                    self._emit(
                        CustomToolDelta(
                            tool_name=tool_name,
                            response_type="error",
                            data=error_msg,
                        ),
                        step=step,
                    )
                    self._emit(SectionEnd(), step=step)

                    # Update DB with denial
                    if self._db_session:
                        try:
                            from uuid import UUID as UUIDType
                            update_tool_message_result(
                                db_session=self._db_session,
                                session_id=UUIDType(self._session_id),
                                tool_call_id=tool_call_id,
                                tool_error=error_msg,
                                ui_spec={"approval_status": "denied"},
                            )
                        except Exception:
                            logger.warning("Failed to update denied tool", exc_info=True)
                    return error_msg

            # Emit local tool request (tells desktop to execute)
            self._emit(
                AgentLocalToolRequest(
                    tool_name=tool_name,
                    tool_input=tool_input,
                    tool_call_id=tool_call_id,
                ),
                step=step,
            )

            # Block on Redis waiting for desktop result
            result = self._wait_for_tool_result(tool_name, tool_call_id)

            # Emit tool result as CustomToolDelta packet
            output = result.get("output", "")
            error = result.get("error")

            if error:
                self._emit(
                    CustomToolDelta(
                        tool_name=tool_name,
                        response_type="error",
                        data=error,
                    ),
                    step=step,
                )
            else:
                self._emit(
                    CustomToolDelta(
                        tool_name=tool_name,
                        response_type="text",
                        data=output,
                    ),
                    step=step,
                )

            self._emit(SectionEnd(), step=step)

            # Update DB with result
            if self._db_session:
                try:
                    from uuid import UUID as UUIDType
                    update_tool_message_result(
                        db_session=self._db_session,
                        session_id=UUIDType(self._session_id),
                        tool_call_id=tool_call_id,
                        tool_output={"output": output} if output else None,
                        tool_error=error,
                    )
                except Exception:
                    logger.warning("Failed to update tool result", exc_info=True)

            # Return to Agents SDK
            if error:
                return f"Error: {error}"
            return output or ""

        return handler

    def _wait_for_approval(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
    ) -> bool:
        """Emit approval request and block until user responds."""
        self._emit(
            AgentApprovalRequired(
                tool_name=tool_name,
                tool_input=tool_input,
                tool_call_id=tool_call_id,
            )
        )

        key = f"bud_agent_approval:{self._session_id}:{tool_call_id}"
        try:
            result = self._redis_client.blpop(key, timeout=TOOL_TIMEOUT_SECONDS)
            if result is None:
                logger.warning(
                    "Approval timeout for tool %s (%s)", tool_name, tool_call_id
                )
                return False
            _, data = result
            decision: dict[str, Any] = json.loads(data)
            return bool(decision.get("approved", False))
        except Exception:
            logger.exception("Error waiting for approval for %s", tool_name)
            return False
        finally:
            self._redis_client.delete(key)

    def _wait_for_tool_result(
        self,
        tool_name: str,
        tool_call_id: str,
    ) -> dict[str, Any]:
        """Block on Redis until desktop sends tool result."""
        key = f"bud_agent_tool_result:{self._session_id}:{tool_call_id}"
        try:
            result = self._redis_client.blpop(key, timeout=TOOL_TIMEOUT_SECONDS)
            if result is None:
                logger.warning(
                    "Tool timeout for %s (%s)", tool_name, tool_call_id
                )
                return {
                    "error": (
                        f"Tool '{tool_name}' timed out waiting for"
                        " desktop execution."
                    )
                }
            _, data = result
            parsed: dict[str, Any] = json.loads(data)
            return parsed
        except Exception:
            logger.exception("Error waiting for tool result for %s", tool_name)
            return {"error": f"Error waiting for tool result: {tool_name}"}
        finally:
            self._redis_client.delete(key)
