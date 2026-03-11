"""Default MCP tool service for BudAgent.

Reads system-managed MCPServer + Tool records from the DB (synced at startup)
and wraps each as an Agents SDK FunctionTool.  No per-message MCP discovery
overhead — tool definitions come from Postgres.
"""

import copy
import json
from queue import Queue
from typing import Any
from typing import Callable
from typing import Coroutine
from uuid import UUID

from agents import FunctionTool
from agents import RunContextWrapper
from sqlalchemy.orm import Session

from onyx.db.mcp import get_all_mcp_tools_for_server
from onyx.db.mcp import get_mcp_servers_by_owner
from onyx.db.mcp import SYSTEM_MCP_OWNER
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd
from onyx.tools.tool_implementations.mcp.mcp_client import call_mcp_tool
from onyx.utils.logger import setup_logger

logger = setup_logger()


def _sanitize_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Fix common JSON Schema issues that LLM providers reject.

    - Arrays missing ``items`` get ``items: {}`` (any type).
    """
    if not isinstance(schema, dict):
        return schema

    if schema.get("type") == "array" and "items" not in schema:
        schema["items"] = {}

    for key in ("properties", "definitions", "$defs"):
        if key in schema and isinstance(schema[key], dict):
            for prop_name, prop_schema in schema[key].items():
                if isinstance(prop_schema, dict):
                    schema[key][prop_name] = _sanitize_schema(prop_schema)

    for key in ("items", "additionalProperties"):
        if key in schema and isinstance(schema[key], dict):
            schema[key] = _sanitize_schema(schema[key])

    for key in ("allOf", "anyOf", "oneOf"):
        if key in schema and isinstance(schema[key], list):
            schema[key] = [
                _sanitize_schema(s) if isinstance(s, dict) else s
                for s in schema[key]
            ]

    return schema


def _needs_non_strict(schema: dict[str, Any]) -> bool:
    """Return True if *schema* contains free-form objects (``additionalProperties: true``
    without explicit ``properties``) that are incompatible with the Agents SDK
    strict mode.  Strict mode forces ``additionalProperties: false`` which
    would prevent the LLM from sending arbitrary key-value pairs.
    """
    if not isinstance(schema, dict):
        return False

    if (
        schema.get("type") == "object"
        and schema.get("additionalProperties")
    ):
        return True

    for key in ("properties", "definitions", "$defs"):
        sub = schema.get(key)
        if isinstance(sub, dict):
            for v in sub.values():
                if isinstance(v, dict) and _needs_non_strict(v):
                    return True

    for key in ("items", "additionalProperties"):
        sub = schema.get(key)
        if isinstance(sub, dict) and _needs_non_strict(sub):
            return True

    for key in ("allOf", "anyOf", "oneOf"):
        sub = schema.get(key)
        if isinstance(sub, list):
            for item in sub:
                if isinstance(item, dict) and _needs_non_strict(item):
                    return True

    return False


# Type alias matching the Agents SDK on_invoke_tool signature
InvokeHandler = Callable[
    [RunContextWrapper[Any], str],
    Coroutine[Any, Any, str],
]


def create_default_mcp_tools(
    db_session: Session,
    session_id: UUID,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
) -> list[FunctionTool]:
    """Create FunctionTool objects for all system-managed MCP server tools.

    Reads MCPServer records owned by SYSTEM_MCP_OWNER, fetches their
    enabled Tool records, and wraps each as a FunctionTool that calls
    the MCP server at invocation time.

    Returns an empty list if no system MCP servers exist or on error.
    """
    try:
        servers = get_mcp_servers_by_owner(SYSTEM_MCP_OWNER, db_session)
    except Exception:
        logger.warning("Failed to load system MCP servers", exc_info=True)
        return []

    if not servers:
        return []

    tools: list[FunctionTool] = []

    for server in servers:
        try:
            db_tools = get_all_mcp_tools_for_server(server.id, db_session)
        except Exception:
            logger.warning(
                "Failed to load tools for MCP server %s (%s)",
                server.name,
                server.server_url,
                exc_info=True,
            )
            continue

        for db_tool in db_tools:
            if not db_tool.enabled:
                continue

            params_schema = _sanitize_schema(
                copy.deepcopy(db_tool.mcp_input_schema)
                if db_tool.mcp_input_schema
                else {"type": "object", "properties": {}}
            )

            tool = FunctionTool(
                name=db_tool.name,
                description=db_tool.description or f"MCP tool: {db_tool.name}",
                params_json_schema=params_schema,
                on_invoke_tool=_make_invoke_handler(
                    tool_name=db_tool.name,
                    server_url=server.server_url,
                    packet_queue=packet_queue,
                    step_number_fn=step_number_fn,
                ),
                strict_json_schema=not _needs_non_strict(params_schema),
            )
            tools.append(tool)

    logger.info(
        "Created %d default MCP tools from %d system server(s)",
        len(tools),
        len(servers),
    )
    return tools


def _make_invoke_handler(
    tool_name: str,
    server_url: str,
    packet_queue: Queue[Any],
    step_number_fn: Callable[[], int] | None = None,
) -> InvokeHandler:
    """Create an async handler that executes an MCP tool call."""

    def _emit(obj: Any) -> None:
        ind = step_number_fn() if step_number_fn else 0
        packet_queue.put(Packet(ind=ind, obj=obj))

    async def handler(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        tool_input: dict[str, Any] = (
            json.loads(json_string) if json_string else {}
        )
        # Strip empty/null optional args that LLMs often hallucinate
        tool_input = {
            k: v for k, v in tool_input.items()
            if v is not None and v != ""
        }

        _emit(CustomToolStart(tool_name=tool_name))

        try:
            result = call_mcp_tool(
                server_url=server_url,
                tool_name=tool_name,
                arguments=tool_input,
                connection_headers=None,
            )
        except Exception as e:
            error_msg = f"Error calling MCP tool '{tool_name}': {e}"
            logger.exception(error_msg)
            _emit(CustomToolDelta(
                tool_name=tool_name,
                response_type="error",
                data=error_msg,
            ))
            _emit(SectionEnd())
            return error_msg

        _emit(CustomToolDelta(
            tool_name=tool_name,
            response_type="text",
            data=result,
        ))
        _emit(SectionEnd())
        return result

    return handler
