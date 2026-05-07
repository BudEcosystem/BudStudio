"""add session_type and related columns to agent_session

Revision ID: f2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-03-29

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f2b3c4d5e6f7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns (all nullable)
    op.add_column(
        "agent_session",
        sa.Column("session_type", sa.String(50), nullable=True),
    )
    op.add_column(
        "agent_session",
        sa.Column("task_description", sa.Text(), nullable=True),
    )
    op.add_column(
        "agent_session",
        sa.Column("max_context_tokens", sa.Integer(), nullable=True),
    )
    op.add_column(
        "agent_session",
        sa.Column("max_turns", sa.Integer(), nullable=True),
    )

    # Backfill: sessions with compaction_summary -> COMPACTED, rest -> INTERACTIVE
    # (Cron sessions would need a join to AgentCronExecution which may not exist;
    #  skip that and set them to INTERACTIVE for now.)
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE agent_session
            SET session_type = CASE
                WHEN compaction_summary IS NOT NULL THEN 'COMPACTED'
                ELSE 'INTERACTIVE'
            END
            WHERE session_type IS NULL
            """
        )
    )

    # Create composite index for user + session_type + status queries
    op.create_index(
        "ix_agent_session_user_type_status",
        "agent_session",
        ["user_id", "session_type", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_session_user_type_status",
        table_name="agent_session",
    )
    op.drop_column("agent_session", "max_turns")
    op.drop_column("agent_session", "max_context_tokens")
    op.drop_column("agent_session", "task_description")
    op.drop_column("agent_session", "session_type")
