from typing import Any
from typing import Literal
from typing import Union

from onyx.server.query_and_chat.streaming_models import BaseObj


"""BudAgent Streaming Packets"""


class BudAgentThinking(BaseObj):
    type: Literal["bud_agent_thinking"] = "bud_agent_thinking"


class BudAgentText(BaseObj):
    type: Literal["bud_agent_text"] = "bud_agent_text"

    content: str


class BudAgentToolStart(BaseObj):
    type: Literal["bud_agent_tool_start"] = "bud_agent_tool_start"

    tool_name: str
    tool_input: dict[str, Any]
    tool_call_id: str
    is_local: bool


class BudAgentToolResult(BaseObj):
    type: Literal["bud_agent_tool_result"] = "bud_agent_tool_result"

    tool_name: str
    tool_output: str | None
    tool_error: str | None
    tool_call_id: str


class BudAgentLocalToolRequest(BaseObj):
    type: Literal["bud_agent_local_tool_request"] = "bud_agent_local_tool_request"

    tool_name: str
    tool_input: dict[str, Any]
    tool_call_id: str
    requires_approval: bool


class BudAgentApprovalRequired(BaseObj):
    type: Literal["bud_agent_approval_required"] = "bud_agent_approval_required"

    tool_name: str
    tool_input: dict[str, Any]
    tool_call_id: str


class BudAgentComplete(BaseObj):
    type: Literal["bud_agent_complete"] = "bud_agent_complete"

    content: str


class BudAgentError(BaseObj):
    type: Literal["bud_agent_error"] = "bud_agent_error"

    error: str


class BudAgentStopped(BaseObj):
    type: Literal["bud_agent_stopped"] = "bud_agent_stopped"


class BudAgentDone(BaseObj):
    type: Literal["bud_agent_done"] = "bud_agent_done"


"""BudAgent Packet Union"""

BudAgentPacket = Union[
    BudAgentThinking,
    BudAgentText,
    BudAgentToolStart,
    BudAgentToolResult,
    BudAgentLocalToolRequest,
    BudAgentApprovalRequired,
    BudAgentComplete,
    BudAgentError,
    BudAgentStopped,
    BudAgentDone,
]
