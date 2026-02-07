"""add agent workspace file

Revision ID: b3c4d5e6f7a8
Revises: 68b5824bae0c
Create Date: 2026-02-07 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "b3c4d5e6f7a8"
down_revision = "68b5824bae0c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_workspace_file",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("path", sa.String(500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
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
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_id", "path", name="uq_agent_workspace_file_user_path"
        ),
    )
    op.create_index(
        "ix_agent_workspace_file_user_id",
        "agent_workspace_file",
        ["user_id"],
    )
    op.create_index(
        "ix_agent_workspace_file_user_path",
        "agent_workspace_file",
        ["user_id", "path"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_workspace_file_user_path", table_name="agent_workspace_file"
    )
    op.drop_index(
        "ix_agent_workspace_file_user_id", table_name="agent_workspace_file"
    )
    op.drop_table("agent_workspace_file")
