/**
 * Memory file detection utilities.
 *
 * This module provides utilities for detecting memory files and generating
 * diffs for proposed changes. Memory files are special files that the agent
 * uses to maintain context and preferences across sessions.
 */

/**
 * List of known memory file names (case-insensitive).
 */
const MEMORY_FILE_NAMES = new Set([
  "soul.md",
  "user.md",
  "memory.md",
  "agents.md",
]);

/**
 * Pattern for files in the memory directory.
 */
const MEMORY_DIR_PATTERN = /^memory\//i;

/**
 * Check if a file path represents a memory file.
 *
 * Memory files include:
 * - SOUL.md - Agent personality and behavior definitions
 * - USER.md - User preferences and context
 * - MEMORY.md - Session memory and notes
 * - AGENTS.md - Agent definitions and configurations
 * - memory/*.md - Any markdown file in the memory directory
 *
 * @param filePath - The path to check (can be relative or absolute)
 * @returns True if the path is a memory file
 */
export function isMemoryFile(filePath: string): boolean {
  // Normalize the path - extract just the file name and directory
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

  // Get the file name
  const parts = normalizedPath.split("/");
  const fileName = parts[parts.length - 1] ?? "";

  // Check if it's a known memory file
  if (fileName && MEMORY_FILE_NAMES.has(fileName)) {
    return true;
  }

  // Check if it's in the memory directory
  // Look for "memory/" in the path
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === "memory" && fileName.endsWith(".md")) {
      return true;
    }
  }

  // Also check for workspace-relative paths like "memory/notes.md"
  if (MEMORY_DIR_PATTERN.test(normalizedPath) && fileName.endsWith(".md")) {
    return true;
  }

  return false;
}

/**
 * Get a human-readable description of a memory file.
 *
 * @param filePath - The path to the memory file
 * @returns A description of the file's purpose
 */
export function getMemoryFileDescription(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const parts = normalizedPath.split("/");
  const fileName = parts[parts.length - 1] ?? "";

  switch (fileName) {
    case "soul.md":
      return "Agent personality and behavior definitions";
    case "user.md":
      return "User preferences and context";
    case "memory.md":
      return "Session memory and notes";
    case "agents.md":
      return "Agent definitions and configurations";
    default:
      if (normalizedPath.includes("memory/")) {
        return "Memory file";
      }
      return "File";
  }
}

/**
 * A single line in a diff view.
 */
export interface DiffLine {
  /** The type of change: 'add', 'remove', or 'unchanged' */
  type: "add" | "remove" | "unchanged";
  /** The content of the line */
  content: string;
  /** The original line number (for unchanged and removed lines) */
  oldLineNumber?: number;
  /** The new line number (for unchanged and added lines) */
  newLineNumber?: number;
}

/**
 * Generate a simple line-by-line diff between old and new content.
 *
 * This uses a simple longest common subsequence (LCS) algorithm to
 * identify added, removed, and unchanged lines.
 *
 * @param oldContent - The original content
 * @param newContent - The proposed new content
 * @returns An array of DiffLine objects representing the diff
 */
export function generateDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Build LCS table
  const lcs = buildLcsTable(oldLines, newLines);

  // Backtrack to generate diff
  const diff: DiffLine[] = [];
  let oldIdx = oldLines.length;
  let newIdx = newLines.length;

  while (oldIdx > 0 || newIdx > 0) {
    const oldLine = oldLines[oldIdx - 1];
    const newLine = newLines[newIdx - 1];
    const lcsCurrentRow = lcs[oldIdx];
    const lcsPrevRow = lcs[oldIdx - 1];

    if (oldIdx > 0 && newIdx > 0 && oldLine === newLine) {
      // Unchanged line
      diff.unshift({
        type: "unchanged",
        content: oldLine ?? "",
        oldLineNumber: oldIdx,
        newLineNumber: newIdx,
      });
      oldIdx--;
      newIdx--;
    } else if (
      newIdx > 0 &&
      (oldIdx === 0 ||
        (lcsCurrentRow !== undefined &&
          lcsPrevRow !== undefined &&
          (lcsCurrentRow[newIdx - 1] ?? 0) >= (lcsPrevRow[newIdx] ?? 0)))
    ) {
      // Added line
      diff.unshift({
        type: "add",
        content: newLine ?? "",
        newLineNumber: newIdx,
      });
      newIdx--;
    } else if (oldIdx > 0) {
      // Removed line
      diff.unshift({
        type: "remove",
        content: oldLine ?? "",
        oldLineNumber: oldIdx,
      });
      oldIdx--;
    }
  }

  return diff;
}

/**
 * Build the LCS (Longest Common Subsequence) table.
 */
function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;

  // Initialize table with zeros
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0) as number[]
  );

  // Fill the table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const row = table[i];
      const prevRow = table[i - 1];
      if (row && prevRow) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          row[j] = (prevRow[j - 1] ?? 0) + 1;
        } else {
          row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
        }
      }
    }
  }

  return table;
}

/**
 * Format a diff as a unified diff string (for display purposes).
 *
 * @param diff - The diff lines to format
 * @param fileName - The file name for the diff header
 * @returns A formatted unified diff string
 */
export function formatUnifiedDiff(diff: DiffLine[], fileName: string): string {
  const lines: string[] = [];

  lines.push(`--- a/${fileName}`);
  lines.push(`+++ b/${fileName}`);

  for (const line of diff) {
    switch (line.type) {
      case "add":
        lines.push(`+ ${line.content}`);
        break;
      case "remove":
        lines.push(`- ${line.content}`);
        break;
      case "unchanged":
        lines.push(`  ${line.content}`);
        break;
    }
  }

  return lines.join("\n");
}

/**
 * Summary statistics about a diff.
 */
export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
}

/**
 * Get summary statistics for a diff.
 *
 * @param diff - The diff lines to analyze
 * @returns Statistics about the diff
 */
export function getDiffStats(diff: DiffLine[]): DiffStats {
  return diff.reduce(
    (stats, line) => {
      switch (line.type) {
        case "add":
          stats.additions++;
          break;
        case "remove":
          stats.deletions++;
          break;
        case "unchanged":
          stats.unchanged++;
          break;
      }
      return stats;
    },
    { additions: 0, deletions: 0, unchanged: 0 }
  );
}
