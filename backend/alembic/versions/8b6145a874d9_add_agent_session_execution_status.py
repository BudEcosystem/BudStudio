"""add agent session execution status fields

Revision ID: 8b6145a874d9
Revises: 5ea281e39ac5
Create Date: 2026-03-22 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "8b6145a874d9"
down_revision = "5ea281e39ac5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session",
        sa.Column(
            "execution_status",
            sa.String(50),
            nullable=False,
            server_default="IDLE",
        ),
    )
    op.add_column(
        "agent_session",
        sa.Column(
            "pending_local_tools",
            postgresql.JSONB(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_session", "pending_local_tools")
    op.drop_column("agent_session", "execution_status")
