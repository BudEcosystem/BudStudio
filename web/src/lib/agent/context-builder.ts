/**
 * ContextBuilder - Builds system prompts with memory integration for BudAgent.
 *
 * The ContextBuilder assembles the system prompt from various sources:
 * - SOUL.md - Agent identity and behavioral guidelines
 * - USER.md - User profile and preferences
 * - Memory system - Relevant memories based on user message
 * - Tool descriptions - Available tools and their parameters
 * - Workspace context - Current workspace path and time info
 */

import { loadWorkspaceContextFiles } from "./context-files";
import type { MemorySearch } from "./memory/search";
import type { Tool, ToolParameter } from "./tools/base";

/**
 * Parameters for building the system prompt.
 */
export interface ContextBuilderParams {
  /** Available tools for tool descriptions */
  tools: Tool[];
  /** Current user message for context-relevant memory retrieval */
  userMessage?: string;
  /** User's timezone for temporal awareness */
  userTimezone?: string;
  /** Extra context to include in the prompt */
  additionalContext?: string;
}

/**
 * Default content for SOUL.md when file is not found.
 */
const DEFAULT_SOUL_CONTENT = `# Bud Agent Soul

## Identity
You are Bud Agent, an autonomous AI assistant created by Bud Studio.
You help users accomplish complex tasks by working independently.

## Core Principles
1. **Be Resourceful**: Try to solve problems before asking for help
2. **Be Thorough**: Complete tasks fully, don't leave loose ends
3. **Be Safe**: Ask for approval before destructive operations
4. **Be Transparent**: Explain your reasoning and actions

## Communication Style
- Be concise and direct
- Use technical language when appropriate
- Acknowledge uncertainty honestly
- Focus on solutions, not problems

## Behavioral Guidelines
- Always read files before editing them
- Prefer editing over creating new files
- Run tests after making changes
- Commit related changes together
- Search memory before answering questions about past work
`;

/**
 * Memory recall instructions for the agent.
 */
const MEMORY_RECALL_INSTRUCTIONS = `## Memory System

You have access to a memory system that stores information from previous conversations and workspace files.

### Using Memory
- Use \`memory_search\` to find relevant information based on a natural language query
- Use \`memory_get\` to retrieve specific lines from a file after finding results with memory_search
- Always search memory when:
  - The user asks about past work, decisions, or preferences
  - You need context about the codebase or project
  - You want to recall specific implementation details

### Best Practices
- Search memory before making assumptions about past work
- Use specific, focused queries for better results
- When results reference a file, use memory_get to see more context
- Memories are stored with relevance scores - higher scores indicate better matches
`;

/**
 * Behavioral guidelines for the agent.
 */
const BEHAVIORAL_GUIDELINES = `## Behavioral Guidelines

### Safety First
- Always ask for approval before:
  - Deleting files or directories
  - Executing potentially destructive commands
  - Making changes that cannot be easily undone
  - Accessing sensitive information

### Code Quality
- Read files before editing to understand context
- Make minimal, focused changes
- Preserve existing code style and formatting
- Add appropriate comments for complex logic
- Run tests after making changes when possible

### Communication
- Explain what you're doing and why
- Report progress on long-running tasks
- Acknowledge when you're uncertain
- Ask clarifying questions when the request is ambiguous

### Error Handling
- When errors occur, analyze the error message
- Try alternative approaches before giving up
- Report errors clearly with relevant context
- Suggest potential solutions when possible
`;

/**
 * Formats a single tool parameter for the prompt.
 *
 * @param param - The tool parameter to format
 * @returns Formatted parameter string
 */
function formatToolParameter(param: ToolParameter): string {
  const requiredStr = param.required === false ? "optional" : "required";
  let typeStr: string = param.type;

  if (param.enum && param.enum.length > 0) {
    typeStr = `${param.type}, one of: ${param.enum.join(", ")}`;
  }

  return `- ${param.name} (${typeStr}, ${requiredStr}): ${param.description}`;
}

/**
 * Formats a tool for inclusion in the system prompt.
 *
 * @param tool - The tool to format
 * @returns Formatted tool description
 */
function formatToolDescription(tool: Tool): string {
  const lines: string[] = [];

  lines.push(`### Tool: ${tool.name}`);
  lines.push(tool.description);

  if (tool.parameters.length > 0) {
    lines.push("Parameters:");
    for (const param of tool.parameters) {
      lines.push(formatToolParameter(param));
    }
  } else {
    lines.push("Parameters: none");
  }

  if (tool.requiresApproval) {
    lines.push("Note: This tool requires user approval before execution.");
  }

  return lines.join("\n");
}

/**
 * Formats multiple tools for the system prompt.
 *
 * @param tools - Array of tools to format
 * @returns Formatted tools section
 */
function formatTools(tools: Tool[]): string {
  if (tools.length === 0) {
    return "## Available Tools\n\nNo tools are currently available.";
  }

  const lines: string[] = ["## Available Tools", ""];

  for (const tool of tools) {
    lines.push(formatToolDescription(tool));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * ContextBuilder assembles the system prompt from various sources.
 *
 * It loads workspace context files (SOUL.md, USER.md), optionally retrieves
 * relevant memories based on the user message, formats available tools,
 * and combines everything into a comprehensive system prompt.
 *
 * @example
 * ```typescript
 * const builder = new ContextBuilder('/workspace', memorySearch);
 *
 * const systemPrompt = await builder.build({
 *   tools: [readFileTool, writeFileTool],
 *   userMessage: 'Help me fix the authentication bug',
 *   userTimezone: 'America/New_York',
 * });
 * ```
 */
export class ContextBuilder {
  private readonly workspacePath: string;
  private readonly memorySearch?: MemorySearch;

  /**
   * Creates a new ContextBuilder.
   *
   * @param workspacePath - Path to the workspace directory
   * @param memorySearch - Optional MemorySearch instance for retrieving relevant memories
   */
  constructor(workspacePath: string, memorySearch?: MemorySearch) {
    this.workspacePath = workspacePath;
    this.memorySearch = memorySearch;
  }

  /**
   * Builds the system prompt from various sources.
   *
   * The prompt is assembled in this order:
   * 1. Agent Identity (from SOUL.md)
   * 2. User Context (from USER.md)
   * 3. Memory Recall Instructions
   * 4. Relevant Memories (if memorySearch provided and userMessage given)
   * 5. Available Tools
   * 6. Behavioral Guidelines
   * 7. Current Time/Timezone (if provided)
   * 8. Workspace Info
   *
   * @param params - Parameters for building the prompt
   * @returns The assembled system prompt
   */
  async build(params: ContextBuilderParams): Promise<string> {
    const sections: string[] = [];

    // 1. Load workspace context files
    const contextFiles = await loadWorkspaceContextFiles(this.workspacePath);

    // 2. Agent Identity (SOUL.md)
    const soulContent = contextFiles.soul || DEFAULT_SOUL_CONTENT;
    sections.push(soulContent.trim());

    // 3. User Context (USER.md) - only include if present
    if (contextFiles.user) {
      sections.push(contextFiles.user.trim());
    }

    // 4. Memory Recall Instructions
    sections.push(MEMORY_RECALL_INSTRUCTIONS.trim());

    // 5. Relevant Memories (if available)
    if (this.memorySearch && params.userMessage) {
      const memoriesSection = await this.buildMemoriesSection(
        params.userMessage
      );
      if (memoriesSection) {
        sections.push(memoriesSection);
      }
    }

    // 6. Available Tools
    sections.push(formatTools(params.tools));

    // 7. Behavioral Guidelines
    sections.push(BEHAVIORAL_GUIDELINES.trim());

    // 8. Current Time/Timezone
    if (params.userTimezone) {
      const timeSection = this.buildTimeSection(params.userTimezone);
      sections.push(timeSection);
    }

    // 9. Workspace Info
    const workspaceSection = this.buildWorkspaceSection();
    sections.push(workspaceSection);

    // 10. Additional Context (if provided)
    if (params.additionalContext) {
      sections.push(`## Additional Context\n\n${params.additionalContext}`);
    }

    // Join all sections with double newlines
    return sections.join("\n\n");
  }

  /**
   * Builds the relevant memories section by searching for memories
   * related to the user message.
   *
   * @param userMessage - The user's message to search for relevant memories
   * @returns Formatted memories section or undefined if no relevant memories
   */
  private async buildMemoriesSection(
    userMessage: string
  ): Promise<string | undefined> {
    if (!this.memorySearch) {
      return undefined;
    }

    try {
      // Search for top 3 most relevant memories
      const results = await this.memorySearch.search(userMessage, {
        maxResults: 3,
      });

      if (results.length === 0) {
        return undefined;
      }

      const lines: string[] = ["## Relevant Memories", ""];
      lines.push(
        "The following memories may be relevant to the current conversation:"
      );
      lines.push("");

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const chunk = result.chunk;

        // Build location string
        let location = chunk.filePath;
        if (
          chunk.filePath.startsWith(this.workspacePath)
        ) {
          location = chunk.filePath.slice(this.workspacePath.length + 1);
        }
        if (chunk.startLine !== undefined && chunk.endLine !== undefined) {
          location = `${location}:${chunk.startLine}-${chunk.endLine}`;
        }

        // Format score
        const score = result.score.toFixed(2);

        lines.push(`**Memory ${i + 1}** (relevance: ${score})`);
        lines.push(`Source: ${location}`);

        // Add headers if available
        if (chunk.headers && chunk.headers.length > 0) {
          lines.push(`Context: ${chunk.headers.join(" > ")}`);
        }

        // Add content (truncated if too long)
        const content = this.truncateContent(chunk.content, 300);
        lines.push("```");
        lines.push(content);
        lines.push("```");
        lines.push("");
      }

      return lines.join("\n");
    } catch (error) {
      // If memory search fails, log and continue without memories
      console.warn("Failed to retrieve relevant memories:", error);
      return undefined;
    }
  }

  /**
   * Builds the time section with current time and timezone info.
   *
   * @param timezone - The user's timezone
   * @returns Formatted time section
   */
  private buildTimeSection(timezone: string): string {
    const now = new Date();

    let formattedTime: string;
    try {
      formattedTime = now.toLocaleString("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      // Fallback if timezone is invalid
      formattedTime = now.toISOString();
    }

    return `## Current Time\n\nCurrent time: ${formattedTime}\nTimezone: ${timezone}`;
  }

  /**
   * Builds the workspace info section.
   *
   * @returns Formatted workspace section
   */
  private buildWorkspaceSection(): string {
    return `## Workspace\n\nCurrent workspace: ${this.workspacePath}`;
  }

  /**
   * Truncates content to a maximum length, preserving word boundaries.
   *
   * @param content - The content to truncate
   * @param maxLength - Maximum length
   * @returns Truncated content with ellipsis if needed
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    const truncated = content.slice(0, maxLength);
    const lastNewline = truncated.lastIndexOf("\n");
    const lastSpace = truncated.lastIndexOf(" ");

    // Prefer breaking at newline, then space, then just truncate
    const breakPoint = Math.max(lastNewline, lastSpace);
    if (breakPoint > maxLength * 0.5) {
      return truncated.slice(0, breakPoint) + "\n...";
    }

    return truncated + "...";
  }
}

/**
 * Factory function to create a ContextBuilder instance.
 *
 * @param workspacePath - Path to the workspace directory
 * @param memorySearch - Optional MemorySearch instance for retrieving relevant memories
 * @returns A new ContextBuilder instance
 *
 * @example
 * ```typescript
 * const builder = createContextBuilder('/workspace', memorySearch);
 * const systemPrompt = await builder.build({
 *   tools: tools,
 *   userMessage: 'Help me with the tests',
 * });
 * ```
 */
export function createContextBuilder(
  workspacePath: string,
  memorySearch?: MemorySearch
): ContextBuilder {
  return new ContextBuilder(workspacePath, memorySearch);
}
