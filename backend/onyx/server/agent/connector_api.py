"""API endpoints for agent connector management."""

from typing import Any

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from httpx import HTTPStatusError
from httpx import RequestError
from pydantic import BaseModel
from sqlalchemy import update as sa_update
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
from onyx.db.models import AgentConnectorPreference
from onyx.db.models import User
from onyx.llm.factory import get_fresh_oauth_token
from onyx.redis.redis_pool import get_redis_client
from onyx.utils.logger import setup_logger

logger = setup_logger()

router = APIRouter(prefix="/agent/connectors", tags=["AgentConnectors"])

# Redis key prefix for tracking which user initiated an OAuth flow.
# Desktop-app flows open a browser where a *different* Onyx user may be
# logged in, so we need to remember the initiator.
_OAUTH_INITIATOR_PREFIX = "oauth_initiator:"
_OAUTH_INITIATOR_TTL = 600  # 10 minutes — generous for slow OAuth flows


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
    token = get_fresh_oauth_token(user)
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

    # Verify actual per-user token status with BudApp.
    # The list endpoint's oauth_connected is workspace-level (not per-user),
    # so we must check each connector's token-status individually.
    token_status_cache: dict[str, bool] = {}
    for connector in remote_connectors:
        gw_id = connector.get("id", connector.get("gateway_id", ""))
        auth_type = str(connector.get("auth_type", "") or "").upper()
        if auth_type == "NONE":
            token_status_cache[gw_id] = True
            continue
        try:
            status = get_token_status(token, gw_id)
            token_status_cache[gw_id] = bool(status.get("connected", False))
        except (RequestError, HTTPStatusError):
            logger.debug(
                "Token status check failed for %s, falling back to DB", gw_id
            )
            token_status_cache[gw_id] = False

    # Merge remote connectors with local preferences.
    # Track whether any DB updates are needed so we can batch-commit.
    dirty = False
    result: list[dict[str, Any]] = []
    for connector in remote_connectors:
        gw_id = connector.get("id", connector.get("gateway_id", ""))
        gw_name = connector.get("name", "")
        pref = prefs_by_gw.get(gw_id)

        # Use verified token status from BudApp
        oauth_done = token_status_cache.get(gw_id, False)

        # Sync our DB oauth_completed with actual BudApp status.
        # Only update the flag — don't touch enabled or other fields.
        if pref and pref.oauth_completed != oauth_done:
            logger.debug(
                "Syncing oauth_completed for %s (%s): DB=%s -> BudApp=%s",
                gw_name, gw_id, pref.oauth_completed, oauth_done,
            )
            db_session.execute(
                sa_update(AgentConnectorPreference)  # type: ignore[arg-type]
                .where(AgentConnectorPreference.id == pref.id)
                .values(oauth_completed=oauth_done)
            )
            pref.oauth_completed = oauth_done
            dirty = True
            # Backfill gateway_name if it was missing
            if gw_name and not pref.gateway_name:
                upsert_connector_preference(
                    db_session=db_session,
                    user_id=user.id,
                    gateway_id=gw_id,
                    gateway_name=gw_name,
                    enabled=pref.enabled,
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

    # Clean up stale preferences for connectors no longer in BudApp.
    # Disable them so they don't pollute tool discovery.
    remote_ids = {
        c.get("id", c.get("gateway_id", "")) for c in remote_connectors
    }
    for gw_id, pref in prefs_by_gw.items():
        if gw_id not in remote_ids and (pref.enabled or pref.oauth_completed):
            logger.info(
                "Disabling stale connector %s (%s) — removed from BudApp",
                pref.gateway_name, gw_id,
            )
            db_session.execute(
                sa_update(AgentConnectorPreference)  # type: ignore[arg-type]
                .where(AgentConnectorPreference.id == pref.id)
                .values(enabled=False, oauth_completed=False)
            )
            dirty = True

    if dirty:
        db_session.commit()

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
    token = get_fresh_oauth_token(user)
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

    # Remember who initiated the OAuth flow so the /complete endpoint can
    # use the correct user's token even if the callback lands in a browser
    # session belonging to a different Onyx user (common in desktop-app flows).
    try:
        redis_client = get_redis_client()
        redis_client.set(
            f"{_OAUTH_INITIATOR_PREFIX}{gateway_id}",
            str(user.id),
            ex=_OAUTH_INITIATOR_TTL,
        )
    except Exception:
        logger.warning("Failed to store OAuth initiator in Redis", exc_info=True)

    return result


@router.get("/{gateway_id}/oauth/status")
def get_connector_oauth_status(
    gateway_id: str,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Check the OAuth token status for a connector."""
    token = get_fresh_oauth_token(user)
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
    in our DB.

    Desktop-app flows open a system browser that may have a different Onyx
    session than the user who initiated the OAuth flow.  When that happens,
    we fall back to the initiating user's token for the BudApp check.
    """
    # Determine the *initiating* user — may differ from `user` (browser session)
    # when the OAuth callback lands in a browser logged in as someone else.
    effective_user = user
    try:
        redis_client = get_redis_client()
        initiator_id_raw = redis_client.get(
            f"{_OAUTH_INITIATOR_PREFIX}{gateway_id}"
        )
        if initiator_id_raw:
            from uuid import UUID as UUIDType

            initiator_id = UUIDType(
                initiator_id_raw
                if isinstance(initiator_id_raw, str)
                else initiator_id_raw.decode()
            )
            if initiator_id != user.id:
                # Look up the initiating user so we can use their token
                initiator = db_session.query(User).filter(
                    User.id == initiator_id
                ).first()
                if initiator:
                    logger.info(
                        "complete_connector_oauth: browser user=%s differs "
                        "from initiator=%s, using initiator's token",
                        user.email,
                        initiator.email,
                    )
                    effective_user = initiator
            # Clean up the Redis key
            redis_client.delete(f"{_OAUTH_INITIATOR_PREFIX}{gateway_id}")
    except Exception:
        logger.warning(
            "Failed to look up OAuth initiator from Redis", exc_info=True
        )

    logger.info(
        "complete_connector_oauth: effective_user=%s, gateway=%s",
        effective_user.email,
        gateway_id,
    )
    token = get_fresh_oauth_token(effective_user)
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

    logger.info(
        "complete_connector_oauth: BudApp token-status response: %s",
        status,
    )

    if not status.get("connected", False):
        raise HTTPException(
            status_code=400,
            detail="OAuth token is not connected on BudApp",
        )

    # Mark complete for the *initiating* user (not the browser session user)
    mark_connector_oauth_completed(db_session, effective_user.id, gateway_id)
    return {"gateway_id": gateway_id, "completed": True}


@router.post("/{gateway_id}/oauth/disconnect")
def disconnect_connector_oauth(
    gateway_id: str,
    user: User = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Disconnect / revoke OAuth for a connector."""
    token = get_fresh_oauth_token(user)
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
    """List tools for a connector with user permission levels.

    Fetches tools from the BudApp REST API (which already includes
    ``inputSchema`` from the MCP source) and normalises the response
    so the frontend receives ``name``, ``description``, ``parameters``
    and ``permission`` — the same shape the agent sees.
    """
    token = get_fresh_oauth_token(user)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth token not available")

    # 1. Fetch tools for this gateway from BudApp REST
    try:
        rest_tools = fetch_tools_rest(token, gateway_id)
    except Exception as e:
        logger.warning("Failed to fetch tools for gateway %s: %s", gateway_id, e)
        rest_tools = []

    # 2. Get per-tool permissions from DB
    perms = get_tool_permissions(db_session, user.id, gateway_id)
    perms_by_name = {p.tool_name: p.permission_level.value for p in perms}

    # 3. Build normalised response — map inputSchema → parameters
    result: list[dict[str, Any]] = []
    for tool in rest_tools:
        tool_name = tool.get("name", "")
        result.append({
            "name": tool_name,
            "description": tool.get("description", ""),
            "parameters": tool.get("inputSchema") or {},
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
