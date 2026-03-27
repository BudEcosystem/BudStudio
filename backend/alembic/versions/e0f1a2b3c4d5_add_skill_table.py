"""add skill table

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e0f1a2b3c4d5"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None

# Built-in skills removed — the skill table is created empty.
# Skills should be managed via the admin UI or API, not seeded in migrations.
BUILT_IN_SKILLS: list[dict[str, object]] = []


def upgrade() -> None:
    op.create_table(
        "skill",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(), unique=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column(
            "requires_tools",
            postgresql.ARRAY(sa.String()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "modes",
            postgresql.ARRAY(sa.String()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=True,
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

    # Seed built-in skills
    conn = op.get_bind()
    for skill in BUILT_IN_SKILLS:
        conn.execute(
            sa.text(
                """
                INSERT INTO skill (slug, name, description, instructions,
                                   requires_tools, modes, builtin, enabled)
                VALUES (:slug, :name, :description, :instructions,
                        :requires_tools, :modes, TRUE, TRUE)
                ON CONFLICT (slug) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    instructions = EXCLUDED.instructions,
                    requires_tools = EXCLUDED.requires_tools,
                    modes = EXCLUDED.modes,
                    builtin = TRUE
                """
            ),
            {
                "slug": skill["slug"],
                "name": skill["name"],
                "description": skill["description"],
                "instructions": skill["instructions"],
                "requires_tools": skill["requires_tools"],
                "modes": skill["modes"],
            },
        )


def downgrade() -> None:
    op.drop_table("skill")
