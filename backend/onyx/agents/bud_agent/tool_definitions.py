"""Tool definitions and classification for BudAgent.

Tools are classified as LOCAL (executed on desktop) or REMOTE (executed on backend).
"""

from typing import Any

# Tool classification sets
LOCAL_TOOLS: set[str] = {
    "read_file",
    "write_file",
    "edit_file",
    "bash",
    "glob",
    "grep",
}

REMOTE_TOOLS: set[str] = {
    "memory_store",
    "memory_search",
    "workspace_read",
    "workspace_write",
    "workspace_list",
}

APPROVAL_REQUIRED_TOOLS: set[str] = {
    "bash",
    "write_file",
    "edit_file",
}


def is_local_tool(tool_name: str) -> bool:
    """Check if a tool should be executed on the desktop."""
    return tool_name in LOCAL_TOOLS


def is_connector_tool(tool_name: str) -> bool:
    """Check if a tool is a BudApp connector tool.

    Connector tools are not in the LOCAL_TOOLS or REMOTE_TOOLS sets — they
    are dynamically discovered from BudApp MCP and executed on the backend.
    """
    return not is_local_tool(tool_name) and tool_name not in REMOTE_TOOLS


def is_remote_tool(tool_name: str) -> bool:
    """Check if a tool should be executed on the backend.

    This includes both statically-defined remote tools and dynamic connector tools.
    """
    return tool_name in REMOTE_TOOLS or is_connector_tool(tool_name)


def requires_approval(tool_name: str) -> bool:
    """Check if a tool requires user approval before execution."""
    return tool_name in APPROVAL_REQUIRED_TOOLS


# JSON schemas for local tools (mirroring frontend tool definitions)
LOCAL_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "read_file": {
        "name": "read_file",
        "description": "Read the contents of a file. Returns the file content with line numbers.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The path to the file to read, relative to workspace.",
                },
                "start_line": {
                    "type": "integer",
                    "description": "Optional starting line number (1-based).",
                },
                "end_line": {
                    "type": "integer",
                    "description": "Optional ending line number (1-based, inclusive).",
                },
            },
            "required": ["path"],
        },
    },
    "write_file": {
        "name": "write_file",
        "description": "Write content to a file. Creates the file if it does not exist, overwrites if it does.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The path to the file to write, relative to workspace.",
                },
                "content": {
                    "type": "string",
                    "description": "The content to write to the file.",
                },
            },
            "required": ["path", "content"],
        },
    },
    "edit_file": {
        "name": "edit_file",
        "description": "Edit a file by replacing an exact string match with new text.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The path to the file to edit, relative to workspace.",
                },
                "old_text": {
                    "type": "string",
                    "description": "The exact text to find and replace.",
                },
                "new_text": {
                    "type": "string",
                    "description": "The text to replace it with.",
                },
            },
            "required": ["path", "old_text", "new_text"],
        },
    },
    "bash": {
        "name": "bash",
        "description": "Execute a shell command in the workspace directory. Use for running scripts, git operations, and other terminal tasks.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute.",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Optional timeout in seconds (default: 120, max: 300).",
                },
            },
            "required": ["command"],
        },
    },
    "glob": {
        "name": "glob",
        "description": "Find files matching a glob pattern in the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "The glob pattern to match (e.g. '**/*.py', 'src/**/*.ts').",
                },
                "directory": {
                    "type": "string",
                    "description": "Optional subdirectory to search in, relative to workspace.",
                },
            },
            "required": ["pattern"],
        },
    },
    "grep": {
        "name": "grep",
        "description": "Search for a regex pattern in files within the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "The regex pattern to search for.",
                },
                "path": {
                    "type": "string",
                    "description": "Optional path to search in, relative to workspace.",
                },
                "include": {
                    "type": "string",
                    "description": "Optional glob pattern to filter files (e.g. '*.py').",
                },
            },
            "required": ["pattern"],
        },
    },
}

# JSON schemas for remote tools (executed on the backend)
REMOTE_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "memory_store": {
        "name": "memory_store",
        "description": (
            "Store a memory for future recall across sessions. Use this to save "
            "important facts about the user, their project, preferences, decisions, "
            "lessons learned, and codebase patterns. Only store genuinely useful "
            "information — avoid trivial or ephemeral details."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": (
                        "The memory content to store. Should be a clear, self-contained "
                        "statement. Example: 'User prefers tabs over spaces in Python files.'"
                    ),
                },
            },
            "required": ["content"],
        },
    },
    "memory_search": {
        "name": "memory_search",
        "description": (
            "Search your persistent memory for relevant context from previous sessions. "
            "Use this before answering questions about prior work, decisions, user "
            "preferences, project details, or anything that may have been discussed before."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "The search query. Be specific about what you're looking for. "
                        "Example: 'user database preferences' or 'deployment workflow'."
                    ),
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 5, max: 20).",
                },
            },
            "required": ["query"],
        },
    },
    "workspace_read": {
        "name": "workspace_read",
        "description": (
            "Read a workspace file by path. Workspace files are persistent documents "
            "like SOUL.md, USER.md, IDENTITY.md, AGENTS.md, MEMORY.md, "
            "and HEARTBEAT.md that persist across sessions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": (
                        "The workspace file path to read. "
                        "Example: 'SOUL.md', 'USER.md', 'AGENTS.md'."
                    ),
                },
            },
            "required": ["path"],
        },
    },
    "workspace_write": {
        "name": "workspace_write",
        "description": (
            "Create or update a workspace file. Use this to persist documents like "
            "SOUL.md (your personality), USER.md (user preferences), IDENTITY.md "
            "(your name/identity), AGENTS.md (workspace rules), MEMORY.md "
            "(curated long-term memory), or HEARTBEAT.md."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": (
                        "The workspace file path to write. "
                        "Example: 'SOUL.md', 'USER.md', 'HEARTBEAT.md'."
                    ),
                },
                "content": {
                    "type": "string",
                    "description": "The content to write to the file.",
                },
            },
            "required": ["path", "content"],
        },
    },
    "workspace_list": {
        "name": "workspace_list",
        "description": (
            "List workspace files, optionally filtered by a path prefix. "
            "Use this to discover available workspace files."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prefix": {
                    "type": "string",
                    "description": (
                        "Optional path prefix to filter by."
                    ),
                },
            },
            "required": [],
        },
    },
}


def get_local_tool_schema(tool_name: str) -> dict[str, Any] | None:
    """Get the JSON schema for a local tool."""
    return LOCAL_TOOL_SCHEMAS.get(tool_name)


def get_remote_tool_schema(tool_name: str) -> dict[str, Any] | None:
    """Get the JSON schema for a remote tool."""
    return REMOTE_TOOL_SCHEMAS.get(tool_name)
