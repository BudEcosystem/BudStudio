"""Add agent_inbox_message table

Revision ID: 559413e9983c
Revises: 76491d90da5b
Create Date: 2026-02-19 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "559413e9983c"
down_revision = "76491d90da5b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_inbox_message",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "sender_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "receiver_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "reply_to_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agent_inbox_message.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="unread",
        ),
        sa.Column("result_summary", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "is_sender_notified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agent_session.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "tokens_used",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "ix_agent_inbox_message_receiver_status",
        "agent_inbox_message",
        ["receiver_user_id", "status"],
    )
    op.create_index(
        "ix_agent_inbox_message_sender_notified",
        "agent_inbox_message",
        ["sender_user_id", "is_sender_notified"],
    )
    op.create_index(
        "ix_agent_inbox_message_reply_to",
        "agent_inbox_message",
        ["reply_to_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_inbox_message_reply_to",
        table_name="agent_inbox_message",
    )
    op.drop_index(
        "ix_agent_inbox_message_sender_notified",
        table_name="agent_inbox_message",
    )
    op.drop_index(
        "ix_agent_inbox_message_receiver_status",
        table_name="agent_inbox_message",
    )
    op.drop_table("agent_inbox_message")
