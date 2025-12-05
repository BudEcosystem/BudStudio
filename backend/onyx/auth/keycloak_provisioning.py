"""Keycloak client auto-provisioning for Onyx.

This module provides functionality to automatically create or retrieve
a Keycloak OAuth client at startup, eliminating the need for manual
client configuration during deployment.
"""

import os

import httpx

from onyx.configs.app_configs import OAUTH_CLIENT_ID
from onyx.configs.app_configs import OAUTH_CLIENT_SECRET
from onyx.configs.app_configs import OPENID_CONFIG_URL
from onyx.utils.logger import setup_logger

logger = setup_logger()

# Configuration for Keycloak admin access
KEYCLOAK_ADMIN_URL = os.environ.get("KEYCLOAK_ADMIN_URL", "")
KEYCLOAK_ADMIN_USERNAME = os.environ.get("KEYCLOAK_ADMIN_USERNAME", "bud")
KEYCLOAK_ADMIN_PASSWORD = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "bud-keycloak")
ONYX_CLIENT_NAME = os.environ.get("ONYX_CLIENT_NAME", "onyx-client")


def derive_keycloak_url_from_oidc_config(openid_config_url: str) -> str:
    """Extract Keycloak base URL from OIDC configuration URL.

    Example:
      Input:  http://ditto-keycloak/realms/bud-keycloak/.well-known/openid-configuration
      Output: http://ditto-keycloak
    """
    if "/realms/" in openid_config_url:
        return openid_config_url.split("/realms/")[0]
    # Fallback: remove the last 3 path segments
    return openid_config_url.rsplit("/", 3)[0]


def _get_admin_token(base_url: str, username: str, password: str) -> str:
    """Get admin access token from Keycloak master realm.

    Args:
        base_url: Keycloak server base URL
        username: Admin username
        password: Admin password

    Returns:
        Access token string

    Raises:
        httpx.HTTPStatusError: If token request fails
    """
    token_url = f"{base_url}/realms/master/protocol/openid-connect/token"
    response = httpx.post(
        token_url,
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": username,
            "password": password,
        },
        timeout=30.0,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def provision_keycloak_client() -> tuple[str, str] | None:
    """Provision or retrieve Onyx client from Keycloak.

    This function will:
    1. Check if OAuth credentials are already configured (skip if so)
    2. Connect to Keycloak Admin API using admin credentials
    3. Create a new client or retrieve existing client credentials

    Returns:
        Tuple of (client_id, client_secret) if provisioning succeeded,
        None if skipped or failed.
    """
    # Skip if OAuth credentials already configured
    if OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET:
        logger.debug("OAuth credentials already configured, skipping Keycloak provisioning")
        return None

    # Skip if no OIDC config URL (not using OIDC auth)
    if not OPENID_CONFIG_URL:
        logger.debug("No OPENID_CONFIG_URL configured, skipping Keycloak provisioning")
        return None

    # Skip if no admin password (can't authenticate to Keycloak admin API)
    if not KEYCLOAK_ADMIN_PASSWORD:
        logger.warning(
            "KEYCLOAK_ADMIN_PASSWORD not set, cannot auto-provision OAuth client. "
            "Set KEYCLOAK_ADMIN_PASSWORD environment variable to enable auto-provisioning."
        )
        return None

    # Derive Keycloak URL from OIDC config if not explicitly set
    base_url = KEYCLOAK_ADMIN_URL or derive_keycloak_url_from_oidc_config(
        OPENID_CONFIG_URL
    )

    try:
        logger.notice(f"Provisioning OAuth client from Keycloak at {base_url}...")

        # Get admin access token
        token = _get_admin_token(
            base_url, KEYCLOAK_ADMIN_USERNAME, KEYCLOAK_ADMIN_PASSWORD
        )
        headers = {"Authorization": f"Bearer {token}"}

        # Check if client already exists
        clients_url = f"{base_url}/admin/realms/{KEYCLOAK_REALM}/clients"
        response = httpx.get(
            clients_url,
            headers=headers,
            params={"clientId": ONYX_CLIENT_NAME},
            timeout=30.0,
        )
        response.raise_for_status()
        clients = response.json()

        if clients:
            # Client exists - get its secret
            client_uuid = clients[0]["id"]
            secret_url = f"{clients_url}/{client_uuid}/client-secret"
            secret_response = httpx.get(secret_url, headers=headers, timeout=30.0)
            secret_response.raise_for_status()
            client_secret = secret_response.json().get("value", "")

            if not client_secret:
                # Generate new secret if not available
                logger.debug(f"Regenerating secret for client {ONYX_CLIENT_NAME}")
                httpx.post(secret_url, headers=headers, timeout=30.0)
                secret_response = httpx.get(secret_url, headers=headers, timeout=30.0)
                secret_response.raise_for_status()
                client_secret = secret_response.json().get("value", "")

            logger.notice(f"Using existing Keycloak client: {ONYX_CLIENT_NAME}")
            return (ONYX_CLIENT_NAME, client_secret)

        # Create new client
        client_config = {
            "clientId": ONYX_CLIENT_NAME,
            "name": "Onyx Chat Application",
            "description": "Auto-provisioned client for Onyx chat application",
            "enabled": True,
            "protocol": "openid-connect",
            "publicClient": False,
            "directAccessGrantsEnabled": True,  # Enable password grant (ROPC)
            "serviceAccountsEnabled": True,
            "standardFlowEnabled": True,  # Enable authorization code flow
            "redirectUris": ["*"],
            "webOrigins": ["*"],
        }
        create_response = httpx.post(
            clients_url, headers=headers, json=client_config, timeout=30.0
        )
        create_response.raise_for_status()

        # Get the created client's UUID from Location header
        location = create_response.headers.get("Location", "")
        client_uuid = location.split("/")[-1]

        if not client_uuid:
            # Fallback: fetch the client we just created
            response = httpx.get(
                clients_url,
                headers=headers,
                params={"clientId": ONYX_CLIENT_NAME},
                timeout=30.0,
            )
            response.raise_for_status()
            clients = response.json()
            if clients:
                client_uuid = clients[0]["id"]
            else:
                raise ValueError("Failed to retrieve created client")

        # Get client secret
        secret_url = f"{clients_url}/{client_uuid}/client-secret"
        secret_response = httpx.get(secret_url, headers=headers, timeout=30.0)
        secret_response.raise_for_status()
        client_secret = secret_response.json().get("value", "")

        logger.notice(f"Created new Keycloak client: {ONYX_CLIENT_NAME}")
        return (ONYX_CLIENT_NAME, client_secret)

    except httpx.ConnectError as e:
        logger.error(
            f"Failed to connect to Keycloak at {base_url}: {e}. "
            "Ensure Keycloak is running and accessible."
        )
        return None
    except httpx.HTTPStatusError as e:
        logger.error(
            f"Keycloak API request failed: {e.response.status_code} - {e.response.text}"
        )
        return None
    except Exception as e:
        logger.error(f"Failed to provision Keycloak client: {e}")
        return None
