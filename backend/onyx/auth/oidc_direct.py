"""Direct Access Grant authentication for OIDC providers like Keycloak.

This module provides a custom login form flow where users enter credentials
directly in Onyx, which are then exchanged with Keycloak's token endpoint
using the Resource Owner Password Credentials (ROPC) grant type.
"""

from typing import Any

import httpx
from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from fastapi import status
from fastapi.responses import Response
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from onyx.auth.users import auth_backend
from onyx.auth.users import get_user_manager
from onyx.auth.users import UserManager
import onyx.configs.app_configs as app_configs
from onyx.utils.logger import setup_logger

logger = setup_logger()

router = APIRouter()

# Cache for OIDC discovery metadata
_oidc_config_cache: dict[str, Any] | None = None


class DirectLoginRequest(BaseModel):
    username: str
    password: str


class DirectRegisterRequest(BaseModel):
    email: str
    password: str
    first_name: str | None = None
    last_name: str | None = None


async def get_oidc_config() -> dict[str, Any]:
    """Fetch and cache OIDC discovery metadata."""
    global _oidc_config_cache

    if _oidc_config_cache is not None:
        return _oidc_config_cache

    if not app_configs.OPENID_CONFIG_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENID_CONFIG_URL is not configured",
        )

    async with httpx.AsyncClient() as client:
        response = await client.get(app_configs.OPENID_CONFIG_URL, follow_redirects=True)
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to fetch OIDC configuration: {response.status_code}",
            )
        _oidc_config_cache = response.json()
        return _oidc_config_cache


async def get_token_endpoint() -> str:
    """Get the token endpoint from OIDC discovery."""
    config = await get_oidc_config()
    token_endpoint = config.get("token_endpoint")
    if not token_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Token endpoint not found in OIDC configuration",
        )
    return token_endpoint


async def get_userinfo_endpoint() -> str:
    """Get the userinfo endpoint from OIDC discovery."""
    config = await get_oidc_config()
    userinfo_endpoint = config.get("userinfo_endpoint")
    if not userinfo_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Userinfo endpoint not found in OIDC configuration",
        )
    return userinfo_endpoint


def extract_realm_url_from_issuer(issuer: str) -> str:
    """Extract the realm admin URL from the issuer.

    Keycloak issuer format: https://keycloak.example.com/realms/my-realm
    Admin API URL: https://keycloak.example.com/admin/realms/my-realm
    """
    # Replace /realms/ with /admin/realms/ for admin API
    if "/realms/" in issuer:
        return issuer.replace("/realms/", "/admin/realms/")
    raise ValueError(f"Cannot extract realm URL from issuer: {issuer}")


@router.post("/oidc/direct-login")
async def oidc_direct_login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_manager: UserManager = Depends(get_user_manager),
) -> Response:
    """
    Authenticate user via Keycloak Direct Access Grant.

    1. Exchange username/password for tokens at Keycloak's token endpoint
    2. Get user info from the tokens
    3. Create/update user in Onyx via oauth_callback
    4. Return session cookie
    """
    if not app_configs.OAUTH_CLIENT_ID or not app_configs.OAUTH_CLIENT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OAuth client credentials are not configured",
        )

    token_url = await get_token_endpoint()

    # Exchange credentials for tokens using Direct Access Grant (password grant)
    async with httpx.AsyncClient() as client:
        response = await client.post(
            token_url,
            data={
                "grant_type": "password",
                "username": form_data.username,
                "password": form_data.password,
                "client_id": app_configs.OAUTH_CLIENT_ID,
                "client_secret": app_configs.OAUTH_CLIENT_SECRET,
                "scope": "openid email profile",
            },
        )

    if response.status_code != 200:
        error_data = response.json() if response.content else {}
        error_description = error_data.get("error_description", "Invalid credentials")
        logger.warning(
            f"Direct login failed for {form_data.username}: {error_description}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error_description,
        )

    token_data = response.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No access token received from identity provider",
        )

    # Get user info from userinfo endpoint
    userinfo_url = await get_userinfo_endpoint()
    async with httpx.AsyncClient() as client:
        userinfo_response = await client.get(
            userinfo_url,
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if userinfo_response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch user info from identity provider",
        )

    userinfo = userinfo_response.json()
    account_id = userinfo.get("sub")
    account_email = userinfo.get("email")

    if not account_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email not available from identity provider",
        )

    # Extract display name from OIDC claims
    personal_name = (
        userinfo.get("name")
        or " ".join(
            filter(None, [userinfo.get("given_name"), userinfo.get("family_name")])
        )
        or userinfo.get("preferred_username")
        or None
    )

    # Calculate expires_at timestamp
    import time

    expires_at = int(time.time()) + expires_in if expires_in else None

    # Use oauth_callback to create/update user and handle session
    try:
        user = await user_manager.oauth_callback(
            oauth_name="oidc",
            access_token=access_token,
            account_id=account_id,
            account_email=account_email,
            expires_at=expires_at,
            refresh_token=refresh_token,
            request=request,
            associate_by_email=True,
            is_verified_by_default=True,
            personal_name=personal_name,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during OAuth callback: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process authentication",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User account is inactive",
        )

    # Create session using the auth backend
    strategy = auth_backend.get_strategy()
    response = await auth_backend.login(strategy, user)
    await user_manager.on_after_login(user, request, response)

    return response


@router.post("/oidc/direct-register")
async def oidc_direct_register(
    request: Request,
    register_data: DirectRegisterRequest,
    user_manager: UserManager = Depends(get_user_manager),
) -> Response:
    """
    Register new user via Keycloak Admin API.

    1. Get admin token from Keycloak (using service account)
    2. Create user via Admin REST API
    3. Set password for the user
    4. Auto-login the user via direct-login

    Note: Requires the OAuth client to have:
    - Service Accounts Enabled
    - manage-users role from realm-management client
    """
    if not app_configs.OAUTH_CLIENT_ID or not app_configs.OAUTH_CLIENT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OAuth client credentials are not configured",
        )

    # Get OIDC config for issuer (realm URL)
    config = await get_oidc_config()
    issuer = config.get("issuer")
    if not issuer:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Issuer not found in OIDC configuration",
        )

    token_url = await get_token_endpoint()

    # Get admin token using client credentials grant (same OAuth client)
    async with httpx.AsyncClient() as client:
        admin_token_response = await client.post(
            token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": app_configs.OAUTH_CLIENT_ID,
                "client_secret": app_configs.OAUTH_CLIENT_SECRET,
            },
        )

    if admin_token_response.status_code != 200:
        logger.error(f"Failed to get admin token: {admin_token_response.text}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to authenticate with identity provider admin API",
        )

    admin_token = admin_token_response.json().get("access_token")

    # Extract realm admin URL from issuer
    try:
        admin_realm_url = extract_realm_url_from_issuer(issuer)
    except ValueError as e:
        logger.error(f"Failed to extract realm URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Invalid OIDC issuer configuration",
        )

    # Use email prefix as default firstName if not provided
    # Use "User" as fallback lastName if not provided
    email_prefix = register_data.email.split("@")[0]
    first_name = register_data.first_name or email_prefix
    last_name = register_data.last_name or "User"

    # Create user via Keycloak Admin API
    user_payload = {
        "username": register_data.email,
        "email": register_data.email,
        "emailVerified": True,  # Auto-verify since we'll set password
        "enabled": True,
        "firstName": first_name,
        "lastName": last_name,
        "requiredActions": [],  # Clear any default required actions
        "credentials": [
            {
                "type": "password",
                "value": register_data.password,
                "temporary": False,
            }
        ],
    }

    async with httpx.AsyncClient() as client:
        create_user_response = await client.post(
            f"{admin_realm_url}/users",
            json=user_payload,
            headers={"Authorization": f"Bearer {admin_token}"},
        )

    if create_user_response.status_code == 409:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists",
        )

    if create_user_response.status_code not in (201, 204):
        error_msg = "Failed to create user"
        try:
            error_data = create_user_response.json()
            error_msg = error_data.get("errorMessage", error_msg)
        except Exception:
            pass
        logger.error(f"Failed to create user in Keycloak: {create_user_response.text}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_msg,
        )

    # Auto-login the newly created user
    # Create a mock form_data for the login function
    class MockFormData:
        def __init__(self, username: str, password: str):
            self.username = username
            self.password = password
            self.scopes = []
            self.client_id = None
            self.client_secret = None

    form_data = MockFormData(register_data.email, register_data.password)

    # Use the direct login to create session
    return await oidc_direct_login(
        request=request,
        form_data=form_data,  # type: ignore
        user_manager=user_manager,
    )
