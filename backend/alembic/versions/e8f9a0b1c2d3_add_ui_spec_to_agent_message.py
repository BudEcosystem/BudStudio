"""add ui_spec to agent_message

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-02-11 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "e8f9a0b1c2d3"
down_revision = "d7e8f9a0b1c2"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    op.add_column(
        "agent_message",
        sa.Column("ui_spec", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_message", "ui_spec")
