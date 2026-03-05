"""add goal to inbox_conversation

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-03-04

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d9e0f1a2b3c4"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add goal column as nullable first so existing rows don't break
    op.add_column(
        "inbox_conversation",
        sa.Column("goal", sa.Text(), nullable=True),
    )
    op.add_column(
        "inbox_conversation",
        sa.Column(
            "goal_status",
            sa.String(),
            nullable=False,
            server_default="active",
        ),
    )

    # Backfill existing rows with a default goal
    op.execute(
        "UPDATE inbox_conversation SET goal = 'General conversation' WHERE goal IS NULL"
    )

    # Now make goal NOT NULL
    op.alter_column("inbox_conversation", "goal", nullable=False)


def downgrade() -> None:
    op.drop_column("inbox_conversation", "goal_status")
    op.drop_column("inbox_conversation", "goal")
