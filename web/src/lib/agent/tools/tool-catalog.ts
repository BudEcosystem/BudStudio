export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ToolCatalogEntry {
  name: string;
  description: string;
  category: "local" | "remote";
  requiresApproval: boolean;
  parameters: ToolParameter[];
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  // Local tools (executed on device)
  {
    name: "read_file",
    description:
      "Read the contents of a file. Returns the file content with line numbers.",
    category: "local",
    requiresApproval: false,
    parameters: [
      {
        name: "path",
        type: "string",
        description: "The path to the file to read, relative to workspace.",
        required: true,
      },
      {
        name: "start_line",
        type: "integer",
        description: "Optional starting line number (1-based).",
        required: false,
      },
      {
        name: "end_line",
        type: "integer",
        description: "Optional ending line number (1-based, inclusive).",
        required: false,
      },
    ],
  },
  {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it does not exist, overwrites if it does.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "path",
        type: "string",
        description: "The path to the file to write, relative to workspace.",
        required: true,
      },
      {
        name: "content",
        type: "string",
        description: "The content to write to the file.",
        required: true,
      },
    ],
  },
  {
    name: "edit_file",
    description:
      "Edit a file by replacing an exact string match with new text.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "path",
        type: "string",
        description: "The path to the file to edit, relative to workspace.",
        required: true,
      },
      {
        name: "old_text",
        type: "string",
        description: "The exact text to find and replace.",
        required: true,
      },
      {
        name: "new_text",
        type: "string",
        description: "The text to replace it with.",
        required: true,
      },
    ],
  },
  {
    name: "bash",
    description:
      "Execute a shell command in the workspace directory. Use for running scripts, git operations, and other terminal tasks.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "command",
        type: "string",
        description: "The shell command to execute.",
        required: true,
      },
      {
        name: "timeout",
        type: "integer",
        description: "Optional timeout in seconds (default: 120, max: 300).",
        required: false,
      },
    ],
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern in the workspace.",
    category: "local",
    requiresApproval: false,
    parameters: [
      {
        name: "pattern",
        type: "string",
        description:
          "The glob pattern to match (e.g. '**/*.py', 'src/**/*.ts').",
        required: true,
      },
      {
        name: "directory",
        type: "string",
        description:
          "Optional subdirectory to search in, relative to workspace.",
        required: false,
      },
    ],
  },
  {
    name: "grep",
    description:
      "Search for a regex pattern in files within the workspace.",
    category: "local",
    requiresApproval: false,
    parameters: [
      {
        name: "pattern",
        type: "string",
        description: "The regex pattern to search for.",
        required: true,
      },
      {
        name: "path",
        type: "string",
        description: "Optional path to search in, relative to workspace.",
        required: false,
      },
      {
        name: "include",
        type: "string",
        description:
          "Optional glob pattern to filter files (e.g. '*.py').",
        required: false,
      },
    ],
  },
  // Remote tools (executed on server)
  {
    name: "memory_store",
    description:
      "Store a memory for future recall across sessions. Use this to save important facts about the user, their project, preferences, decisions, lessons learned, and codebase patterns.",
    category: "remote",
    requiresApproval: false,
    parameters: [
      {
        name: "content",
        type: "string",
        description:
          "The memory content to store. Should be a clear, self-contained statement.",
        required: true,
      },
    ],
  },
  {
    name: "memory_search",
    description:
      "Search your persistent memory for relevant context from previous sessions. Use this before answering questions about prior work, decisions, user preferences, or project details.",
    category: "remote",
    requiresApproval: false,
    parameters: [
      {
        name: "query",
        type: "string",
        description:
          "The search query. Be specific about what you're looking for.",
        required: true,
      },
      {
        name: "limit",
        type: "integer",
        description:
          "Maximum number of results to return (default: 5, max: 20).",
        required: false,
      },
    ],
  },
  {
    name: "workspace_read",
    description:
      "Read a workspace file by path. Workspace files are persistent documents like SOUL.md, USER.md, IDENTITY.md, AGENTS.md, MEMORY.md, and HEARTBEAT.md.",
    category: "remote",
    requiresApproval: false,
    parameters: [
      {
        name: "path",
        type: "string",
        description:
          "The workspace file path to read. Example: 'SOUL.md', 'USER.md'.",
        required: true,
      },
    ],
  },
  {
    name: "workspace_write",
    description:
      "Create or update a workspace file. Use this to persist documents like SOUL.md, USER.md, IDENTITY.md, AGENTS.md, MEMORY.md, or HEARTBEAT.md.",
    category: "remote",
    requiresApproval: false,
    parameters: [
      {
        name: "path",
        type: "string",
        description:
          "The workspace file path to write. Example: 'SOUL.md', 'USER.md'.",
        required: true,
      },
      {
        name: "content",
        type: "string",
        description: "The content to write to the file.",
        required: true,
      },
    ],
  },
  {
    name: "workspace_list",
    description:
      "List workspace files, optionally filtered by a path prefix. Use this to discover available workspace files.",
    category: "remote",
    requiresApproval: false,
    parameters: [
      {
        name: "prefix",
        type: "string",
        description: "Optional path prefix to filter by.",
        required: false,
      },
    ],
  },
];
