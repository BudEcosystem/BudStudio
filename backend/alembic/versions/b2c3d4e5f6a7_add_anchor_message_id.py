"""add anchor_message_id to agent_session for thread support

Revision ID: b2c3d4e5f6a7
Revises: f2b3c4d5e6f7
Create Date: 2026-04-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "f2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session",
        sa.Column(
            "anchor_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agent_message.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_agent_session_anchor_message_id",
        "agent_session",
        ["anchor_message_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_session_anchor_message_id",
        table_name="agent_session",
    )
    op.drop_column("agent_session", "anchor_message_id")
