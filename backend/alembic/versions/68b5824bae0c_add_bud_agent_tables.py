"""add bud agent tables

Revision ID: 68b5824bae0c
Revises: a1b2c3d4e5f6
Create Date: 2026-02-05 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "68b5824bae0c"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create agent_session table
    op.create_table(
        "agent_session",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="active"),
        sa.Column("model_config_id", sa.Integer(), nullable=True),
        sa.Column("workspace_path", sa.Text(), nullable=True),
        sa.Column("total_tokens_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tool_calls", sa.Integer(), nullable=False, server_default="0"),
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
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["model_config_id"],
            ["model_configuration.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_agent_session_user_id", "agent_session", ["user_id"])
    op.create_index("ix_agent_session_status", "agent_session", ["status"])
    op.create_index("ix_agent_session_user_status", "agent_session", ["user_id", "status"])
    op.create_index("ix_agent_session_created_at", "agent_session", ["created_at"])

    # Create agent_message table
    op.create_table(
        "agent_message",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("tool_name", sa.String(100), nullable=True),
        sa.Column("tool_input", postgresql.JSONB(), nullable=True),
        sa.Column("tool_output", postgresql.JSONB(), nullable=True),
        sa.Column("tool_error", sa.Text(), nullable=True),
        sa.Column("tokens_used", sa.Integer(), nullable=True),
        sa.Column("thinking_content", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["agent_session.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_agent_message_session_id", "agent_message", ["session_id"])
    op.create_index(
        "ix_agent_message_session_created", "agent_message", ["session_id", "created_at"]
    )

    # Create agent_memory table
    op.create_table(
        "agent_memory",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("source_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_session_id"],
            ["agent_session.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_agent_memory_user_id", "agent_memory", ["user_id"])
    op.create_index("ix_agent_memory_user_source", "agent_memory", ["user_id", "source"])
    op.create_index("ix_agent_memory_content_hash", "agent_memory", ["content_hash"])


def downgrade() -> None:
    # Drop tables in reverse order due to foreign key constraints
    op.drop_index("ix_agent_memory_content_hash", table_name="agent_memory")
    op.drop_index("ix_agent_memory_user_source", table_name="agent_memory")
    op.drop_index("ix_agent_memory_user_id", table_name="agent_memory")
    op.drop_table("agent_memory")

    op.drop_index("ix_agent_message_session_created", table_name="agent_message")
    op.drop_index("ix_agent_message_session_id", table_name="agent_message")
    op.drop_table("agent_message")

    op.drop_index("ix_agent_session_created_at", table_name="agent_session")
    op.drop_index("ix_agent_session_user_status", table_name="agent_session")
    op.drop_index("ix_agent_session_status", table_name="agent_session")
    op.drop_index("ix_agent_session_user_id", table_name="agent_session")
    op.drop_table("agent_session")
