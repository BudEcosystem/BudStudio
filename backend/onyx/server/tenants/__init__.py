"""Single-tenant implementation of tenant management functions.

This module provides community edition implementations of tenant management
functions that are required by the authentication system. In single-tenant
deployments, all users share the default PostgreSQL schema.

For multi-tenant deployments, the Enterprise Edition provides additional
functionality including:
- Per-tenant schema isolation
- User-to-tenant mapping
- Tenant provisioning and lifecycle management
- Pre-provisioned tenant pools
"""

from onyx.server.tenants.provisioning import get_or_provision_tenant
from onyx.server.tenants.provisioning import (
    get_tenant_id_for_email as get_tenant_id_for_email_provisioning,
)
from onyx.server.tenants.user_mapping import get_tenant_id_for_email

__all__ = [
    "get_or_provision_tenant",
    "get_tenant_id_for_email",
    "get_tenant_id_for_email_provisioning",
]
