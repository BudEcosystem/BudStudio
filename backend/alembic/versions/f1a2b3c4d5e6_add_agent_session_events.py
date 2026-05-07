"""add agent_session_event table

Revision ID: f1a2b3c4d5e6
Revises: 8b6145a874d9
Create Date: 2026-03-29

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "8b6145a874d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_session_event",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("agent_session.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ttl_seconds", sa.Integer(), nullable=True),
    )

    op.create_index(
        "ix_agent_session_event_session_status_priority",
        "agent_session_event",
        ["session_id", "status", "priority"],
    )
    op.create_index(
        "ix_agent_session_event_status_created",
        "agent_session_event",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_session_event_status_created",
        table_name="agent_session_event",
    )
    op.drop_index(
        "ix_agent_session_event_session_status_priority",
        table_name="agent_session_event",
    )
    op.drop_table("agent_session_event")
