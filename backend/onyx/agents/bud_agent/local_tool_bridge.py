"""Local tool bridge -- creates FunctionTool objects that delegate execution to the desktop.

When the LLM requests a local tool (file ops, bash, etc.), the bridge:
1. Emits a BudAgentLocalToolRequest via the packet queue
2. Blocks on Redis BLPOP waiting for the desktop to execute and POST the result
3. Returns the result to the Agents SDK
"""

import json
import uuid
from queue import Queue
from typing import Any
from typing import Callable
from typing import Coroutine

import redis

from agents import FunctionTool
from agents import RunContextWrapper

from onyx.agents.bud_agent.streaming_models import BudAgentApprovalRequired
from onyx.agents.bud_agent.streaming_models import BudAgentLocalToolRequest
from onyx.agents.bud_agent.streaming_models import BudAgentToolResult
from onyx.agents.bud_agent.streaming_models import BudAgentToolStart
from onyx.agents.bud_agent.tool_definitions import LOCAL_TOOL_SCHEMAS
from onyx.agents.bud_agent.tool_definitions import requires_approval
from onyx.utils.logger import setup_logger

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
    ) -> None:
        self._session_id = session_id
        self._packet_queue = packet_queue
        self._redis_client = redis_client

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

            # Emit tool_start event
            self._packet_queue.put(
                BudAgentToolStart(
                    tool_name=tool_name,
                    tool_input=tool_input,
                    tool_call_id=tool_call_id,
                    is_local=True,
                )
            )

            # Handle approval if required
            if requires_approval(tool_name):
                approved = self._wait_for_approval(
                    tool_name, tool_input, tool_call_id
                )
                if not approved:
                    error_msg = f"Tool '{tool_name}' was denied by the user."
                    self._packet_queue.put(
                        BudAgentToolResult(
                            tool_name=tool_name,
                            tool_output=None,
                            tool_error=error_msg,
                            tool_call_id=tool_call_id,
                        )
                    )
                    return error_msg

            # Emit local tool request (tells desktop to execute)
            self._packet_queue.put(
                BudAgentLocalToolRequest(
                    tool_name=tool_name,
                    tool_input=tool_input,
                    tool_call_id=tool_call_id,
                    requires_approval=False,  # Already handled above
                )
            )

            # Block on Redis waiting for desktop result
            result = self._wait_for_tool_result(tool_name, tool_call_id)

            # Emit tool_result event
            self._packet_queue.put(
                BudAgentToolResult(
                    tool_name=tool_name,
                    tool_output=result.get("output"),
                    tool_error=result.get("error"),
                    tool_call_id=tool_call_id,
                )
            )

            # Return to Agents SDK
            if result.get("error"):
                return f"Error: {result['error']}"
            return result.get("output", "")

        return handler

    def _wait_for_approval(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        tool_call_id: str,
    ) -> bool:
        """Emit approval request and block until user responds."""
        self._packet_queue.put(
            BudAgentApprovalRequired(
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
