"""add agent session compaction fields

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-02-08 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session",
        sa.Column(
            "parent_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agent_session.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "agent_session",
        sa.Column("compaction_summary", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_agent_session_parent_id",
        "agent_session",
        ["parent_session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_session_parent_id", table_name="agent_session")
    op.drop_column("agent_session", "compaction_summary")
    op.drop_column("agent_session", "parent_session_id")
