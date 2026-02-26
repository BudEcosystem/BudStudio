"""DB operations for agent connector preferences and tool permissions."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from onyx.db.enums import AgentToolPermissionLevel
from onyx.db.models import AgentConnectorPreference
from onyx.db.models import AgentToolPermission


def upsert_connector_preference(
    db_session: Session,
    user_id: UUID,
    gateway_id: str,
    enabled: bool,
    gateway_name: str = "",
    oauth_completed: bool | None = None,
    default_permission: AgentToolPermissionLevel | None = None,
    set_default_permission: bool = False,
) -> AgentConnectorPreference:
    """Create or update a connector preference for a user.

    ``set_default_permission`` controls whether ``default_permission`` is
    written.  When *False* (the default) the column is left untouched so
    callers that only toggle ``enabled`` don't accidentally clear the
    connector-level default.
    """
    values: dict[str, object] = {
        "user_id": user_id,
        "gateway_id": gateway_id,
        "gateway_name": gateway_name,
        "enabled": enabled,
    }
    if oauth_completed is not None:
        values["oauth_completed"] = oauth_completed
    if set_default_permission:
        values["default_permission"] = (
            default_permission.value if default_permission else None
        )

    set_on_conflict: dict[str, object] = {"enabled": enabled}
    if gateway_name:
        set_on_conflict["gateway_name"] = gateway_name
    if oauth_completed is not None:
        set_on_conflict["oauth_completed"] = oauth_completed
    if set_default_permission:
        set_on_conflict["default_permission"] = (
            default_permission.value if default_permission else None
        )

    stmt = (
        pg_insert(AgentConnectorPreference)
        .values(**values)
        .on_conflict_do_update(
            constraint="uq_agent_connector_pref_user_gateway",
            set_=set_on_conflict,
        )
        .returning(AgentConnectorPreference)
    )
    result = db_session.execute(stmt)
    db_session.commit()
    return result.scalar_one()


def get_connector_preferences(
    db_session: Session,
    user_id: UUID,
) -> list[AgentConnectorPreference]:
    """Get all connector preferences for a user."""
    stmt = (
        select(AgentConnectorPreference)
        .where(AgentConnectorPreference.user_id == user_id)
        .order_by(AgentConnectorPreference.created_at)
    )
    return list(db_session.execute(stmt).scalars().all())


def get_enabled_connector_ids(
    db_session: Session,
    user_id: UUID,
) -> list[str]:
    """Get gateway IDs of all enabled connectors for a user."""
    stmt = (
        select(AgentConnectorPreference.gateway_id)
        .where(
            AgentConnectorPreference.user_id == user_id,
            AgentConnectorPreference.enabled.is_(True),
        )
    )
    return list(db_session.execute(stmt).scalars().all())


def get_enabled_connector_slug_map(
    db_session: Session,
    user_id: UUID,
) -> dict[str, str]:
    """Get a mapping of connector slug -> gateway_id for enabled connectors.

    The slug is extracted from ``gateway_name`` (e.g. ``prompt_xxx__v1__github``
    yields ``github``).  This is used to match MCP tool name prefixes to gateway
    UUIDs at runtime.
    """
    stmt = (
        select(
            AgentConnectorPreference.gateway_id,
            AgentConnectorPreference.gateway_name,
        )
        .where(
            AgentConnectorPreference.user_id == user_id,
            AgentConnectorPreference.enabled.is_(True),
        )
    )
    rows = db_session.execute(stmt).all()
    slug_map: dict[str, str] = {}
    for gateway_id, gateway_name in rows:
        if not gateway_name:
            continue
        # Extract slug: "prompt_xxx__v1__github" -> "github"
        parts = gateway_name.split("__v1__")
        slug = parts[-1] if len(parts) > 1 else gateway_name
        # Normalize to lowercase to match MCP tool name prefixes
        slug_map[slug.lower()] = gateway_id
    return slug_map


def upsert_tool_permission(
    db_session: Session,
    user_id: UUID,
    gateway_id: str,
    tool_name: str,
    permission_level: AgentToolPermissionLevel,
) -> AgentToolPermission:
    """Create or update a tool permission for a user."""
    stmt = (
        pg_insert(AgentToolPermission)
        .values(
            user_id=user_id,
            gateway_id=gateway_id,
            tool_name=tool_name,
            permission_level=permission_level,
        )
        .on_conflict_do_update(
            constraint="uq_agent_tool_perm_user_gateway_tool",
            set_={"permission_level": permission_level},
        )
        .returning(AgentToolPermission)
    )
    result = db_session.execute(stmt)
    db_session.commit()
    return result.scalar_one()


def get_tool_permissions(
    db_session: Session,
    user_id: UUID,
    gateway_id: str,
) -> list[AgentToolPermission]:
    """Get all tool permissions for a user and gateway."""
    stmt = (
        select(AgentToolPermission)
        .where(
            AgentToolPermission.user_id == user_id,
            AgentToolPermission.gateway_id == gateway_id,
        )
        .order_by(AgentToolPermission.tool_name)
    )
    return list(db_session.execute(stmt).scalars().all())


def get_all_tool_permissions(
    db_session: Session,
    user_id: UUID,
) -> dict[str, AgentToolPermissionLevel]:
    """Get all tool permissions for a user, keyed by '{gateway_id}:{tool_name}'."""
    stmt = select(AgentToolPermission).where(
        AgentToolPermission.user_id == user_id,
    )
    rows = db_session.execute(stmt).scalars().all()
    return {
        f"{row.gateway_id}:{row.tool_name}": row.permission_level for row in rows
    }


def mark_connector_oauth_completed(
    db_session: Session,
    user_id: UUID,
    gateway_id: str,
) -> None:
    """Mark a connector as having completed OAuth."""
    stmt = (
        select(AgentConnectorPreference)
        .where(
            AgentConnectorPreference.user_id == user_id,
            AgentConnectorPreference.gateway_id == gateway_id,
        )
    )
    pref = db_session.execute(stmt).scalar_one_or_none()
    if pref:
        pref.oauth_completed = True
        db_session.commit()


def clear_connector_oauth(
    db_session: Session,
    user_id: UUID,
    gateway_id: str,
) -> None:
    """Clear OAuth status for a connector and disable it.

    When a user disconnects OAuth the gateway ID is no longer valid for
    tool discovery.  Setting ``enabled = False`` prevents stale rows
    from polluting the slug map and causing 500 errors when the user
    reconnects with a different gateway ID.
    """
    stmt = (
        select(AgentConnectorPreference)
        .where(
            AgentConnectorPreference.user_id == user_id,
            AgentConnectorPreference.gateway_id == gateway_id,
        )
    )
    pref = db_session.execute(stmt).scalar_one_or_none()
    if pref:
        pref.oauth_completed = False
        pref.enabled = False
        db_session.commit()


def get_connector_default_permissions(
    db_session: Session,
    user_id: UUID,
) -> dict[str, AgentToolPermissionLevel]:
    """Return ``{gateway_id: permission_level}`` for connectors with a non-null default."""
    stmt = select(
        AgentConnectorPreference.gateway_id,
        AgentConnectorPreference.default_permission,
    ).where(
        AgentConnectorPreference.user_id == user_id,
        AgentConnectorPreference.default_permission.isnot(None),
    )
    rows = db_session.execute(stmt).all()
    return {gw_id: perm for gw_id, perm in rows}
