"""System prompt builder for BudAgent.

Loads the single `system.md` template and substitutes all $variable
placeholders with workspace file contents, memories, time, and runtime
context.
"""

import platform
from datetime import datetime
from datetime import timezone
from uuid import UUID

from sqlalchemy.orm import Session

from onyx.agents.bud_agent.memory_service import format_memories_for_prompt
from onyx.agents.bud_agent.memory_service import search_memories
from onyx.agents.bud_agent.prompts import load_prompt
from onyx.agents.bud_agent.prompts import render_prompt
from onyx.db.agent_inbox import get_unread_messages_for_context
from onyx.utils.logger import setup_logger

logger = setup_logger()

# ---------------------------------------------------------------------------
# Maximum size for injected context files (characters).
# Files exceeding this are truncated with 70% head + 20% tail kept.
# ---------------------------------------------------------------------------
MAX_CONTEXT_CHARS = 20_000
HEAD_RATIO = 0.70
TAIL_RATIO = 0.20

# ---------------------------------------------------------------------------
# Workspace file names that the builder injects into the system prompt.
# ---------------------------------------------------------------------------
WORKSPACE_FILES = [
    "AGENTS.md",
    "SOUL.md",
    "IDENTITY.md",
    "USER.md",
    "MEMORY.md",
]

# ---------------------------------------------------------------------------
# Default templates — used when workspace files are not provided.
# Loaded from .md files in the prompts/ package directory.
# ---------------------------------------------------------------------------
_DEFAULT_TEMPLATES: dict[str, str] = {
    "AGENTS.md": load_prompt("agents"),
    "SOUL.md": load_prompt("soul"),
    "IDENTITY.md": load_prompt("identity"),
    "USER.md": load_prompt("user"),
    "MEMORY.md": "",
}


def _truncate_content(content: str, max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """Truncate content keeping 70% head + 20% tail."""
    if len(content) <= max_chars:
        return content

    head_chars = int(max_chars * HEAD_RATIO)
    tail_chars = int(max_chars * TAIL_RATIO)

    head = content[:head_chars]
    tail = content[-tail_chars:] if tail_chars > 0 else ""

    return (
        f"{head}\n\n"
        f"...(truncated: kept {head_chars}+{tail_chars} chars "
        f"of {len(content)})...\n\n"
        f"{tail}"
    )


class BudAgentContextBuilder:
    """Builds the system prompt for BudAgent from the single system.md template."""

    def __init__(
        self,
        workspace_path: str | None = None,
        context_files: dict[str, str] | None = None,
        user_timezone: str | None = None,
        compaction_summary: str | None = None,
        mode: str | None = None,
    ) -> None:
        self._workspace_path = workspace_path
        self._context_files = context_files or {}
        self._user_timezone = user_timezone
        self._compaction_summary = compaction_summary
        self._mode = mode

    def _get_file(self, filename: str) -> str:
        """Get workspace file content, falling back to default template."""
        content = self._context_files.get(filename, "").strip()
        if content:
            return content
        return _DEFAULT_TEMPLATES.get(filename, "")

    def build(
        self,
        db_session: Session,
        user_id: UUID,
        user_message: str,
        connector_tool_names: list[str] | None = None,
    ) -> str:
        """Build the complete system prompt by rendering system.md."""

        # Per-file truncation budget
        per_file_budget = MAX_CONTEXT_CHARS // len(WORKSPACE_FILES)

        # Gather workspace file contents
        agents_content = _truncate_content(
            self._get_file("AGENTS.md"), per_file_budget
        )
        soul_content = _truncate_content(
            self._get_file("SOUL.md"), per_file_budget
        )
        identity_content = _truncate_content(
            self._get_file("IDENTITY.md"), per_file_budget
        )
        user_content = _truncate_content(
            self._get_file("USER.md"), per_file_budget
        )
        memory_md_content = _truncate_content(
            self._get_file("MEMORY.md"), per_file_budget
        )
        # Time context
        tz = self._user_timezone or "UTC"
        now = datetime.now(timezone.utc)
        date_time = now.strftime("%Y-%m-%d %H:%M:%S UTC")

        # Auto-search memories relevant to the user's message
        memories = ""
        try:
            mem_results = search_memories(
                db_session=db_session,
                user_id=user_id,
                query=user_message,
                limit=5,
            )
            memories = format_memories_for_prompt(mem_results)
        except Exception:
            logger.warning("Failed to search memories for context", exc_info=True)

        # Inbox messages — pending messages from other users' agents
        inbox_messages = ""
        try:
            unread = get_unread_messages_for_context(
                db_session=db_session,
                user_id=user_id,
                limit=5,
            )
            if unread:
                escalation_lines: list[str] = []
                other_lines: list[str] = []
                for msg in unread:
                    sender_name = "Unknown"
                    if msg.sender:
                        sender_name = (
                            msg.sender.personal_name
                            or msg.sender.email
                            or "Unknown"
                        )
                    sender_type = (
                        msg.sender_type.value
                        if hasattr(msg.sender_type, "value")
                        else str(msg.sender_type)
                    )
                    line = (
                        f"- From {sender_name} ({sender_type}) in "
                        f"conversation {msg.conversation_id}: "
                        f'"{msg.content}"'
                    )
                    if (
                        msg.content
                        and msg.content.startswith("I need my user's help:")
                    ):
                        escalation_lines.append(line)
                    else:
                        other_lines.append(line)

                parts: list[str] = []
                if escalation_lines:
                    parts.append(
                        "URGENT — Your agent escalated the following and "
                        "is waiting for your input:\n"
                        + "\n".join(escalation_lines)
                        + "\nReply using send_message with the "
                        "conversation_id, or ask your user what to do."
                    )
                if other_lines:
                    label = (
                        "Other unread messages:"
                        if escalation_lines
                        else "You have unread messages from other users' "
                        "agents. Consider responding using send_message."
                    )
                    parts.append(label + "\n" + "\n".join(other_lines))
                inbox_messages = "\n\n".join(parts)
        except Exception:
            logger.warning(
                "Failed to fetch inbox messages for context", exc_info=True
            )

        # Workspace info (optional — only when a local path is configured)
        workspace_info = ""
        if self._workspace_path:
            os_info = f"{platform.system()} {platform.release()}"
            workspace_info = (
                "## Workspace\n\n"
                f"- Path: {self._workspace_path}\n"
                f"- Platform: {os_info}\n"
                "Treat this directory as the workspace for file operations "
                "unless explicitly instructed otherwise."
            )

        # Build compaction summary section if present
        compaction_summary_section = ""
        if self._compaction_summary:
            compaction_summary_section = (
                "## Previous Conversation Summary\n\n"
                "The following is a summary of an earlier conversation that was "
                "compacted to save context space. Use it as background context.\n\n"
                f"{self._compaction_summary}"
            )

        # Build connector tools section for the system prompt
        connector_tools_section = ""
        if connector_tool_names:
            lines = [
                "\n### Connector Tools (via MCP gateway)",
                "These tools interact with external services. "
                "Use them when the user asks about connected services.",
            ]
            for name in connector_tool_names:
                lines.append(f"- {name}")
            connector_tools_section = "\n".join(lines)

        # Mode-specific instructions
        mode_instructions = ""
        if self._mode:
            _MODE_TEMPLATE_MAP = {
                "interactive": "mode_interactive",
                "cron": "mode_cron",
                "inbox": "mode_inbox",
            }
            template_name = _MODE_TEMPLATE_MAP.get(self._mode)
            if template_name:
                mode_instructions = load_prompt(template_name)

        # Render the single system.md template
        return render_prompt(
            "system",
            timezone=tz,
            date_time=date_time,
            agents_content=agents_content or "(not set)",
            soul_content=soul_content or "(not set)",
            identity_content=identity_content or "(not set)",
            user_content=user_content or "(not set)",
            memory_md_content=memory_md_content or "(not set)",
            memories=memories or "No relevant memories found.",
            inbox_messages=inbox_messages or "No pending inbox messages.",
            workspace_info=workspace_info,
            compaction_summary=compaction_summary_section,
            connector_tools_section=connector_tools_section,
            mode_instructions=mode_instructions or "No mode specified.",
        )
