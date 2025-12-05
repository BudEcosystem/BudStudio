"""Single-tenant user mapping implementation.

This module provides single-tenant implementations of user-to-tenant mapping
functions that are otherwise provided by the Enterprise Edition.

In single-tenant mode, all users belong to the default PostgreSQL schema.
This mirrors the EE behavior when MULTI_TENANT=false (see EE user_mapping.py lines 21-22).
"""

from onyx.utils.logger import setup_logger
from shared_configs.configs import MULTI_TENANT
from shared_configs.configs import POSTGRES_DEFAULT_SCHEMA

logger = setup_logger()


def get_tenant_id_for_email(email: str) -> str:
    """Get tenant ID for a given email address.

    In single-tenant mode, always returns the default PostgreSQL schema.
    This matches the EE behavior when MULTI_TENANT is False.

    Args:
        email: The user's email address

    Returns:
        The tenant ID (schema name) for the user

    Raises:
        NotImplementedError: If MULTI_TENANT is True (requires EE)
    """
    if MULTI_TENANT:
        raise NotImplementedError(
            "Multi-tenant user mapping requires Enterprise Edition. "
            "Set MULTI_TENANT=false or enable EE."
        )
    return POSTGRES_DEFAULT_SCHEMA
