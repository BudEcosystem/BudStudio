"""Drop is_heartbeat from agent_cron_job

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2, 37b954ba09e6
Create Date: 2026-03-04 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "c8d9e0f1a2b3"
down_revision = ("b7c8d9e0f1a2", "37b954ba09e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("agent_cron_job", "is_heartbeat")


def downgrade() -> None:
    import sqlalchemy as sa

    op.add_column(
        "agent_cron_job",
        sa.Column("is_heartbeat", sa.Boolean(), nullable=False, server_default="false"),
    )
