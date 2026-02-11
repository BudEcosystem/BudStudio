"""add agent cron tables

Revision ID: d7e8f9a0b1c2
Revises: c4d5e6f7a8b9
Create Date: 2026-02-09 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "d7e8f9a0b1c2"
down_revision = "c4d5e6f7a8b9"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    # Add SUSPENDED to AgentSessionStatus (varchar enum, no DDL needed for non-native)

    op.create_table(
        "agent_cron_job",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        # Schedule
        sa.Column("schedule_type", sa.String(20), nullable=False),
        sa.Column("cron_expression", sa.String(100), nullable=True),
        sa.Column("interval_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "one_shot_at", sa.DateTime(timezone=True), nullable=True
        ),
        # Agent config
        sa.Column("payload_message", sa.Text(), nullable=False),
        sa.Column("workspace_path", sa.Text(), nullable=True),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column(
            "is_heartbeat", sa.Boolean(), nullable=False, server_default="false"
        ),
        # Dedup
        sa.Column("last_response_hash", sa.String(64), nullable=True),
        sa.Column(
            "last_response_at", sa.DateTime(timezone=True), nullable=True
        ),
        # Scheduling
        sa.Column(
            "next_run_at", sa.DateTime(timezone=True), nullable=True, index=True
        ),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_agent_cron_job_user_enabled",
        "agent_cron_job",
        ["user_id", "enabled"],
    )
    op.create_index(
        "ix_agent_cron_job_next_run",
        "agent_cron_job",
        ["next_run_at"],
    )

    op.create_table(
        "agent_cron_execution",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "cron_job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agent_cron_job.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agent_session.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # Status
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        # Result
        sa.Column("result_summary", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("skip_reason", sa.String(50), nullable=True),
        sa.Column(
            "is_notification_read",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        # Suspend state
        sa.Column("suspended_tool_name", sa.String(100), nullable=True),
        sa.Column(
            "suspended_tool_input", postgresql.JSONB(), nullable=True
        ),
        sa.Column("suspended_tool_call_id", sa.String(100), nullable=True),
        sa.Column(
            "suspended_messages", postgresql.JSONB(), nullable=True
        ),
        # Stats
        sa.Column(
            "tokens_used", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "tool_calls_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        # Timestamps
        sa.Column(
            "scheduled_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "completed_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_agent_cron_execution_status",
        "agent_cron_execution",
        ["status"],
    )
    op.create_index(
        "ix_agent_cron_execution_user_notif",
        "agent_cron_execution",
        ["user_id", "is_notification_read"],
    )
    op.create_index(
        "ix_agent_cron_execution_job_created",
        "agent_cron_execution",
        ["cron_job_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("agent_cron_execution")
    op.drop_table("agent_cron_job")
