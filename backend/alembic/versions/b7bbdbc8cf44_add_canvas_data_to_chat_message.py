"""Add canvas_data to chat_message

Revision ID: b7bbdbc8cf44
Revises: e0f1a2b3c4d5
Create Date: 2026-03-12 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b7bbdbc8cf44"
down_revision = "e0f1a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_message",
        sa.Column("canvas_data", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_message", "canvas_data")
