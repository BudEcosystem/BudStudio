"""Thin REST client for BudApp connector management endpoints.

Handles OAuth initiation, status checks, and connector listing.
Tool discovery and execution use ``mcp_client.py`` instead.
"""

from typing import Any

import httpx

from onyx.configs.model_configs import BUD_FOUNDRY_APP_BASE
from onyx.utils.logger import setup_logger

logger = setup_logger()

_TIMEOUT = 15.0


def _base_url() -> str:
    if not BUD_FOUNDRY_APP_BASE:
        raise RuntimeError("BUD_FOUNDRY_APP_BASE is not configured")
    return BUD_FOUNDRY_APP_BASE.rstrip("/")


def _headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def list_connectors(access_token: str) -> list[dict[str, Any]]:
    """List all configured connectors from BudApp.

    GET /connectors/configured?client=dashboard&include_disabled=true
    """
    url = f"{_base_url()}/connectors/configured"
    resp = httpx.get(
        url,
        params={"client": "dashboard", "include_disabled": "true"},
        headers=_headers(access_token),
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    # BudApp may return either a list or an object with a "connectors" key
    if isinstance(data, list):
        return data
    return data.get("connectors", data.get("gateways", []))


def initiate_oauth(
    access_token: str,
    gateway_id: str,
    return_url: str | None = None,
) -> dict[str, Any]:
    """Initiate OAuth flow for a connector.

    POST /connectors/{gateway_id}/oauth/initiate[?return_url=...]
    Returns dict with at least ``authorization_url``.
    """
    url = f"{_base_url()}/connectors/{gateway_id}/oauth/initiate"
    params: dict[str, str] = {}
    if return_url:
        params["return_url"] = return_url
    resp = httpx.post(
        url,
        params=params,
        headers=_headers(access_token),
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def get_token_status(
    access_token: str,
    gateway_id: str,
) -> dict[str, Any]:
    """Check whether an OAuth token is active for a connector.

    GET /connectors/{gateway_id}/oauth/token-status
    Returns dict with ``connected: bool`` and possibly other fields.
    """
    url = f"{_base_url()}/connectors/{gateway_id}/oauth/token-status"
    resp = httpx.get(
        url,
        headers=_headers(access_token),
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def disconnect_oauth(
    access_token: str,
    gateway_id: str,
) -> dict[str, Any]:
    """Revoke the OAuth token for a connector.

    DELETE /connectors/{gateway_id}/oauth/token
    """
    url = f"{_base_url()}/connectors/{gateway_id}/oauth/token"
    resp = httpx.delete(
        url,
        headers=_headers(access_token),
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json() if resp.text else {"disconnected": True}


def fetch_tools_rest(
    access_token: str,
    gateway_id: str,
) -> list[dict[str, Any]]:
    """Fetch available tools for a connector.

    Tries GET /connectors/{gateway_id}/tools first, falls back to
    POST /connectors/{gateway_id}/fetch-tools.
    """
    base = _base_url()
    headers = _headers(access_token)

    # Try GET endpoint first (read-only)
    url = f"{base}/connectors/{gateway_id}/tools"
    resp = httpx.get(url, headers=headers, timeout=_TIMEOUT)
    logger.debug("GET %s -> %s", url, resp.status_code)
    if resp.status_code == 200:
        data = resp.json()
        tools: list[dict[str, Any]]
        if isinstance(data, list):
            tools = data
        else:
            tools = data.get("tools", [])
        # If GET returned tools, use them
        if tools:
            return tools
        # Otherwise fall through to POST to trigger a refresh

    # Fall back to POST (triggers refresh / creation of tools on BudApp)
    post_url = f"{base}/connectors/{gateway_id}/fetch-tools"
    resp = httpx.post(post_url, headers=headers, timeout=_TIMEOUT)
    logger.debug("POST %s -> %s", post_url, resp.status_code)
    resp.raise_for_status()
    data = resp.json()

    # The POST response may contain the tools directly …
    post_tools: list[dict[str, Any]] = []
    if isinstance(data, list):
        post_tools = data
    else:
        post_tools = data.get("tools", [])

    if post_tools:
        return post_tools

    # … or it may only confirm creation (e.g. "Successfully fetched and
    # created N tools").  In that case, re-fetch via GET.
    url = f"{base}/connectors/{gateway_id}/tools"
    resp = httpx.get(url, headers=headers, timeout=_TIMEOUT)
    logger.debug("GET (retry after POST) %s -> %s", url, resp.status_code)
    if resp.status_code == 200:
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("tools", [])

    return []
