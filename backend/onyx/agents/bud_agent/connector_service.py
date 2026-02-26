"""Connector service for BudAgent — discovers and wraps BudApp MCP tools.

Provides FunctionTool factories that:
1. Discover tools from the BudApp global MCP endpoint
2. Filter by user-enabled connectors
3. Apply per-tool permission levels (always_allow / need_approval / blocked)
4. Execute tools via the existing ``mcp_client.py`` helpers
"""

import json
import uuid
from queue import Queue
from typing import Any
from typing import Callable
from typing import Coroutine
from uuid import UUID

import redis

from agents import FunctionTool
from agents import RunContextWrapper

from onyx.agents.bud_agent.budapp_client import list_connectors
from onyx.server.query_and_chat.streaming_models import AgentApprovalRequired
from onyx.server.query_and_chat.streaming_models import CustomToolDelta
from onyx.server.query_and_chat.streaming_models import CustomToolStart
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.configs.model_configs import BUD_FOUNDRY_APP_BASE
from onyx.configs.model_configs import BUD_MCP_GATEWAY_URL
from onyx.db.agent_connector import get_all_tool_permissions
from onyx.db.agent_connector import get_connector_default_permissions
from onyx.db.agent_connector import get_enabled_connector_ids
from onyx.db.agent_connector import get_enabled_connector_slug_map
from onyx.db.enums import AgentToolPermissionLevel
from onyx.db.models import User
from onyx.llm.factory import _get_fresh_oauth_token
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
) -> list[FunctionTool]:
    """Create FunctionTool objects for all enabled BudApp connector tools.

    Steps:
    1. Get user's enabled gateway IDs from DB
    2. Get user's tool permissions from DB
    3. Discover all tools from the BudApp MCP endpoint
    4. Filter to enabled gateways only
    5. Create FunctionTool for each non-blocked tool with appropriate permission handling

    Returns an empty list if BudApp is unreachable or not configured.
    """
    if not BUD_MCP_GATEWAY_URL and not BUD_FOUNDRY_APP_BASE:
        return []

    # 1. Get OAuth token (needed for both BudApp REST and MCP calls)
    access_token = _get_fresh_oauth_token(user)
    if not access_token:
        logger.warning("No OAuth token available for connector tools")
        return []

    # 2. Get enabled gateways from local DB
    enabled_ids = get_enabled_connector_ids(db_session, user.id)
    if not enabled_ids:
        return []

    # 3. Cross-check against BudApp's active connector list.
    #    Only include connectors that BudApp still reports as available.
    try:
        remote_connectors = list_connectors(access_token)
        remote_ids = {
            c.get("id", c.get("gateway_id", ""))
            for c in remote_connectors
        }
        # Intersect: only keep locally enabled IDs that BudApp still knows about
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

    # 4. Get slug -> gateway_id mapping (for matching MCP tool name prefixes)
    #    Filter to only valid (BudApp-confirmed) IDs.
    slug_map = get_enabled_connector_slug_map(db_session, user.id)
    enabled_set = set(enabled_ids)
    slug_map = {
        slug: gid for slug, gid in slug_map.items() if gid in enabled_set
    }

    # 5. Get tool permissions and connector-level defaults
    permissions = get_all_tool_permissions(db_session, user.id)
    connector_defaults = get_connector_default_permissions(db_session, user.id)

    # 6. Discover tools from BudApp MCP
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
        # Match tool name to a gateway via slug mapping or direct ID match
        gateway_id = _extract_gateway_id(tool_name, enabled_set, slug_map)
        if gateway_id is None:
            continue

        # Three-tier permission resolution:
        # 1. Per-tool override  2. Connector default  3. Global fallback
        perm_key = f"{gateway_id}:{tool_name}"
        perm_level = permissions.get(perm_key)
        if perm_level is None:
            perm_level = connector_defaults.get(gateway_id)
        if perm_level is None:
            perm_level = AgentToolPermissionLevel.NEED_APPROVAL
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
            on_invoke_tool=_make_invoke_handler(
                tool_name=tool_name,
                mcp_url=mcp_url,
                headers=headers,
                permission_level=perm_level,
                session_id=str(session_id),
                packet_queue=packet_queue,
                redis_client=redis_client,
                step_number_fn=step_number_fn,
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


def _extract_gateway_id(
    tool_name: str,
    enabled_ids: set[str],
    slug_map: dict[str, str] | None = None,
) -> str | None:
    """Try to match a tool name to an enabled gateway ID.

    BudApp MCP tool names are prefixed with the connector slug (e.g.
    ``github-list-issues``).  The ``slug_map`` maps connector slugs
    (like ``github``) to their hex-UUID gateway IDs stored in the DB.

    Falls back to direct gateway ID prefix matching for backward
    compatibility.
    """
    # Primary: match via slug map (slug is the tool name prefix, lowercased)
    if slug_map:
        for sep in ("-", "__", "_"):
            parts = tool_name.split(sep, 1)
            if len(parts) > 1 and parts[0].lower() in slug_map:
                gw_id = slug_map[parts[0].lower()]
                if gw_id in enabled_ids:
                    return gw_id

    # Fallback: direct gateway ID match (if IDs happen to be prefixes)
    for gw_id in enabled_ids:
        if tool_name.startswith(gw_id):
            return gw_id

    return None


def _make_invoke_handler(
    tool_name: str,
    mcp_url: str,
    headers: dict[str, str],
    permission_level: AgentToolPermissionLevel,
    session_id: str,
    packet_queue: Queue[Any],
    redis_client: redis.Redis,  # type: ignore[type-arg]
    step_number_fn: Callable[[], int] | None = None,
) -> InvokeHandler:
    """Create an async handler for a connector tool."""

    def _emit(obj: Any) -> None:
        """Put a streaming object on the queue wrapped in a Packet."""
        ind = step_number_fn() if step_number_fn else 0
        packet_queue.put(Packet(ind=ind, obj=obj))

    async def handler(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        tool_call_id = str(uuid.uuid4())
        tool_input: dict[str, Any] = (
            json.loads(json_string) if json_string else {}
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

        # Handle approval if needed
        if permission_level == AgentToolPermissionLevel.NEED_APPROVAL:
            approved = _wait_for_approval(
                session_id=session_id,
                tool_name=tool_name,
                tool_input=tool_input,
                tool_call_id=tool_call_id,
                packet_queue=packet_queue,
                redis_client=redis_client,
                step_number_fn=step_number_fn,
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
            return error_msg

        # Emit result
        _emit(
            CustomToolDelta(
                tool_name=tool_name,
                response_type="text",
                data=result,
            )
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
    step_number_fn: Callable[[], int] | None = None,
) -> bool:
    """Emit approval request and block until user responds via Redis."""
    approval_obj = AgentApprovalRequired(
        tool_name=tool_name,
        tool_input=tool_input,
        tool_call_id=tool_call_id,
    )
    ind = step_number_fn() if step_number_fn else 0
    packet_queue.put(Packet(ind=ind, obj=approval_obj))

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
