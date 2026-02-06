/**
 * Memory tools for BudAgent.
 *
 * These tools allow the agent to search and retrieve from the memory system,
 * which stores indexed chunks from memory files (MEMORY.md, etc.).
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolParameter } from "./base";
import type { MemorySearch, HybridSearchResult } from "../memory/search";

/**
 * Validates that a path is within the workspace directory.
 *
 * @param workspacePath - The base workspace directory
 * @param relativePath - The relative path to validate
 * @returns The resolved absolute path if valid
 * @throws Error if the path is outside the workspace
 */
function validateAndResolvePath(
  workspacePath: string,
  relativePath: string
): string {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedPath = path.resolve(workspacePath, relativePath);

  if (
    !resolvedPath.startsWith(resolvedWorkspace + path.sep) &&
    resolvedPath !== resolvedWorkspace
  ) {
    throw new Error(
      `Security error: Path "${relativePath}" is outside the workspace directory`
    );
  }

  return resolvedPath;
}

/**
 * Formats file content with line numbers.
 *
 * @param content - The file content to format
 * @param startLine - The starting line number (1-indexed)
 * @returns Content with line numbers in the format "   1 | content"
 */
function formatWithLineNumbers(content: string, startLine: number = 1): string {
  const lines = content.split("\n");
  const maxLineNum = startLine + lines.length - 1;
  const padding = String(maxLineNum).length;

  return lines
    .map((line, index) => {
      const lineNum = String(startLine + index).padStart(padding, " ");
      return `${lineNum} | ${line}`;
    })
    .join("\n");
}

/**
 * Formats search results into a readable string.
 *
 * @param query - The original search query
 * @param results - Array of search results
 * @param workspacePath - Workspace path for making paths relative
 * @returns Formatted string with search results
 */
function formatSearchResults(
  query: string,
  results: HybridSearchResult[],
  workspacePath: string
): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [
    `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}":`,
    "",
  ];

  results.forEach((result, index) => {
    const resultNum = index + 1;
    const chunk = result.chunk;

    // Make path relative to workspace
    let displayPath = chunk.filePath;
    if (chunk.filePath.startsWith(workspacePath)) {
      displayPath = path.relative(workspacePath, chunk.filePath);
    }

    // Build location string with line numbers if available
    let location = displayPath;
    if (chunk.startLine !== undefined && chunk.endLine !== undefined) {
      location = `${displayPath}:${chunk.startLine}-${chunk.endLine}`;
    } else if (chunk.startLine !== undefined) {
      location = `${displayPath}:${chunk.startLine}`;
    }

    // Format score
    const scoreStr = result.score.toFixed(2);

    lines.push(`${resultNum}. [${location}] (score: ${scoreStr})`);

    // Add headers if available
    if (chunk.headers && chunk.headers.length > 0) {
      lines.push(`   Headers: ${chunk.headers.join(" > ")}`);
    }

    // Add content snippet
    const snippet = result.snippet || chunk.content;
    const truncatedSnippet = truncateContent(snippet, 200);
    lines.push(`   ${truncatedSnippet}`);
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Truncates content to a maximum length, preserving word boundaries.
 *
 * @param content - The content to truncate
 * @param maxLength - Maximum length
 * @returns Truncated content with ellipsis if needed
 */
function truncateContent(content: string, maxLength: number): string {
  // Normalize whitespace
  const cleaned = content.replace(/\s+/g, " ").trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  // Truncate at word boundary
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

/**
 * Tool for searching through memory files using semantic search.
 *
 * This tool performs hybrid search (combining vector similarity and keyword matching)
 * to find relevant content from memory files. Use this to recall prior work,
 * decisions, preferences, or any stored knowledge.
 *
 * @example
 * ```typescript
 * const memorySearch = new MemorySearch(db, embedder);
 * const tool = new MemorySearchTool('/workspace', memorySearch);
 * const results = await tool.execute({
 *   query: 'authentication middleware implementation',
 *   maxResults: 10
 * });
 * ```
 */
export class MemorySearchTool implements Tool {
  name = "memory_search";
  description =
    "Search through memory files using semantic search. Use this to recall prior work, " +
    "decisions, preferences, or any stored knowledge. Returns relevant chunks with file paths, " +
    "line numbers, content snippets, and relevance scores.";

  parameters: ToolParameter[] = [
    {
      name: "query",
      type: "string",
      description:
        "Natural language search query to find relevant memory content",
    },
    {
      name: "maxResults",
      type: "number",
      description: "Maximum number of results to return (default: 6, max: 20)",
      required: false,
    },
    {
      name: "sources",
      type: "array",
      description:
        "Specific file paths to search in (relative to workspace). If not specified, searches all indexed memory files.",
      required: false,
    },
  ];

  private workspacePath: string;
  private memorySearch: MemorySearch | undefined;

  /**
   * Creates a new MemorySearchTool.
   *
   * @param workspacePath - The path to the workspace directory
   * @param memorySearch - The MemorySearch instance for performing searches
   */
  constructor(workspacePath: string, memorySearch?: MemorySearch) {
    this.workspacePath = workspacePath;
    this.memorySearch = memorySearch;
  }

  /**
   * Sets the MemorySearch instance.
   * This allows lazy initialization of the search after construction.
   *
   * @param memorySearch - The MemorySearch instance
   */
  setMemorySearch(memorySearch: MemorySearch): void {
    this.memorySearch = memorySearch;
  }

  /**
   * Executes the memory search.
   *
   * @param params - The search parameters
   * @returns Formatted search results
   */
  async execute(params: Record<string, unknown>): Promise<string> {
    const query = params.query as string;
    const maxResults = Math.min(
      Math.max(1, (params.maxResults as number) || 6),
      20
    );
    const sources = params.sources as string[] | undefined;

    if (!query || typeof query !== "string") {
      return "Error: 'query' parameter is required and must be a string.";
    }

    if (query.trim().length === 0) {
      return "Error: 'query' parameter cannot be empty.";
    }

    if (!this.memorySearch) {
      return "Error: Memory search is not initialized. The memory system may not be set up yet.";
    }

    try {
      // Convert relative paths to absolute paths for source filtering
      let absoluteSources: string[] | undefined;
      if (sources && Array.isArray(sources) && sources.length > 0) {
        absoluteSources = sources.map((source) =>
          path.resolve(this.workspacePath, source)
        );
      }

      const results = await this.memorySearch.search(query, {
        maxResults,
        sources: absoluteSources,
      });

      return formatSearchResults(query, results, this.workspacePath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error searching memory: ${errorMessage}`;
    }
  }
}

/**
 * Tool for getting specific lines from a memory file.
 *
 * Use this tool after memory_search to get more context around a search result.
 * It reads the specified file and extracts the lines in the given range.
 *
 * @example
 * ```typescript
 * const tool = new MemoryGetTool('/workspace');
 * const content = await tool.execute({
 *   path: 'MEMORY.md',
 *   startLine: 15,
 *   endLine: 30
 * });
 * ```
 */
export class MemoryGetTool implements Tool {
  name = "memory_get";
  description =
    "Get specific lines from a memory file. Use after memory_search to get more context " +
    "around a result. Returns content with line numbers.";

  parameters: ToolParameter[] = [
    {
      name: "path",
      type: "string",
      description: "File path relative to workspace",
    },
    {
      name: "startLine",
      type: "number",
      description: "Starting line number (1-indexed)",
    },
    {
      name: "endLine",
      type: "number",
      description: "Ending line number (inclusive)",
    },
  ];

  private workspacePath: string;

  /**
   * Creates a new MemoryGetTool.
   *
   * @param workspacePath - The path to the workspace directory
   */
  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Executes the memory get operation.
   *
   * @param params - The parameters including path and line range
   * @returns File content with line numbers
   */
  async execute(params: Record<string, unknown>): Promise<string> {
    const filePath = params.path as string;
    const startLine = params.startLine as number;
    const endLine = params.endLine as number;

    // Validate parameters
    if (!filePath || typeof filePath !== "string") {
      return "Error: 'path' parameter is required and must be a string.";
    }

    if (startLine === undefined || typeof startLine !== "number") {
      return "Error: 'startLine' parameter is required and must be a number.";
    }

    if (endLine === undefined || typeof endLine !== "number") {
      return "Error: 'endLine' parameter is required and must be a number.";
    }

    if (startLine < 1) {
      return "Error: 'startLine' must be at least 1 (1-indexed).";
    }

    if (endLine < startLine) {
      return `Error: 'endLine' (${endLine}) must be greater than or equal to 'startLine' (${startLine}).`;
    }

    try {
      // Validate path is within workspace
      const resolvedPath = validateAndResolvePath(this.workspacePath, filePath);

      // Check if file exists
      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isFile()) {
          return `Error: Path "${filePath}" is not a file.`;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return `Error: File not found: ${filePath}`;
        }
        throw error;
      }

      // Read file content
      const content = await fs.readFile(resolvedPath, "utf-8");
      const lines = content.split("\n");

      // Validate line range
      if (startLine > lines.length) {
        return `Error: 'startLine' (${startLine}) exceeds file length (${lines.length} lines).`;
      }

      // Clamp endLine to file length
      const effectiveEndLine = Math.min(endLine, lines.length);

      // Extract lines (convert from 1-indexed to 0-indexed)
      const extractedLines = lines.slice(startLine - 1, effectiveEndLine);

      // Format with line numbers
      const formatted = formatWithLineNumbers(
        extractedLines.join("\n"),
        startLine
      );

      // Add file info header
      const header = `File: ${filePath} (lines ${startLine}-${effectiveEndLine} of ${lines.length})`;

      return `${header}\n${"=".repeat(header.length)}\n${formatted}`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error reading file: ${errorMessage}`;
    }
  }
}

/**
 * Creates memory tools with the given configuration.
 *
 * @param workspacePath - The path to the workspace directory
 * @param memorySearch - Optional MemorySearch instance for search operations
 * @returns An array of memory tools
 */
export function createMemoryTools(
  workspacePath: string,
  memorySearch?: MemorySearch
): Tool[] {
  return [
    new MemorySearchTool(workspacePath, memorySearch),
    new MemoryGetTool(workspacePath),
  ];
}
