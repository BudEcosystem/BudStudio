"""API endpoints for agent connector management."""

from typing import Any

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.budapp_client import disconnect_oauth
from onyx.agents.bud_agent.budapp_client import fetch_tools_rest
from onyx.agents.bud_agent.budapp_client import get_token_status
from onyx.agents.bud_agent.budapp_client import initiate_oauth
from onyx.agents.bud_agent.budapp_client import list_connectors
from onyx.auth.users import current_user
from onyx.configs.app_configs import WEB_DOMAIN
from onyx.db.agent_connector import clear_connector_oauth
from onyx.db.agent_connector import get_connector_preferences
from onyx.db.agent_connector import get_tool_permissions
from onyx.db.agent_connector import mark_connector_oauth_completed
from onyx.db.agent_connector import upsert_connector_preference
from onyx.db.agent_connector import upsert_tool_permission
from onyx.db.engine.sql_engine import get_session
from onyx.db.enums import AgentToolPermissionLevel
from onyx.db.models import User
from onyx.llm.factory import _get_fresh_oauth_token
from onyx.utils.logger import setup_logger

logger = setup_logger()

router = APIRouter(prefix="/agent/connectors", tags=["AgentConnectors"])


# ==============================================================================
# Request / Response Models
# ==============================================================================


class ToggleConnectorRequest(BaseModel):
    enabled: bool
    gateway_name: str = ""


class SetToolPermissionRequest(BaseModel):
    permission: str  # "always_allow" | "need_approval" | "blocked"


class SetConnectorPermissionRequest(BaseModel):
    permission: str  # "always_allow" | "need_approval" | "blocked"


# ==============================================================================
# Endpoints
# ==============================================================================


@router.get("")
def list_agent_connectors(
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    """List connectors from BudApp merged with user preferences."""
    token = _get_fresh_oauth_token(user)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth token not available")

    # Fetch connectors from BudApp
    try:
        remote_connectors = list_connectors(token)
    except Exception as e:
        logger.warning("Failed to list connectors from BudApp: %s", e)
        remote_connectors = []

    # Fetch user preferences from DB
    prefs = get_connector_preferences(db_session, user.id)
    prefs_by_gw: dict[str, Any] = {p.gateway_id: p for p in prefs}

    # Merge
    result: list[dict[str, Any]] = []
    for connector in remote_connectors:
        gw_id = connector.get("id", connector.get("gateway_id", ""))
        gw_name = connector.get("name", "")
        pref = prefs_by_gw.get(gw_id)

        # Determine OAuth status:
        # - If the user has a DB preference, trust it (they may have disconnected)
        # - If no preference exists, fall back to BudApp's reported status
        budapp_oauth = bool(connector.get("oauth_connected", False))
        if pref:
            oauth_done = pref.oauth_completed
            # Backfill gateway_name if it was missing
            if gw_name and not pref.gateway_name:
                upsert_connector_preference(
                    db_session=db_session,
                    user_id=user.id,
                    gateway_id=gw_id,
                    gateway_name=gw_name,
                    enabled=pref.enabled,
                )
        else:
            oauth_done = budapp_oauth
            # Seed a preference row so future toggles preserve OAuth state
            if budapp_oauth:
                upsert_connector_preference(
                    db_session=db_session,
                    user_id=user.id,
                    gateway_id=gw_id,
                    gateway_name=gw_name,
                    enabled=False,
                    oauth_completed=True,
                )

        default_perm = (
            pref.default_permission.value
            if pref and pref.default_permission
            else "need_approval"
        )
        result.append({
            **connector,
            # Normalize camelCase for frontend compatibility
            "authType": connector.get("auth_type"),
            "user_enabled": pref.enabled if pref else False,
            "oauth_completed": oauth_done,
            "default_permission": default_perm,
        })

    return result


@router.patch("/{gateway_id}/toggle")
def toggle_connector(
    gateway_id: str,
    body: ToggleConnectorRequest,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Enable or disable a connector for the current user."""
    pref = upsert_connector_preference(
        db_session=db_session,
        user_id=user.id,
        gateway_id=gateway_id,
        gateway_name=body.gateway_name,
        enabled=body.enabled,
    )
    return {
        "gateway_id": pref.gateway_id,
        "enabled": pref.enabled,
        "oauth_completed": pref.oauth_completed,
    }


@router.patch("/{gateway_id}/permission")
def set_connector_permission(
    gateway_id: str,
    body: SetConnectorPermissionRequest,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Set the default permission level for all tools in a connector."""
    try:
        level = AgentToolPermissionLevel(body.permission)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid permission level: {body.permission}. "
            f"Must be one of: always_allow, need_approval, blocked",
        )

    pref = upsert_connector_preference(
        db_session=db_session,
        user_id=user.id,
        gateway_id=gateway_id,
        enabled=True,
        default_permission=level,
        set_default_permission=True,
    )
    return {
        "gateway_id": pref.gateway_id,
        "default_permission": pref.default_permission.value
        if pref.default_permission
        else "need_approval",
    }


@router.post("/{gateway_id}/oauth/initiate")
def initiate_connector_oauth(
    gateway_id: str,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Start the OAuth flow for a connector."""
    token = _get_fresh_oauth_token(user)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth token not available")

    return_url = f"{WEB_DOMAIN}/connector/oauth/done"
    try:
        result = initiate_oauth(token, gateway_id, return_url=return_url)
    except Exception as e:
        logger.exception("OAuth initiation failed for gateway %s", gateway_id)
        raise HTTPException(status_code=502, detail=str(e))

    # Ensure a preference row exists
    upsert_connector_preference(
        db_session=db_session,
        user_id=user.id,
        gateway_id=gateway_id,
        enabled=True,
    )

    return result


@router.get("/{gateway_id}/oauth/status")
def get_connector_oauth_status(
    gateway_id: str,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Check the OAuth token status for a connector."""
    token = _get_fresh_oauth_token(user)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth token not available")

    try:
        status = get_token_status(token, gateway_id)
    except Exception as e:
        logger.warning("OAuth status check failed for gateway %s: %s", gateway_id, e)
        raise HTTPException(status_code=502, detail=str(e))

    # Map BudApp's "connected" field to "completed" for backward compat
    completed = status.get("connected", False)
    if completed:
        mark_connector_oauth_completed(db_session, user.id, gateway_id)

    return {**status, "completed": completed}


@router.post("/{gateway_id}/oauth/complete")
def complete_connector_oauth(
    gateway_id: str,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Mark a connector's OAuth as complete after the callback flow.

    Verifies with BudApp that the token is actually active before marking
    in our DB (prevents the frontend from falsely claiming success).
    """
    token = _get_fresh_oauth_token(user)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth token not available")

    try:
        status = get_token_status(token, gateway_id)
    except Exception as e:
        logger.warning(
            "Token status check failed during complete for gateway %s: %s",
            gateway_id,
            e,
        )
        raise HTTPException(status_code=502, detail=str(e))

    if not status.get("connected", False):
        raise HTTPException(
            status_code=400,
            detail="OAuth token is not connected on BudApp",
        )

    mark_connector_oauth_completed(db_session, user.id, gateway_id)
    return {"gateway_id": gateway_id, "completed": True}


@router.post("/{gateway_id}/oauth/disconnect")
def disconnect_connector_oauth(
    gateway_id: str,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Disconnect / revoke OAuth for a connector."""
    token = _get_fresh_oauth_token(user)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth token not available")

    # Try to revoke on BudApp side
    try:
        disconnect_oauth(token, gateway_id)
    except Exception as e:
        logger.warning(
            "BudApp OAuth disconnect failed for gateway %s: %s", gateway_id, e
        )
        # Continue anyway — clear our local state regardless

    # Clear OAuth status in our DB
    clear_connector_oauth(db_session, user.id, gateway_id)

    return {"gateway_id": gateway_id, "disconnected": True}


@router.get("/{gateway_id}/tools")
def list_connector_tools(
    gateway_id: str,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    """List tools for a connector with user permission levels."""
    token = _get_fresh_oauth_token(user)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth token not available")

    # Fetch tools from BudApp
    try:
        tools = fetch_tools_rest(token, gateway_id)
    except Exception as e:
        logger.warning("Failed to fetch tools for gateway %s: %s", gateway_id, e)
        tools = []

    # Get permissions from DB
    perms = get_tool_permissions(db_session, user.id, gateway_id)
    perms_by_name = {p.tool_name: p.permission_level.value for p in perms}

    # Merge
    result: list[dict[str, Any]] = []
    for tool in tools:
        tool_name = tool.get("name", "")
        result.append({
            **tool,
            "permission": perms_by_name.get(tool_name, "need_approval"),
        })

    return result


@router.patch("/{gateway_id}/tools/{tool_name}/permission")
def set_tool_permission(
    gateway_id: str,
    tool_name: str,
    body: SetToolPermissionRequest,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Set the permission level for a specific connector tool."""
    try:
        level = AgentToolPermissionLevel(body.permission)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid permission level: {body.permission}. "
            f"Must be one of: always_allow, need_approval, blocked",
        )

    perm = upsert_tool_permission(
        db_session=db_session,
        user_id=user.id,
        gateway_id=gateway_id,
        tool_name=tool_name,
        permission_level=level,
    )
    return {
        "gateway_id": perm.gateway_id,
        "tool_name": perm.tool_name,
        "permission": perm.permission_level.value,
    }
