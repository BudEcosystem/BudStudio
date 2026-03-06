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

# Built-in skills to seed. These match the .md files shipped in
# backend/onyx/agents/bud_agent/skills/
BUILT_IN_SKILLS = [
    {
        "slug": "weather",
        "name": "Weather Lookup",
        "description": "Get current weather and forecasts for any location using wttr.in.",
        "instructions": (
            "When the user asks about weather, temperature, or forecasts for a location:\n\n"
            "1. Ask for a city/location if not provided.\n"
            '2. Quick summary: `curl -s "wttr.in/{location}?format=3"`\n'
            '3. Detailed forecast: `curl -s "wttr.in/{location}?format=j1"` and summarize '
            "the key fields (temperature, feels like, humidity, wind, description).\n"
            '4. Multi-day forecast: `curl -s "wttr.in/{location}?format=v2"` for a visual '
            "3-day forecast.\n\n"
            "Tips:\n"
            "- URL-encode spaces in location names (e.g. `New+York`).\n"
            "- Use airport codes for precision (e.g. `JFK`, `LAX`).\n"
            "- Do NOT use for: historical weather data, severe weather alerts, or climate analysis."
        ),
        "requires_tools": ["bash"],
        "modes": ["interactive"],
    },
    {
        "slug": "summarize_url",
        "name": "Summarize URL",
        "description": "Fetch and summarize the content of one or more web pages.",
        "instructions": (
            "When the user asks to summarize a URL or web page:\n\n"
            "1. Call `open_url` with the provided URL(s) to fetch full page content.\n"
            "2. Read the returned content carefully.\n"
            "3. Produce a structured summary with:\n"
            "   - **Title** of the page\n"
            "   - **Key points** (3-7 bullet points)\n"
            "   - **Notable quotes** (if any)\n"
            "   - **TL;DR** (1-2 sentence summary)\n\n"
            "If the user provides a topic instead of a URL, use `web_search` first to find "
            "relevant pages, then fetch and summarize the best results.\n\n"
            "Keep summaries concise. Focus on facts and main arguments, not boilerplate or "
            "navigation text."
        ),
        "requires_tools": ["web_search"],
        "modes": [],
    },
    {
        "slug": "code_review",
        "name": "Code Review",
        "description": "Review code files or diffs for bugs, style issues, and best practices.",
        "instructions": (
            "When the user asks you to review code:\n\n"
            "1. If given a file path, use `read_file` to read the file contents.\n"
            "2. If asked to review recent changes, use `bash` with `git diff` or "
            "`git diff --cached` to get the diff.\n"
            "3. If asked to review a PR or branch, use `bash` with "
            "`git log --oneline main..HEAD` and `git diff main...HEAD`.\n\n"
            "Analyze the code for:\n"
            "- **Bugs**: logic errors, off-by-one, null/undefined access, race conditions\n"
            "- **Security**: injection vulnerabilities, hardcoded secrets, unsafe deserialization\n"
            "- **Performance**: unnecessary loops, N+1 queries, missing indexes\n"
            "- **Style**: naming conventions, dead code, overly complex logic\n"
            "- **Types**: missing type annotations, incorrect types, unsafe casts\n\n"
            "Format your review as:\n"
            "- List issues by severity (critical > warning > suggestion)\n"
            "- Reference specific line numbers\n"
            "- Suggest fixes with code snippets where helpful\n"
            "- End with an overall assessment (ship it / needs changes / needs discussion)"
        ),
        "requires_tools": ["read_file", "bash"],
        "modes": ["interactive"],
    },
]


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
