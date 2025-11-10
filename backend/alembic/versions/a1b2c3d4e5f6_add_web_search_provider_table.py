"""add web_search_provider table

Revision ID: a1b2c3d4e5f6
Revises: 09995b8811eb
Create Date: 2025-01-13 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "09995b8811eb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_search_provider",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "provider_type",
            sa.String(50),
            nullable=False,
        ),
        sa.Column("api_key", sa.LargeBinary(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_type"),
        sa.UniqueConstraint("is_default"),
    )


def downgrade() -> None:
    op.drop_table("web_search_provider")
