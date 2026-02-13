"""add agent connector tables

Revision ID: e1f2a3b4c5d6
Revises: e8f9a0b1c2d3
Create Date: 2026-02-12 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "e1f2a3b4c5d6"
down_revision = "e8f9a0b1c2d3"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    op.create_table(
        "agent_connector_preference",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("gateway_id", sa.String(255), nullable=False),
        sa.Column("gateway_name", sa.String(500), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "oauth_completed", sa.Boolean(), nullable=False, server_default="false"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "user_id", "gateway_id", name="uq_agent_connector_pref_user_gateway"
        ),
    )
    op.create_index(
        "ix_agent_connector_preference_user_id",
        "agent_connector_preference",
        ["user_id"],
    )

    op.create_table(
        "agent_tool_permission",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("gateway_id", sa.String(255), nullable=False),
        sa.Column("tool_name", sa.String(500), nullable=False),
        sa.Column(
            "permission_level",
            sa.String(20),
            nullable=False,
            server_default="need_approval",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "user_id",
            "gateway_id",
            "tool_name",
            name="uq_agent_tool_perm_user_gateway_tool",
        ),
    )
    op.create_index(
        "ix_agent_tool_permission_user_id",
        "agent_tool_permission",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_table("agent_tool_permission")
    op.drop_table("agent_connector_preference")
