"""Tool definitions and classification for BudAgent.

Tools are classified as LOCAL (executed on desktop) or REMOTE (executed on backend).
"""

from typing import Any

# Sentinel gateway ID used to store per-user permissions for local tools
# (bash, write_file, edit_file, etc.) in the shared AgentToolPermission table.
LOCAL_GATEWAY_ID = "__local__"

# Tool classification sets
LOCAL_TOOLS: set[str] = {
    "read_file",
    "write_file",
    "edit_file",
    "bash",
    "glob",
    "grep",
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_fill",
    "browser_type",
    "browser_screenshot",
    "browser_scroll",
    "browser_select",
    "browser_tabs",
    "browser_extract",
}

REMOTE_TOOLS: set[str] = {
    "memory_store",
    "memory_search",
    "workspace_read",
    "workspace_write",
    "workspace_list",
    "web_search",
    "open_url",
    "manage_cron",
    "send_message",
}

APPROVAL_REQUIRED_TOOLS: set[str] = {
    "bash",
    "write_file",
    "edit_file",
    "browser_navigate",
    "browser_click",
    "browser_fill",
    "browser_type",
    "browser_select",
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
    "browser_navigate": {
        "name": "browser_navigate",
        "description": "Navigate to a URL, or go back/forward in browser history.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": (
                        "The URL to navigate to. Use 'back' or 'forward' "
                        "for history navigation."
                    ),
                },
            },
            "required": ["url"],
        },
    },
    "browser_snapshot": {
        "name": "browser_snapshot",
        "description": (
            "Get an accessibility tree snapshot of the current page with "
            "numbered element references (e1, e2...) for use with other "
            "browser tools."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    "browser_click": {
        "name": "browser_click",
        "description": "Click an element identified by its reference from a browser snapshot.",
        "parameters": {
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "Element reference from browser_snapshot (e.g. 'e1', 'e2').",
                },
                "button": {
                    "type": "string",
                    "enum": ["left", "right", "middle"],
                    "description": "Mouse button to click (default: left).",
                },
            },
            "required": ["ref"],
        },
    },
    "browser_fill": {
        "name": "browser_fill",
        "description": "Clear an input field and fill it with the given text.",
        "parameters": {
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "Element reference from browser_snapshot (e.g. 'e1', 'e2').",
                },
                "value": {
                    "type": "string",
                    "description": "The text to fill into the input field.",
                },
            },
            "required": ["ref", "value"],
        },
    },
    "browser_type": {
        "name": "browser_type",
        "description": (
            "Type text using keyboard input. Does not clear existing content. "
            "Supports special keys like Enter, Tab, Escape."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": (
                        "The text to type, or a special key name "
                        "(e.g. 'Enter', 'Tab', 'Escape')."
                    ),
                },
                "ref": {
                    "type": "string",
                    "description": "Optional element reference to focus before typing.",
                },
            },
            "required": ["text"],
        },
    },
    "browser_screenshot": {
        "name": "browser_screenshot",
        "description": (
            "Capture a screenshot of the current page. "
            "Returns a base64-encoded PNG image."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    "browser_scroll": {
        "name": "browser_scroll",
        "description": "Scroll the page or a specific element up or down.",
        "parameters": {
            "type": "object",
            "properties": {
                "direction": {
                    "type": "string",
                    "enum": ["up", "down"],
                    "description": "The direction to scroll.",
                },
                "amount": {
                    "type": "integer",
                    "description": "Number of pixels to scroll (default: 500).",
                },
                "ref": {
                    "type": "string",
                    "description": "Optional element reference to scroll into view.",
                },
            },
            "required": ["direction"],
        },
    },
    "browser_select": {
        "name": "browser_select",
        "description": "Select an option from a dropdown or select element.",
        "parameters": {
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "Element reference from browser_snapshot (e.g. 'e1', 'e2').",
                },
                "value": {
                    "type": "string",
                    "description": "The option value or visible text to select.",
                },
            },
            "required": ["ref", "value"],
        },
    },
    "browser_tabs": {
        "name": "browser_tabs",
        "description": (
            "Manage browser tabs: list all tabs, create a new tab, "
            "or switch to a tab by index."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "create", "switch"],
                    "description": "The tab action to perform.",
                },
                "tab_index": {
                    "type": "integer",
                    "description": (
                        "The tab index to switch to "
                        "(required when action is 'switch')."
                    ),
                },
            },
            "required": ["action"],
        },
    },
    "browser_extract": {
        "name": "browser_extract",
        "description": (
            "Extract the text content of the current page "
            "or a specific element."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": (
                        "Optional element reference to extract text from. "
                        "If omitted, extracts from the entire page."
                    ),
                },
            },
            "required": [],
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
            "like SOUL.md, USER.md, IDENTITY.md, AGENTS.md, and MEMORY.md "
            "that persist across sessions."
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
            "(curated long-term memory)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": (
                        "The workspace file path to write. "
                        "Example: 'SOUL.md', 'USER.md', 'MEMORY.md'."
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
    "web_search": {
        "name": "web_search",
        "description": (
            "Search the public internet for information.\n\n"
            "### Decision boundary\n"
            "- You MUST call this tool when the request involves:\n"
            "    - Fresh/unstable info (news, prices, laws, schedules, "
            "product specs, scores, exchange rates).\n"
            "    - Recommendations, or any query where the specific "
            "sources matter.\n"
            "    - Verifiable claims, quotes, or citations.\n"
            "- After ANY successful `web_search` call that yields candidate "
            "URLs, you MUST call `open_url` on the selected URLs BEFORE "
            "answering. Do NOT answer from snippets.\n\n"
            "### When NOT to use\n"
            "- Casual chat, rewriting/summarizing user-provided text, "
            "or translation.\n"
            "- When the user already provided URLs (go straight to "
            "`open_url`).\n\n"
            "### Usage hints\n"
            "- Expand the user's query into a broader list of queries.\n"
            "- Batch a list of natural-language queries per call.\n"
            "- Prefer searches for distinct intents; then batch-fetch "
            "best URLs.\n"
            "- Deduplicate domains/near-duplicates. Prefer recent, "
            "authoritative sources.\n"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "List of search queries to run in parallel. "
                        "Expand the user's question into a broader list of queries."
                    ),
                },
            },
            "required": ["queries"],
        },
    },
    "open_url": {
        "name": "open_url",
        "description": (
            "Fetch and extract full content from web pages.\n\n"
            "### Decision boundary\n"
            "- You MUST use this tool before quoting, citing, or relying "
            "on page content.\n"
            "- Use it whenever you already have URLs (from the user or "
            "from `web_search`).\n"
            "- Do NOT answer questions based on search snippets alone.\n"
            "- After a web_search call, strong bias towards using this "
            "tool to investigate further.\n\n"
            "### When NOT to use\n"
            "- If you do not yet have URLs (search first).\n\n"
            "### Usage hints\n"
            "- If you've just called web_search, be generous with the "
            "number of URLs you fetch.\n"
            "- Avoid many tiny calls; batch URLs in one request.\n"
            "- Prefer primary, recent, and reputable sources.\n"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "urls": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "List of URLs to fetch content from. "
                        "Be generous with the number of URLs."
                    ),
                },
            },
            "required": ["urls"],
        },
    },
    "manage_cron": {
        "name": "manage_cron",
        "description": (
            "Manage your scheduled cron jobs. You can create, list, update, "
            "and delete recurring tasks that run automatically on a schedule."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["add", "list", "update", "remove"],
                    "description": (
                        "The action to perform: 'add' to create a new cron job, "
                        "'list' to show all cron jobs, 'update' to modify an "
                        "existing job, 'remove' to delete a job."
                    ),
                },
                "name": {
                    "type": "string",
                    "description": "Name for the cron job (required for 'add').",
                },
                "description": {
                    "type": "string",
                    "description": "Optional description of the cron job.",
                },
                "schedule_type": {
                    "type": "string",
                    "enum": ["cron", "interval", "one_shot"],
                    "description": (
                        "Schedule type (required for 'add'): "
                        "'cron' for cron expressions, "
                        "'interval' for recurring intervals, "
                        "'one_shot' for a single future execution."
                    ),
                },
                "cron_expression": {
                    "type": "string",
                    "description": (
                        "Cron expression (required when schedule_type is 'cron'). "
                        "Example: '0 * * * *' for every hour."
                    ),
                },
                "interval_seconds": {
                    "type": "integer",
                    "description": (
                        "Interval in seconds (required when schedule_type is 'interval')."
                    ),
                },
                "one_shot_at": {
                    "type": "string",
                    "description": (
                        "ISO-8601 datetime for one-shot execution "
                        "(required when schedule_type is 'one_shot'). "
                        "Example: '2025-12-31T23:59:00Z'."
                    ),
                },
                "payload_message": {
                    "type": "string",
                    "description": (
                        "The message/instruction the agent will execute on each run "
                        "(required for 'add')."
                    ),
                },
                "job_id": {
                    "type": "string",
                    "description": (
                        "The UUID of the cron job (required for 'update' and 'remove')."
                    ),
                },
                "enabled": {
                    "type": "boolean",
                    "description": "Enable or disable the job (for 'update').",
                },
            },
            "required": ["action"],
        },
    },
    "send_message": {
        "name": "send_message",
        "description": (
            "Send a message or notification to another user via their agent. "
            "This is the ONLY way to contact, notify, or communicate with other users. "
            "Use whenever the user asks to notify, message, ping, alert, or reach out to someone. "
            "The recipient can be specified by email or display name. "
            "The receiving agent will process the message and reply autonomously.\n\n"
            "If you want to continue an existing conversation thread, provide "
            "the conversation_id from your inbox context. If omitted, a new "
            "conversation thread will be created."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "recipient": {
                    "type": "string",
                    "description": (
                        "The email address or display name of the recipient user."
                    ),
                },
                "message": {
                    "type": "string",
                    "description": "The message to send to the recipient's agent.",
                },
                "conversation_id": {
                    "type": "string",
                    "description": (
                        "Optional. The UUID of an existing conversation thread "
                        "to continue. If provided, the message is added to that "
                        "thread instead of creating a new one. Use this when "
                        "following up on an ongoing topic."
                    ),
                },
            },
            "required": ["recipient", "message"],
        },
    },
}


def get_local_tool_schema(tool_name: str) -> dict[str, Any] | None:
    """Get the JSON schema for a local tool."""
    return LOCAL_TOOL_SCHEMAS.get(tool_name)


def get_remote_tool_schema(tool_name: str) -> dict[str, Any] | None:
    """Get the JSON schema for a remote tool."""
    return REMOTE_TOOL_SCHEMAS.get(tool_name)
