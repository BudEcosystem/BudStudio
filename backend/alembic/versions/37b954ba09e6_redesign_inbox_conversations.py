"""Redesign inbox: conversation-based messaging

Revision ID: 37b954ba09e6
Revises: 559413e9983c
Create Date: 2026-02-23 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "37b954ba09e6"
down_revision = "559413e9983c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop old agent_inbox_message table and its indexes
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

    # 2. Create inbox_conversation table
    op.create_table(
        "inbox_conversation",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
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

    # 3. Create inbox_conversation_participant table
    op.create_table(
        "inbox_conversation_participant",
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("inbox_conversation.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "last_read_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_inbox_participant_user_read",
        "inbox_conversation_participant",
        ["user_id", "last_read_at"],
    )

    # 4. Create inbox_message table
    op.create_table(
        "inbox_message",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("inbox_conversation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_type",
            sa.String(50),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "agent_processing_status",
            sa.String(50),
            nullable=True,
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agent_session.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("result_summary", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
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
        "ix_inbox_message_conversation_created",
        "inbox_message",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        "ix_inbox_message_sender_created",
        "inbox_message",
        ["sender_user_id", "created_at"],
    )

    # 5. Add user inbox preference columns
    op.add_column(
        "user",
        sa.Column(
            "inbox_auto_reply_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "inbox_reply_depth_limit",
            sa.Integer(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Remove user columns
    op.drop_column("user", "inbox_reply_depth_limit")
    op.drop_column("user", "inbox_auto_reply_enabled")

    # Drop new tables
    op.drop_index(
        "ix_inbox_message_sender_created",
        table_name="inbox_message",
    )
    op.drop_index(
        "ix_inbox_message_conversation_created",
        table_name="inbox_message",
    )
    op.drop_table("inbox_message")

    op.drop_index(
        "ix_inbox_participant_user_read",
        table_name="inbox_conversation_participant",
    )
    op.drop_table("inbox_conversation_participant")

    op.drop_table("inbox_conversation")

    # Recreate original agent_inbox_message table
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
