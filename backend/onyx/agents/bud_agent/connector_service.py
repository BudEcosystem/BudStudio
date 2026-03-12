"""Connector service for BudAgent — discovers and wraps BudApp MCP tools.

Provides FunctionTool factories that:
1. List tools per connector via the BudApp REST API
2. Discover tool schemas from the MCP gateway
3. Apply per-tool permission levels (always_allow / need_approval / blocked)
4. Execute tools via the MCP gateway
"""

import json
import uuid
from queue import Queue
from typing import Any
from typing import Callable
from typing import Coroutine
from uuid import UUID

import redis
from httpx import HTTPStatusError
from httpx import RequestError

from agents import FunctionTool
from agents import RunContextWrapper

from onyx.agents.bud_agent.budapp_client import fetch_tools_rest
from onyx.agents.bud_agent.budapp_client import list_connectors
from onyx.agents.bud_agent.mcp_service import _needs_non_strict
from onyx.db.agent import add_tool_message
from onyx.db.agent import update_tool_message_result
from onyx.server.query_and_chat.streaming_models import AgentApprovalRequired
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import SectionEnd
from onyx.configs.model_configs import BUD_FOUNDRY_APP_BASE
from onyx.configs.model_configs import BUD_MCP_GATEWAY_URL
from onyx.db.agent_connector import get_all_tool_permissions
from onyx.db.agent_connector import get_connector_default_permissions
from onyx.db.agent_connector import get_enabled_connector_ids
from onyx.db.enums import AgentToolPermissionLevel
from onyx.db.models import User
from onyx.llm.factory import get_fresh_oauth_token
from onyx.tools.tool_implementations.mcp.mcp_client import call_mcp_tool
from onyx.tools.tool_implementations.mcp.mcp_client import discover_mcp_tools
from onyx.utils.logger import setup_logger

logger = setup_logger()

APPROVAL_TIMEOUT_SECONDS = 300  # 5 minutes

# Type alias matching the Agents SDK on_invoke_tool signature
InvokeHandler = Callable[
    [RunContextWrapper[Any], str],
    Coroutine[Any, Any, str],
]


def _get_mcp_url() -> str:
    """Return the MCP gateway URL for connector tool discovery & execution."""
    if BUD_MCP_GATEWAY_URL:
        return BUD_MCP_GATEWAY_URL.rstrip("/")
    if not BUD_FOUNDRY_APP_BASE:
        raise RuntimeError(
            "Neither BUD_MCP_GATEWAY_URL nor BUD_FOUNDRY_APP_BASE is configured"
        )
    return f"{BUD_FOUNDRY_APP_BASE.rstrip('/')}/mcp"


def create_connector_tools(
    db_session: Any,
    user: User,
    session_id: UUID,
    packet_queue: Queue[Any],
    redis_client: redis.Redis,  # type: ignore[type-arg]
    step_number_fn: Callable[[], int] | None = None,
    auto_approve: bool = False,
) -> list[FunctionTool]:
    """Create FunctionTool objects for all enabled BudApp connector tools.

    Steps:
    1. Get user's enabled gateway IDs from DB
    2. Cross-check against BudApp's active connector list
    3. For each valid connector, fetch its tool names via BudApp REST API
       to build an exact tool_name → gateway_id mapping
    4. Discover tool schemas from the MCP gateway
    5. Create FunctionTool for each tool with appropriate permissions

    Returns an empty list if BudApp is unreachable or not configured.
    """
    if not BUD_MCP_GATEWAY_URL and not BUD_FOUNDRY_APP_BASE:
        return []

    # 1. Get OAuth token (needed for both BudApp REST and MCP calls)
    access_token = get_fresh_oauth_token(user)
    if not access_token:
        logger.warning("No OAuth token available for connector tools")
        return []

    # 2. Get enabled gateways from local DB
    enabled_ids = get_enabled_connector_ids(db_session, user.id)
    if not enabled_ids:
        return []

    # 3. Cross-check against BudApp's active connector list.
    try:
        remote_connectors = list_connectors(access_token)
        remote_ids = {
            c.get("id", c.get("gateway_id", ""))
            for c in remote_connectors
        }
        valid_ids = [gid for gid in enabled_ids if gid in remote_ids]
        if not valid_ids:
            logger.info(
                "No enabled connectors match BudApp's active list for user %s "
                "(enabled=%d, remote=%d)",
                user.id,
                len(enabled_ids),
                len(remote_ids),
            )
            return []
        if len(valid_ids) < len(enabled_ids):
            logger.info(
                "Filtered %d -> %d connectors after BudApp cross-check",
                len(enabled_ids),
                len(valid_ids),
            )
        enabled_ids = valid_ids
    except Exception:
        logger.warning(
            "Failed to fetch BudApp connector list, using local DB only",
            exc_info=True,
        )

    # 4. For each valid connector, fetch its tool names via BudApp REST API.
    #    This gives us an exact tool_name → gateway_id mapping — no slug
    #    parsing needed.
    tool_to_gateway: dict[str, str] = {}
    for gw_id in enabled_ids:
        try:
            rest_tools = fetch_tools_rest(access_token, gw_id)
            for rt in rest_tools:
                tname = rt.get("name") or rt.get("tool_name") or ""
                if tname:
                    tool_to_gateway[tname] = gw_id
        except (RequestError, HTTPStatusError):
            logger.warning(
                "Failed to fetch tool list for connector %s", gw_id,
                exc_info=True,
            )

    logger.info(
        "Fetched %d tool names from %d connector(s) via REST API",
        len(tool_to_gateway),
        len(enabled_ids),
    )

    # 5. Get tool permissions and connector-level defaults
    permissions = get_all_tool_permissions(db_session, user.id)
    connector_defaults = get_connector_default_permissions(db_session, user.id)

    # 6. Discover tool schemas from MCP gateway
    mcp_url = _get_mcp_url()
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        mcp_tools = discover_mcp_tools(
            server_url=mcp_url,
            connection_headers=headers,
        )
    except Exception:
        logger.warning("Failed to discover BudApp MCP tools", exc_info=True)
        return []

    # 7. Build FunctionTool objects
    tools: list[FunctionTool] = []

    for mcp_tool in mcp_tools:
        tool_name = mcp_tool.name
        gateway_id = tool_to_gateway.get(tool_name)

        # Permission resolution:
        # 1. Per-tool override  2. Connector default  3. Global fallback
        # When REST→MCP name mapping misses, search all enabled gateways.
        perm_level: AgentToolPermissionLevel | None = None
        if gateway_id is not None:
            perm_key = f"{gateway_id}:{tool_name}"
            perm_level = permissions.get(perm_key)
            if perm_level is None:
                perm_level = connector_defaults.get(gateway_id)
        else:
            # REST API didn't list this tool — search permissions across
            # all enabled gateways by tool_name.
            for gw_id in enabled_ids:
                perm_level = permissions.get(f"{gw_id}:{tool_name}")
                if perm_level is not None:
                    gateway_id = gw_id
                    break
            # Fall back to connector-level defaults
            if perm_level is None:
                for gw_id in enabled_ids:
                    perm_level = connector_defaults.get(gw_id)
                    if perm_level is not None:
                        gateway_id = gw_id
                        break
            # If still no gateway, default to the sole enabled gateway
            # so the frontend can persist permissions later.
            if gateway_id is None and len(enabled_ids) == 1:
                gateway_id = enabled_ids[0]
        if perm_level is None:
            perm_level = AgentToolPermissionLevel.NEED_APPROVAL
        # In headless modes (cron, inbox) there's no frontend to approve,
        # so auto-approve all non-blocked tools.
        if auto_approve and perm_level == AgentToolPermissionLevel.NEED_APPROVAL:
            perm_level = AgentToolPermissionLevel.ALWAYS_ALLOW
        if perm_level == AgentToolPermissionLevel.BLOCKED:
            continue

        # Build JSON schema from MCP tool definition
        params_schema = (
            mcp_tool.inputSchema
            if mcp_tool.inputSchema
            else {"type": "object", "properties": {}}
        )

        tool = FunctionTool(
            name=tool_name,
            description=mcp_tool.description or f"Connector tool: {tool_name}",
            params_json_schema=params_schema,
            strict_json_schema=not _needs_non_strict(params_schema),
            on_invoke_tool=_make_invoke_handler(
                tool_name=tool_name,
                mcp_url=mcp_url,
                headers=headers,
                permission_level=perm_level,
                session_id=str(session_id),
                packet_queue=packet_queue,
                redis_client=redis_client,
                step_number_fn=step_number_fn,
                gateway_id=gateway_id,
                db_session=db_session,
            ),
        )
        tools.append(tool)

    logger.info(
        "Created %d connector tools from %d MCP tools for user %s",
        len(tools),
        len(mcp_tools),
        user.id,
    )
    return tools


def _make_invoke_handler(
    tool_name: str,
    mcp_url: str,
    headers: dict[str, str],
    permission_level: AgentToolPermissionLevel,
    session_id: str,
    packet_queue: Queue[Any],
    redis_client: redis.Redis,  # type: ignore[type-arg]
    step_number_fn: Callable[[], int] | None = None,
    gateway_id: str | None = None,
    db_session: Any | None = None,
) -> InvokeHandler:
    """Create an async handler for a connector tool."""

    async def handler(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        # Get the step number once for this entire tool call so all
        # packets share the same ind.  step_number_fn() also closes any
        # open message/reasoning section and increments the step counter.
        tool_step = step_number_fn() if step_number_fn else 0

        def _emit(obj: Any) -> None:
            """Put a streaming object on the queue wrapped in a Packet."""
            packet_queue.put(Packet(ind=tool_step, obj=obj))

        tool_call_id = str(uuid.uuid4())
        tool_input: dict[str, Any] = (
            json.loads(json_string) if json_string and json_string.strip() else {}
        )

        # Strip empty/null optional args that LLMs often hallucinate.
        # Keeps False and 0 (valid values) but drops None and "".
        tool_input = {
            k: v
            for k, v in tool_input.items()
            if v is not None and v != ""
        }

        # Emit tool_start (using CustomToolStart which is in the Packet union)
        _emit(CustomToolStart(tool_name=tool_name))

        # Persist tool message to DB
        if db_session:
            try:
                add_tool_message(
                    db_session=db_session,
                    session_id=UUID(session_id),
                    tool_name=tool_name,
                    tool_input=tool_input,
                    tool_call_id=tool_call_id,
                    step_number=tool_step,
                )
            except Exception:
                logger.warning(
                    "Failed to persist connector tool message",
                    exc_info=True,
                )

        # Handle approval if needed
        if permission_level == AgentToolPermissionLevel.NEED_APPROVAL:
            approved = _wait_for_approval(
                session_id=session_id,
                tool_name=tool_name,
                tool_input=tool_input,
                tool_call_id=tool_call_id,
                packet_queue=packet_queue,
                redis_client=redis_client,
                tool_step=tool_step,
                gateway_id=gateway_id,
            )
            if not approved:
                error_msg = f"Tool '{tool_name}' was denied by the user."
                _emit(
                    CustomToolDelta(
                        tool_name=tool_name,
                        response_type="error",
                        data=error_msg,
                    )
                )
                _emit(SectionEnd())
                # Update DB with denial
                if db_session:
                    try:
                        update_tool_message_result(
                            db_session=db_session,
                            session_id=UUID(session_id),
                            tool_call_id=tool_call_id,
                            tool_error=error_msg,
                        )
                    except Exception:
                        logger.warning(
                            "Failed to update denied connector tool",
                            exc_info=True,
                        )
                return error_msg

        # Execute via MCP
        try:
            result = call_mcp_tool(
                server_url=mcp_url,
                tool_name=tool_name,
                arguments=tool_input,
                connection_headers=headers,
            )
        except Exception as e:
            error_msg = f"Error calling connector tool '{tool_name}': {e}"
            logger.exception(error_msg)
            _emit(
                CustomToolDelta(
                    tool_name=tool_name,
                    response_type="error",
                    data=error_msg,
                )
            )
            _emit(SectionEnd())
            # Update DB with error
            if db_session:
                try:
                    update_tool_message_result(
                        db_session=db_session,
                        session_id=UUID(session_id),
                        tool_call_id=tool_call_id,
                        tool_error=error_msg,
                    )
                except Exception:
                    logger.warning(
                        "Failed to update connector tool error",
                        exc_info=True,
                    )
            return error_msg

        # Emit result
        _emit(
            CustomToolDelta(
                tool_name=tool_name,
                response_type="text",
                data=result,
            )
        )
        _emit(SectionEnd())

        # Update DB with result
        if db_session:
            try:
                update_tool_message_result(
                    db_session=db_session,
                    session_id=UUID(session_id),
                    tool_call_id=tool_call_id,
                    tool_output={"output": result},
                )
            except Exception:
                logger.warning(
                    "Failed to update connector tool result",
                    exc_info=True,
                )

        return result

    return handler


def _wait_for_approval(
    session_id: str,
    tool_name: str,
    tool_input: dict[str, Any],
    tool_call_id: str,
    packet_queue: Queue[Any],
    redis_client: redis.Redis,  # type: ignore[type-arg]
    tool_step: int = 0,
    gateway_id: str | None = None,
) -> bool:
    """Emit approval request and block until user responds via Redis."""
    approval_obj = AgentApprovalRequired(
        tool_name=tool_name,
        tool_input=tool_input,
        tool_call_id=tool_call_id,
        gateway_id=gateway_id,
    )
    packet_queue.put(Packet(ind=tool_step, obj=approval_obj))

    key = f"bud_agent_approval:{session_id}:{tool_call_id}"
    try:
        result = redis_client.blpop(key, timeout=APPROVAL_TIMEOUT_SECONDS)
        if result is None:
            logger.warning(
                "Approval timeout for connector tool %s (%s)",
                tool_name,
                tool_call_id,
            )
            return False
        _, data = result
        decision: dict[str, Any] = json.loads(data)
        return bool(decision.get("approved", False))
    except Exception:
        logger.exception("Error waiting for approval for %s", tool_name)
        return False
    finally:
        redis_client.delete(key)
