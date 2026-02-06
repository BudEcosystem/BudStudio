/**
 * Search tools for BudAgent: glob and grep.
 *
 * These tools allow the agent to search for files by pattern
 * and search for content within files.
 */

import { glob } from "glob";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

import type { Tool, ToolParameter } from "./base";

const execAsync = promisify(exec);

/** Maximum number of results to return from glob searches */
const MAX_GLOB_RESULTS = 100;

/** Maximum output size for grep results (in characters) */
const MAX_GREP_OUTPUT = 50000;

/** Maximum number of matches per file for grep */
const MAX_MATCHES_PER_FILE = 100;

/** Timeout for ripgrep subprocess (30 seconds) */
const GREP_TIMEOUT_MS = 30000;

/** Default ignore patterns for file searches */
const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
];

/**
 * Validates that a resolved path is within the workspace.
 * Prevents path traversal attacks.
 *
 * @param workspacePath - The base workspace path
 * @param targetPath - The path to validate
 * @throws Error if the path is outside the workspace
 */
function validatePathWithinWorkspace(
  workspacePath: string,
  targetPath: string
): void {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedTarget = path.resolve(targetPath);

  if (!resolvedTarget.startsWith(resolvedWorkspace + path.sep) &&
      resolvedTarget !== resolvedWorkspace) {
    throw new Error(
      `Path "${targetPath}" is outside the workspace. Access denied.`
    );
  }
}

/**
 * Escapes special characters for safe shell argument usage.
 *
 * @param arg - The argument to escape
 * @returns The escaped argument
 */
function escapeShellArg(arg: string): string {
  // For Unix-like systems, wrap in single quotes and escape single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * GlobTool - Find files matching a glob pattern.
 *
 * This tool searches for files in the workspace that match a given
 * glob pattern (e.g., "**\/*.ts", "src/**\/*.tsx").
 *
 * @example
 * ```typescript
 * const tool = new GlobTool('/path/to/workspace');
 * const result = await tool.execute({ pattern: '**\/*.ts' });
 * // Returns: "src/index.ts\nsrc/utils.ts\n..."
 * ```
 */
export class GlobTool implements Tool {
  name = "glob";
  description =
    "Find files matching a glob pattern. Returns matching file paths relative to the workspace. " +
    "Common patterns: '**/*.ts' (all TypeScript files), 'src/**/*.tsx' (React files in src), " +
    "'**/test/*.spec.ts' (test files). Results are limited to 100 files.";

  parameters: ToolParameter[] = [
    {
      name: "pattern",
      type: "string",
      description:
        'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx", "*.json")',
    },
    {
      name: "directory",
      type: "string",
      description:
        "Directory to search in, relative to workspace. Defaults to workspace root.",
      required: false,
    },
  ];

  constructor(private workspacePath: string) {}

  async execute(params: Record<string, unknown>): Promise<string> {
    const { pattern, directory } = params as {
      pattern: string;
      directory?: string;
    };

    if (!pattern || typeof pattern !== "string") {
      return "Error: 'pattern' parameter is required and must be a string.";
    }

    try {
      // Resolve the search path
      let searchPath = this.workspacePath;
      if (directory && typeof directory === "string") {
        searchPath = path.join(this.workspacePath, directory);
      }

      // Security: Validate the search path is within workspace
      validatePathWithinWorkspace(this.workspacePath, searchPath);

      // Check if the search path exists
      try {
        await fs.access(searchPath);
      } catch {
        return `Error: Directory "${directory || "."}" does not exist.`;
      }

      // Perform the glob search
      const matches = await glob(pattern, {
        cwd: searchPath,
        nodir: true,
        ignore: DEFAULT_IGNORE_PATTERNS,
        dot: false, // Don't match dotfiles by default
        absolute: false,
      });

      if (matches.length === 0) {
        return `No files found matching pattern "${pattern}"${
          directory ? ` in directory "${directory}"` : ""
        }.`;
      }

      // Sort by path for consistent output
      matches.sort();

      // Check if we need to truncate
      const truncated = matches.length > MAX_GLOB_RESULTS;
      const resultFiles = truncated
        ? matches.slice(0, MAX_GLOB_RESULTS)
        : matches;

      // Format results with directory prefix if specified
      const formattedResults = resultFiles.map((file) =>
        directory ? path.join(directory, file) : file
      );

      let result = formattedResults.join("\n");

      if (truncated) {
        result += `\n\n[Results truncated: showing ${MAX_GLOB_RESULTS} of ${matches.length} files. Use a more specific pattern to narrow results.]`;
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error searching for files: ${errorMessage}`;
    }
  }
}

/**
 * GrepTool - Search for a pattern in files.
 *
 * This tool searches for content matching a regex pattern within files.
 * It tries to use ripgrep (rg) for performance, falling back to a
 * simple recursive search if ripgrep is not available.
 *
 * @example
 * ```typescript
 * const tool = new GrepTool('/path/to/workspace');
 * const result = await tool.execute({ pattern: 'function\\s+\\w+' });
 * // Returns: "src/index.ts:10:function main() {"
 * ```
 */
export class GrepTool implements Tool {
  name = "grep";
  description =
    "Search for a regex pattern in files. Returns matching lines with file paths and line numbers. " +
    "Uses ripgrep for fast searching. Supports regex patterns like 'function\\s+\\w+' or 'TODO|FIXME'.";

  parameters: ToolParameter[] = [
    {
      name: "pattern",
      type: "string",
      description:
        'Regex pattern to search for (e.g., "function\\s+\\w+", "TODO|FIXME", "import.*react")',
    },
    {
      name: "path",
      type: "string",
      description:
        "File or directory to search in, relative to workspace. Defaults to entire workspace.",
      required: false,
    },
    {
      name: "include",
      type: "string",
      description:
        'Glob pattern for files to include (e.g., "*.ts", "*.{ts,tsx}", "*.py")',
      required: false,
    },
  ];

  constructor(private workspacePath: string) {}

  async execute(params: Record<string, unknown>): Promise<string> {
    const { pattern, path: searchPath, include } = params as {
      pattern: string;
      path?: string;
      include?: string;
    };

    if (!pattern || typeof pattern !== "string") {
      return "Error: 'pattern' parameter is required and must be a string.";
    }

    try {
      // Resolve the search path
      let targetPath = this.workspacePath;
      if (searchPath && typeof searchPath === "string") {
        targetPath = path.join(this.workspacePath, searchPath);
      }

      // Security: Validate the search path is within workspace
      validatePathWithinWorkspace(this.workspacePath, targetPath);

      // Check if the target path exists
      try {
        await fs.access(targetPath);
      } catch {
        return `Error: Path "${searchPath || "."}" does not exist.`;
      }

      // Try ripgrep first
      const rgResult = await this.tryRipgrep(pattern, targetPath, include);
      if (rgResult !== null) {
        return rgResult;
      }

      // Fall back to simple recursive search
      return await this.fallbackSearch(pattern, targetPath, include);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error searching: ${errorMessage}`;
    }
  }

  /**
   * Attempts to use ripgrep for searching.
   *
   * @returns Search results or null if ripgrep is not available
   */
  private async tryRipgrep(
    pattern: string,
    targetPath: string,
    include?: string
  ): Promise<string | null> {
    try {
      // Build ripgrep command
      const args = [
        "rg",
        "--line-number",
        "--color=never",
        `--max-count=${MAX_MATCHES_PER_FILE}`,
        "--no-heading",
        "--with-filename",
      ];

      // Add ignore patterns
      for (const ignorePattern of DEFAULT_IGNORE_PATTERNS) {
        args.push(`--glob=!${ignorePattern}`);
      }

      // Add include pattern if specified
      if (include && typeof include === "string") {
        args.push(`--glob=${include}`);
      }

      // Add pattern and path (escaped)
      args.push("--", escapeShellArg(pattern), escapeShellArg(targetPath));

      const command = args.join(" ");

      const { stdout, stderr } = await execAsync(command, {
        timeout: GREP_TIMEOUT_MS,
        maxBuffer: MAX_GREP_OUTPUT * 2, // Allow some buffer for processing
        cwd: this.workspacePath,
      });

      if (stderr && !stdout) {
        // ripgrep writes warnings to stderr, not errors
        // Empty stdout with stderr might indicate an issue
        return null;
      }

      const output = stdout.trim();

      if (!output) {
        return `No matches found for pattern "${pattern}".`;
      }

      // Make paths relative to workspace
      const lines = output.split("\n");
      const relativeLines = lines.map((line) => {
        // ripgrep format: /absolute/path/file.ts:123:content
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match && match[1] && match[2]) {
          const filePath = match[1];
          const lineNum = match[2];
          const content = match[3] ?? "";
          const relativePath = path.relative(this.workspacePath, filePath);
          return `${relativePath}:${lineNum}:${content}`;
        }
        return line;
      });

      let result = relativeLines.join("\n");

      // Truncate if too long
      if (result.length > MAX_GREP_OUTPUT) {
        const truncatedLines = [];
        let totalLength = 0;

        for (const line of relativeLines) {
          if (totalLength + line.length + 1 > MAX_GREP_OUTPUT - 100) {
            break;
          }
          truncatedLines.push(line);
          totalLength += line.length + 1;
        }

        result =
          truncatedLines.join("\n") +
          "\n\n[Results truncated due to size. Use a more specific pattern or path.]";
      }

      return result;
    } catch (error) {
      // Check if ripgrep is not installed or command failed
      const execError = error as {
        code?: number;
        killed?: boolean;
        message?: string;
      };

      // Exit code 1 = no matches (not an error)
      if (execError.code === 1) {
        return `No matches found for pattern "${pattern}".`;
      }

      // Exit code 2 = error, other codes or ENOENT = ripgrep not available
      if (
        execError.message?.includes("ENOENT") ||
        execError.message?.includes("not found")
      ) {
        // ripgrep not installed, fall back
        return null;
      }

      // Timeout
      if (execError.killed) {
        return "Error: Search timed out. Try a more specific pattern or path.";
      }

      // Other errors - fall back to simple search
      return null;
    }
  }

  /**
   * Fallback recursive search when ripgrep is not available.
   * This is slower but works without external dependencies.
   */
  private async fallbackSearch(
    pattern: string,
    targetPath: string,
    include?: string
  ): Promise<string> {
    const results: string[] = [];
    let totalMatches = 0;
    const maxTotalMatches = 500;

    // Compile the regex
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "gi");
    } catch {
      return `Error: Invalid regex pattern "${pattern}".`;
    }

    // Compile include pattern if specified
    let includeRegex: RegExp | null = null;
    if (include && typeof include === "string") {
      // Convert glob to regex (simplified)
      const regexPattern = include
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")
        .replace(/\{([^}]+)\}/g, (_, p1) => `(${p1.replace(/,/g, "|")})`);
      includeRegex = new RegExp(`^${regexPattern}$`, "i");
    }

    // Recursive search function
    const searchDirectory = async (dirPath: string): Promise<void> => {
      if (totalMatches >= maxTotalMatches) return;

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (totalMatches >= maxTotalMatches) break;

        const entryPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.workspacePath, entryPath);

        // Check ignore patterns
        const shouldIgnore = DEFAULT_IGNORE_PATTERNS.some((ignorePattern) => {
          const regexPattern = ignorePattern
            .replace(/\*\*/g, ".*")
            .replace(/\*/g, "[^/]*");
          return new RegExp(regexPattern).test(relativePath);
        });

        if (shouldIgnore) continue;

        if (entry.isDirectory()) {
          await searchDirectory(entryPath);
        } else if (entry.isFile()) {
          // Check include pattern
          if (includeRegex && !includeRegex.test(entry.name)) {
            continue;
          }

          // Search file
          try {
            const content = await fs.readFile(entryPath, "utf-8");
            const lines = content.split("\n");

            for (let i = 0; i < lines.length && totalMatches < maxTotalMatches; i++) {
              const line = lines[i] ?? "";
              regex.lastIndex = 0; // Reset regex state
              if (regex.test(line)) {
                results.push(`${relativePath}:${i + 1}:${line}`);
                totalMatches++;
              }
            }
          } catch {
            // Skip files that can't be read (binary, permissions, etc.)
          }
        }
      }
    };

    // Determine if target is file or directory
    const stats = await fs.stat(targetPath);

    if (stats.isFile()) {
      // Search single file
      const relativePath = path.relative(this.workspacePath, targetPath);
      try {
        const content = await fs.readFile(targetPath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length && totalMatches < maxTotalMatches; i++) {
          const line = lines[i] ?? "";
          regex.lastIndex = 0;
          if (regex.test(line)) {
            results.push(`${relativePath}:${i + 1}:${line}`);
            totalMatches++;
          }
        }
      } catch {
        return `Error: Could not read file "${relativePath}".`;
      }
    } else {
      await searchDirectory(targetPath);
    }

    if (results.length === 0) {
      return `No matches found for pattern "${pattern}".`;
    }

    let result = results.join("\n");

    if (totalMatches >= maxTotalMatches) {
      result += `\n\n[Results truncated at ${maxTotalMatches} matches. Use a more specific pattern or path.]`;
    }

    // Truncate if too long
    if (result.length > MAX_GREP_OUTPUT) {
      result =
        result.slice(0, MAX_GREP_OUTPUT - 100) +
        "\n\n[Results truncated due to size.]";
    }

    return result;
  }
}
