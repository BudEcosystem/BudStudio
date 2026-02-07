"""Workspace file service for BudAgent — persistent virtual file storage.

Provides service functions and Agents SDK FunctionTool objects for
workspace_read, workspace_write, and workspace_list so the agent can
manage its workspace files (SOUL.md, USER.md, AGENTS.md, etc.)
directly from the backend without a filesystem.
"""

import json
from typing import Any
from typing import Callable
from typing import Coroutine
from uuid import UUID

from sqlalchemy.orm import Session

from onyx.db.agent import (
    delete_workspace_file,
    get_workspace_file,
    list_workspace_files,
    upsert_workspace_file,
)
from onyx.db.models import AgentWorkspaceFile
from onyx.db.models import User
from onyx.utils.logger import setup_logger

logger = setup_logger()


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


def read_workspace_file(
    db_session: Session,
    user_id: UUID,
    path: str,
) -> str | None:
    """Read a workspace file by path. Returns content or None if not found."""
    workspace_file = get_workspace_file(
        db_session=db_session,
        user_id=user_id,
        path=path,
    )
    if workspace_file is None:
        return None
    return workspace_file.content


def write_workspace_file(
    db_session: Session,
    user_id: UUID,
    path: str,
    content: str,
) -> AgentWorkspaceFile:
    """Create or update a workspace file."""
    return upsert_workspace_file(
        db_session=db_session,
        user_id=user_id,
        path=path,
        content=content,
    )


def list_user_workspace_files(
    db_session: Session,
    user_id: UUID,
    prefix: str | None = None,
) -> list[AgentWorkspaceFile]:
    """List workspace files for a user, optionally filtered by prefix."""
    return list_workspace_files(
        db_session=db_session,
        user_id=user_id,
        prefix=prefix,
    )


def _build_initial_user_md(user: User, timezone: str | None = None) -> str:
    """Build an initial USER.md populated with known user data."""
    name = user.personal_name or ""
    email = user.email or ""
    tz = timezone or ""

    lines = [
        "# USER.md - About Your Human",
        "",
        "_Learn about the person you're helping. Update this as you go._",
        "",
        f"- **Name:** {name}",
        f"- **Email:** {email}",
        f"- **Timezone:** {tz}",
        "- **Notes:**",
        "",
        "## Context",
        "",
        "_(What do they care about? What projects are they working on?"
        " Build this over time.)_",
    ]
    return "\n".join(lines)


def ensure_default_workspace_files(
    db_session: Session,
    user: User,
    timezone: str | None = None,
) -> None:
    """Seed default workspace files for a user if they don't exist yet.

    Called once at the start of each agent execution. Only inserts files
    that are missing — existing (possibly user-modified) files are never
    overwritten. USER.md is pre-populated with the user's name, email,
    and timezone.
    """
    from onyx.agents.bud_agent.context_builder import _DEFAULT_TEMPLATES

    existing = get_workspace_file_paths(
        db_session=db_session,
        user_id=user.id,
    )

    for path, content in _DEFAULT_TEMPLATES.items():
        if path not in existing:
            # Pre-populate USER.md with actual user data
            if path == "USER.md":
                content = _build_initial_user_md(user, timezone)

            upsert_workspace_file(
                db_session=db_session,
                user_id=user.id,
                path=path,
                content=content,
            )
            logger.info(f"Seeded default workspace file '{path}' for user {user.id}")


def get_workspace_file_paths(
    db_session: Session,
    user_id: UUID,
) -> set[str]:
    """Return the set of workspace file paths that exist for a user."""
    files = list_workspace_files(
        db_session=db_session,
        user_id=user_id,
    )
    return {f.path for f in files}


def remove_workspace_file(
    db_session: Session,
    user_id: UUID,
    path: str,
) -> bool:
    """Delete a workspace file. Returns True if found and deleted."""
    return delete_workspace_file(
        db_session=db_session,
        user_id=user_id,
        path=path,
    )


# ---------------------------------------------------------------------------
# FunctionTool factories for the Agents SDK
# ---------------------------------------------------------------------------


def create_workspace_tools(
    db_session: Session,
    user_id: UUID,
) -> list[Any]:
    """Create Agents SDK FunctionTool objects for workspace_read/write/list.

    These are *remote* tools — they execute directly on the backend without
    a round-trip to the desktop. The ``db_session`` / ``user_id`` are captured
    in the closures so the agent loop can call them seamlessly.

    Returns a list of ``FunctionTool`` instances.
    """
    from agents import FunctionTool
    from agents import RunContextWrapper

    from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS

    # Type alias for the on_invoke_tool callback
    InvokeHandler = Callable[
        [RunContextWrapper[Any], str],
        Coroutine[Any, Any, str],
    ]

    tools: list[FunctionTool] = []

    # ── workspace_read ────────────────────────────────────────────────────
    read_schema = REMOTE_TOOL_SCHEMAS["workspace_read"]

    async def _handle_workspace_read(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            path = args.get("path", "")
            if not path or not path.strip():
                return "Error: path cannot be empty."

            content = read_workspace_file(
                db_session=db_session,
                user_id=user_id,
                path=path.strip(),
            )
            if content is None:
                return f"File not found: {path}"
            return content
        except Exception as e:
            logger.exception("workspace_read failed")
            return f"Error reading workspace file: {e}"

    tools.append(
        FunctionTool(
            name="workspace_read",
            description=read_schema["description"],
            params_json_schema=read_schema["parameters"],
            on_invoke_tool=_handle_workspace_read,
        )
    )

    # ── workspace_write ───────────────────────────────────────────────────
    write_schema = REMOTE_TOOL_SCHEMAS["workspace_write"]

    async def _handle_workspace_write(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            path = args.get("path", "")
            content = args.get("content", "")
            if not path or not path.strip():
                return "Error: path cannot be empty."

            workspace_file = write_workspace_file(
                db_session=db_session,
                user_id=user_id,
                path=path.strip(),
                content=content,
            )
            return f"File written: {workspace_file.path} ({len(content)} chars)"
        except Exception as e:
            logger.exception("workspace_write failed")
            return f"Error writing workspace file: {e}"

    tools.append(
        FunctionTool(
            name="workspace_write",
            description=write_schema["description"],
            params_json_schema=write_schema["parameters"],
            on_invoke_tool=_handle_workspace_write,
        )
    )

    # ── workspace_list ────────────────────────────────────────────────────
    list_schema = REMOTE_TOOL_SCHEMAS["workspace_list"]

    async def _handle_workspace_list(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            prefix = args.get("prefix")

            files = list_user_workspace_files(
                db_session=db_session,
                user_id=user_id,
                prefix=prefix,
            )

            if not files:
                msg = "No workspace files found"
                if prefix:
                    msg += f" with prefix '{prefix}'"
                return msg + "."

            lines: list[str] = []
            for f in files:
                lines.append(f"- {f.path} ({len(f.content)} chars)")
            return "\n".join(lines)
        except Exception as e:
            logger.exception("workspace_list failed")
            return f"Error listing workspace files: {e}"

    tools.append(
        FunctionTool(
            name="workspace_list",
            description=list_schema["description"],
            params_json_schema=list_schema["parameters"],
            on_invoke_tool=_handle_workspace_list,
        )
    )

    return tools
