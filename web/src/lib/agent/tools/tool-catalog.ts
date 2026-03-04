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
  // Browser automation tools (executed on device)
  {
    name: "browser_navigate",
    description:
      "Navigate to a URL, or go back/forward in browser history.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "url",
        type: "string",
        description:
          "The URL to navigate to. Use 'back' or 'forward' for history navigation.",
        required: true,
      },
    ],
  },
  {
    name: "browser_snapshot",
    description:
      "Get an accessibility tree snapshot of the current page with numbered element references (e1, e2...) for use with other browser tools.",
    category: "local",
    requiresApproval: false,
    parameters: [],
  },
  {
    name: "browser_click",
    description:
      "Click an element identified by its reference from a browser snapshot.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "ref",
        type: "string",
        description:
          "Element reference from browser_snapshot (e.g. 'e1', 'e2').",
        required: true,
      },
      {
        name: "button",
        type: "string",
        description: "Mouse button to click (default: left).",
        required: false,
      },
    ],
  },
  {
    name: "browser_fill",
    description:
      "Clear an input field and fill it with the given text.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "ref",
        type: "string",
        description:
          "Element reference from browser_snapshot (e.g. 'e1', 'e2').",
        required: true,
      },
      {
        name: "value",
        type: "string",
        description: "The text to fill into the input field.",
        required: true,
      },
    ],
  },
  {
    name: "browser_type",
    description:
      "Type text using keyboard input. Does not clear existing content. Supports special keys like Enter, Tab, Escape.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "text",
        type: "string",
        description:
          "The text to type, or a special key name (e.g. 'Enter', 'Tab', 'Escape').",
        required: true,
      },
      {
        name: "ref",
        type: "string",
        description: "Optional element reference to focus before typing.",
        required: false,
      },
    ],
  },
  {
    name: "browser_screenshot",
    description:
      "Capture a screenshot of the current page. Returns a base64-encoded PNG image.",
    category: "local",
    requiresApproval: false,
    parameters: [],
  },
  {
    name: "browser_scroll",
    description:
      "Scroll the page or a specific element up or down.",
    category: "local",
    requiresApproval: false,
    parameters: [
      {
        name: "direction",
        type: "string",
        description: "The direction to scroll.",
        required: true,
      },
      {
        name: "amount",
        type: "number",
        description: "Number of pixels to scroll (default: 500).",
        required: false,
      },
      {
        name: "ref",
        type: "string",
        description: "Optional element reference to scroll into view.",
        required: false,
      },
    ],
  },
  {
    name: "browser_select",
    description:
      "Select an option from a dropdown or select element.",
    category: "local",
    requiresApproval: true,
    parameters: [
      {
        name: "ref",
        type: "string",
        description:
          "Element reference from browser_snapshot (e.g. 'e1', 'e2').",
        required: true,
      },
      {
        name: "value",
        type: "string",
        description: "The option value or visible text to select.",
        required: true,
      },
    ],
  },
  {
    name: "browser_tabs",
    description:
      "Manage browser tabs: list all tabs, create a new tab, or switch to a tab by index.",
    category: "local",
    requiresApproval: false,
    parameters: [
      {
        name: "action",
        type: "string",
        description: "The tab action to perform.",
        required: true,
      },
      {
        name: "tab_index",
        type: "number",
        description:
          "The tab index to switch to (required when action is 'switch').",
        required: false,
      },
    ],
  },
  {
    name: "browser_extract",
    description:
      "Extract the text content of the current page or a specific element.",
    category: "local",
    requiresApproval: false,
    parameters: [
      {
        name: "ref",
        type: "string",
        description:
          "Optional element reference to extract text from. If omitted, extracts from the entire page.",
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
      "Read a workspace file by path. Workspace files are persistent documents like SOUL.md, USER.md, IDENTITY.md, AGENTS.md, and MEMORY.md.",
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
      "Create or update a workspace file. Use this to persist documents like SOUL.md, USER.md, IDENTITY.md, AGENTS.md, and MEMORY.md.",
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
