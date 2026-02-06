/**
 * File operation tools for BudAgent.
 *
 * These tools allow the agent to read, write, and edit files within a
 * designated workspace directory. All operations include security checks
 * to prevent path traversal attacks.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { Tool, ToolParameter } from "./base";

/**
 * Error thrown when a path traversal attack is detected.
 */
export class PathTraversalError extends Error {
  constructor(attemptedPath: string) {
    super(
      `Security error: Path "${attemptedPath}" is outside the workspace directory`
    );
    this.name = "PathTraversalError";
  }
}

/**
 * Validates that a path is within the workspace directory.
 *
 * This function resolves the full path and ensures it starts with the
 * workspace path to prevent directory traversal attacks.
 *
 * @param workspacePath - The base workspace directory
 * @param relativePath - The relative path to validate
 * @returns The resolved absolute path if valid
 * @throws PathTraversalError if the path is outside the workspace
 */
function validateAndResolvePath(
  workspacePath: string,
  relativePath: string
): string {
  // Resolve both paths to absolute paths
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedPath = path.resolve(workspacePath, relativePath);

  // Ensure the resolved path starts with the workspace path
  // Add path.sep to prevent matching partial directory names
  // e.g., /workspace-evil shouldn't match /workspace
  if (
    !resolvedPath.startsWith(resolvedWorkspace + path.sep) &&
    resolvedPath !== resolvedWorkspace
  ) {
    throw new PathTraversalError(relativePath);
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
 * Tool for reading file contents from the workspace.
 *
 * Supports reading entire files or specific line ranges. Output includes
 * line numbers for easy reference.
 *
 * @example
 * ```typescript
 * const tool = new ReadFileTool('/workspace');
 * const content = await tool.execute({ path: 'src/index.ts' });
 * // Returns:
 * // 1 | import { foo } from './foo';
 * // 2 | console.log(foo);
 * ```
 */
export class ReadFileTool implements Tool {
  name = "read_file";
  description =
    "Read the contents of a file from the workspace. Returns file content with line numbers.";
  parameters: ToolParameter[] = [
    {
      name: "path",
      type: "string",
      description: "Relative path to the file within the workspace",
    },
    {
      name: "startLine",
      type: "number",
      description: "Starting line number (1-indexed, optional)",
      required: false,
    },
    {
      name: "endLine",
      type: "number",
      description: "Ending line number (inclusive, optional)",
      required: false,
    },
  ];

  constructor(private workspacePath: string) {}

  async execute(params: Record<string, unknown>): Promise<string> {
    const filePath = params.path as string;
    const startLine = params.startLine as number | undefined;
    const endLine = params.endLine as number | undefined;

    if (!filePath || typeof filePath !== "string") {
      throw new Error("Parameter 'path' is required and must be a string");
    }

    // Validate path is within workspace
    const resolvedPath = validateAndResolvePath(this.workspacePath, filePath);

    // Check if file exists
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`Path "${filePath}" is not a file`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }

    // Read file content
    const content = await fs.readFile(resolvedPath, "utf-8");

    // If line range specified, slice the content
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split("\n");
      const start = startLine !== undefined ? Math.max(1, startLine) : 1;
      const end =
        endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

      if (start > end) {
        throw new Error(
          `Invalid line range: startLine (${start}) > endLine (${end})`
        );
      }

      if (start > lines.length) {
        throw new Error(
          `startLine (${start}) exceeds file length (${lines.length} lines)`
        );
      }

      // Slice lines (convert from 1-indexed to 0-indexed)
      const slicedLines = lines.slice(start - 1, end);
      return formatWithLineNumbers(slicedLines.join("\n"), start);
    }

    return formatWithLineNumbers(content, 1);
  }
}

/**
 * Tool for writing content to a file in the workspace.
 *
 * Creates the file if it doesn't exist, or overwrites if it does.
 * Parent directories are created automatically if needed.
 *
 * @example
 * ```typescript
 * const tool = new WriteFileTool('/workspace');
 * const result = await tool.execute({
 *   path: 'src/new-file.ts',
 *   content: 'export const x = 1;'
 * });
 * // Returns: "Successfully wrote 20 characters to src/new-file.ts"
 * ```
 */
export class WriteFileTool implements Tool {
  name = "write_file";
  description =
    "Write content to a file in the workspace. Creates the file if it does not exist, or overwrites it if it does. Parent directories are created automatically.";
  parameters: ToolParameter[] = [
    {
      name: "path",
      type: "string",
      description: "Relative path to the file within the workspace",
    },
    {
      name: "content",
      type: "string",
      description: "Content to write to the file",
    },
  ];
  requiresApproval = true;

  constructor(private workspacePath: string) {}

  async execute(params: Record<string, unknown>): Promise<string> {
    const filePath = params.path as string;
    const content = params.content as string;

    if (!filePath || typeof filePath !== "string") {
      throw new Error("Parameter 'path' is required and must be a string");
    }

    if (content === undefined || content === null) {
      throw new Error("Parameter 'content' is required");
    }

    // Ensure content is a string
    const contentStr = String(content);

    // Validate path is within workspace
    const resolvedPath = validateAndResolvePath(this.workspacePath, filePath);

    // Create parent directories if they don't exist
    const parentDir = path.dirname(resolvedPath);
    await fs.mkdir(parentDir, { recursive: true });

    // Write the file
    await fs.writeFile(resolvedPath, contentStr, "utf-8");

    return `Successfully wrote ${contentStr.length} characters to ${filePath}`;
  }
}

/**
 * Tool for editing a file by replacing specific text.
 *
 * Finds and replaces exact text within a file. If the text to find
 * appears multiple times, an error is thrown asking for more context
 * to ensure the correct occurrence is replaced.
 *
 * @example
 * ```typescript
 * const tool = new EditFileTool('/workspace');
 * const result = await tool.execute({
 *   path: 'src/index.ts',
 *   oldText: 'console.log("hello")',
 *   newText: 'console.log("world")'
 * });
 * // Returns: "Successfully edited src/index.ts"
 * ```
 */
export class EditFileTool implements Tool {
  name = "edit_file";
  description =
    "Edit a file by replacing specific text. The text to find must be unique within the file. If the text appears multiple times, provide more surrounding context to make it unique.";
  parameters: ToolParameter[] = [
    {
      name: "path",
      type: "string",
      description: "Relative path to the file within the workspace",
    },
    {
      name: "oldText",
      type: "string",
      description:
        "The exact text to find and replace. Must be unique within the file.",
    },
    {
      name: "newText",
      type: "string",
      description: "The replacement text",
    },
  ];
  requiresApproval = true;

  constructor(private workspacePath: string) {}

  async execute(params: Record<string, unknown>): Promise<string> {
    const filePath = params.path as string;
    const oldText = params.oldText as string;
    const newText = params.newText as string;

    if (!filePath || typeof filePath !== "string") {
      throw new Error("Parameter 'path' is required and must be a string");
    }

    if (!oldText || typeof oldText !== "string") {
      throw new Error("Parameter 'oldText' is required and must be a string");
    }

    if (newText === undefined || newText === null) {
      throw new Error("Parameter 'newText' is required");
    }

    // Ensure newText is a string
    const newTextStr = String(newText);

    // Validate path is within workspace
    const resolvedPath = validateAndResolvePath(this.workspacePath, filePath);

    // Check if file exists
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error(`Path "${filePath}" is not a file`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }

    // Read file content
    const content = await fs.readFile(resolvedPath, "utf-8");

    // Check if oldText exists in file
    if (!content.includes(oldText)) {
      throw new Error(
        `Text to replace not found in file "${filePath}". ` +
          `Make sure the text matches exactly, including whitespace and newlines.`
      );
    }

    // Count occurrences
    const occurrences = content.split(oldText).length - 1;

    if (occurrences > 1) {
      throw new Error(
        `Found ${occurrences} occurrences of the text to replace in "${filePath}". ` +
          `Please provide more surrounding context to make the text unique.`
      );
    }

    // Replace the text (only first occurrence, though we've verified there's only one)
    const newContent = content.replace(oldText, newTextStr);

    // Write back
    await fs.writeFile(resolvedPath, newContent, "utf-8");

    return `Successfully edited ${filePath}`;
  }
}

/**
 * Creates all file tools with the given workspace path.
 *
 * @param workspacePath - The path to the workspace directory
 * @returns An array of file operation tools
 */
export function createFileTools(workspacePath: string): Tool[] {
  return [
    new ReadFileTool(workspacePath),
    new WriteFileTool(workspacePath),
    new EditFileTool(workspacePath),
  ];
}
