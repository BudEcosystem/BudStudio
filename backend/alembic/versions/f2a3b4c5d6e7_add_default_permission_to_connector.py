"""add default_permission to agent_connector_preference

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-02-13 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    op.add_column(
        "agent_connector_preference",
        sa.Column("default_permission", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_connector_preference", "default_permission")
