"""Merge heads: c7bf5721733e and b7c8d9e0f1a2

Revision ID: 76491d90da5b
Revises: c7bf5721733e, b7c8d9e0f1a2
Create Date: 2026-02-17 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "76491d90da5b"
down_revision = ("c7bf5721733e", "b7c8d9e0f1a2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
