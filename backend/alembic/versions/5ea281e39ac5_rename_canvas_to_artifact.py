"""Rename canvas to artifact

Renames chat_message.canvas_data -> artifact_data and updates the
agent_message.ui_spec JSONB key from "canvas" to "artifact".

Revision ID: 5ea281e39ac5
Revises: b7bbdbc8cf44
Create Date: 2026-03-13 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "5ea281e39ac5"
down_revision = "b7bbdbc8cf44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Rename the column on chat_message
    op.alter_column(
        "chat_message",
        "canvas_data",
        new_column_name="artifact_data",
    )

    # 2. Rename the "canvas" key to "artifact" inside agent_message.ui_spec JSONB
    op.execute(
        sa.text(
            """
            UPDATE agent_message
            SET ui_spec = (ui_spec - 'canvas') || jsonb_build_object('artifact', ui_spec->'canvas')
            WHERE ui_spec ? 'canvas'
            """
        )
    )


def downgrade() -> None:
    # 1. Rename the column back
    op.alter_column(
        "chat_message",
        "artifact_data",
        new_column_name="canvas_data",
    )

    # 2. Rename the "artifact" key back to "canvas" inside agent_message.ui_spec JSONB
    op.execute(
        sa.text(
            """
            UPDATE agent_message
            SET ui_spec = (ui_spec - 'artifact') || jsonb_build_object('canvas', ui_spec->'artifact')
            WHERE ui_spec ? 'artifact'
            """
        )
    )
