"""Single-tenant provisioning implementation.

This module provides single-tenant implementations of tenant provisioning
functions that are otherwise provided by the Enterprise Edition.

In single-tenant mode, no actual provisioning occurs as there's only one tenant
(the default PostgreSQL schema). This mirrors the EE behavior when MULTI_TENANT=false
(see EE provisioning.py lines 70-71).
"""

from typing import TYPE_CHECKING

from onyx.utils.logger import setup_logger
from shared_configs.configs import MULTI_TENANT
from shared_configs.configs import POSTGRES_DEFAULT_SCHEMA

if TYPE_CHECKING:
    from fastapi import Request

logger = setup_logger()


async def get_or_provision_tenant(
    email: str,
    referral_source: str | None = None,
    request: "Request | None" = None,
) -> str:
    """Get or provision a tenant for a user.

    In single-tenant mode, always returns the default PostgreSQL schema.
    No actual provisioning occurs as there's only one tenant.

    This matches the EE behavior when MULTI_TENANT is False (lines 70-71).

    Args:
        email: The user's email address
        referral_source: Optional referral source (ignored in single-tenant)
        request: Optional FastAPI request object (ignored in single-tenant)

    Returns:
        The tenant ID (schema name) for the user

    Raises:
        NotImplementedError: If MULTI_TENANT is True (requires EE)
    """
    if MULTI_TENANT:
        raise NotImplementedError(
            "Multi-tenant provisioning requires Enterprise Edition. "
            "Set MULTI_TENANT=false or enable EE."
        )
    return POSTGRES_DEFAULT_SCHEMA


def get_tenant_id_for_email(email: str) -> str:
    """Get tenant ID for a given email address.

    In single-tenant mode, always returns the default PostgreSQL schema.
    This is a sync version used in some auth flows (e.g., password login).

    Args:
        email: The user's email address

    Returns:
        The tenant ID (schema name) for the user

    Raises:
        NotImplementedError: If MULTI_TENANT is True (requires EE)
    """
    if MULTI_TENANT:
        raise NotImplementedError(
            "Multi-tenant provisioning requires Enterprise Edition. "
            "Set MULTI_TENANT=false or enable EE."
        )
    return POSTGRES_DEFAULT_SCHEMA
