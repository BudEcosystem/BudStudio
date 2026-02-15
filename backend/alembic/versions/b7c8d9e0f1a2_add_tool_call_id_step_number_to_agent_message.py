"""add tool_call_id and step_number to agent_message

Revision ID: b7c8d9e0f1a2
Revises: f2a3b4c5d6e7
Create Date: 2026-02-14 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_message",
        sa.Column("tool_call_id", sa.String(100), nullable=True),
    )
    op.add_column(
        "agent_message",
        sa.Column("step_number", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_message", "step_number")
    op.drop_column("agent_message", "tool_call_id")
