import * as fs from "fs/promises";
import * as path from "path";

/**
 * Workspace context files interface
 * Contains the contents of standard context files loaded from a workspace
 */
export interface WorkspaceContextFiles {
  /** SOUL.md content - Agent identity and behavioral guidelines */
  soul?: string;
  /** USER.md content - User profile and preferences */
  user?: string;
  /** MEMORY.md content - Header only (first 50 lines or until second ## header) */
  memory?: string;
  /** AGENTS.md content - Agent configurations */
  agents?: string;
}

/**
 * Context file names
 */
const CONTEXT_FILES = {
  SOUL: "SOUL.md",
  USER: "USER.md",
  MEMORY: "MEMORY.md",
  AGENTS: "AGENTS.md",
} as const;

/**
 * Memory subdirectory name
 */
const MEMORY_DIR = "memory";

/**
 * Default content for SOUL.md
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
 * Default content for USER.md
 */
const DEFAULT_USER_CONTENT = `# User Profile

## Identity
- Name: [Your name]
- Preferred name: [How you'd like to be addressed]

## Preferences
- Timezone: [Your timezone]
- Working hours: [Your typical working hours]
- Preferred language: English

## Technical Context
- Primary stack: [Your main technologies]
- Editor: [Your preferred editor]
- OS: [Your operating system]

## Communication Preferences
- [Add your preferences here]
`;

/**
 * Default content for MEMORY.md
 */
const DEFAULT_MEMORY_CONTENT = `# Agent Memory

## Overview
This file contains persistent memories and learned information.
Use memory_search to find specific memories.

## Key Information
- [Important facts will be stored here]

## Decisions
- [Key decisions and their rationale]

## Preferences Learned
- [User preferences discovered during conversations]
`;

/**
 * Default content for AGENTS.md
 */
const DEFAULT_AGENTS_CONTENT = `# Agent Configurations

## Default Agent
The primary agent used for general tasks.

## Specialized Agents
Define custom agent configurations here for specific use cases.
`;

/**
 * Extracts the header portion of MEMORY.md content
 * Returns the first 50 lines or content until the second ## header, whichever is shorter
 *
 * @param content - Full MEMORY.md content
 * @returns Header portion of the content
 */
export function extractMemoryHeader(content: string): string {
  const lines = content.split("\n");
  const maxLines = 50;

  let headerEndIndex = lines.length;
  let foundFirstHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check for ## header (not # header which is the title)
    if (line.startsWith("## ")) {
      if (foundFirstHeader) {
        // Found second ## header, stop here
        headerEndIndex = i;
        break;
      }
      foundFirstHeader = true;
    }
  }

  // Take the minimum of maxLines and headerEndIndex
  const endIndex = Math.min(maxLines, headerEndIndex);
  return lines.slice(0, endIndex).join("\n");
}

/**
 * Safely reads a file, returning undefined if the file doesn't exist
 *
 * @param filePath - Path to the file to read
 * @returns File content or undefined if file doesn't exist
 */
async function safeReadFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content;
  } catch (error) {
    // Return undefined for file not found errors
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Checks if a file exists
 *
 * @param filePath - Path to check
 * @returns True if file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads workspace context files from a given workspace path
 *
 * @param workspacePath - Path to the workspace directory
 * @returns WorkspaceContextFiles with contents of each file (undefined for missing files)
 */
export async function loadWorkspaceContextFiles(
  workspacePath: string
): Promise<WorkspaceContextFiles> {
  const soulPath = path.join(workspacePath, CONTEXT_FILES.SOUL);
  const userPath = path.join(workspacePath, CONTEXT_FILES.USER);
  const memoryPath = path.join(workspacePath, CONTEXT_FILES.MEMORY);
  const agentsPath = path.join(workspacePath, CONTEXT_FILES.AGENTS);

  // Load all files in parallel
  const [soul, user, memoryFull, agents] = await Promise.all([
    safeReadFile(soulPath),
    safeReadFile(userPath),
    safeReadFile(memoryPath),
    safeReadFile(agentsPath),
  ]);

  // Extract only the header from MEMORY.md
  const memory = memoryFull ? extractMemoryHeader(memoryFull) : undefined;

  return {
    soul,
    user,
    memory,
    agents,
  };
}

/**
 * Initializes workspace context files with default content if they don't exist
 * Creates the memory/ subdirectory for storing memory chunks
 * Does NOT overwrite existing files
 *
 * @param workspacePath - Path to the workspace directory
 */
export async function initializeWorkspaceContextFiles(
  workspacePath: string
): Promise<void> {
  const soulPath = path.join(workspacePath, CONTEXT_FILES.SOUL);
  const userPath = path.join(workspacePath, CONTEXT_FILES.USER);
  const memoryPath = path.join(workspacePath, CONTEXT_FILES.MEMORY);
  const agentsPath = path.join(workspacePath, CONTEXT_FILES.AGENTS);
  const memoryDir = path.join(workspacePath, MEMORY_DIR);

  // Check which files already exist
  const [soulExists, userExists, memoryExists, agentsExists, memoryDirExists] =
    await Promise.all([
      fileExists(soulPath),
      fileExists(userPath),
      fileExists(memoryPath),
      fileExists(agentsPath),
      fileExists(memoryDir),
    ]);

  // Create files that don't exist
  const writeOperations: Promise<void>[] = [];

  if (!soulExists) {
    writeOperations.push(fs.writeFile(soulPath, DEFAULT_SOUL_CONTENT, "utf-8"));
  }

  if (!userExists) {
    writeOperations.push(fs.writeFile(userPath, DEFAULT_USER_CONTENT, "utf-8"));
  }

  if (!memoryExists) {
    writeOperations.push(
      fs.writeFile(memoryPath, DEFAULT_MEMORY_CONTENT, "utf-8")
    );
  }

  if (!agentsExists) {
    writeOperations.push(
      fs.writeFile(agentsPath, DEFAULT_AGENTS_CONTENT, "utf-8")
    );
  }

  // Create memory subdirectory if it doesn't exist
  if (!memoryDirExists) {
    writeOperations.push(
      fs.mkdir(memoryDir, { recursive: true }).then(() => undefined)
    );
  }

  // Execute all write operations in parallel
  await Promise.all(writeOperations);
}

/**
 * Gets the full path to a context file in a workspace
 *
 * @param workspacePath - Path to the workspace directory
 * @param fileType - Type of context file
 * @returns Full path to the context file
 */
export function getContextFilePath(
  workspacePath: string,
  fileType: keyof typeof CONTEXT_FILES
): string {
  return path.join(workspacePath, CONTEXT_FILES[fileType]);
}

/**
 * Gets the path to the memory subdirectory in a workspace
 *
 * @param workspacePath - Path to the workspace directory
 * @returns Full path to the memory subdirectory
 */
export function getMemoryDirPath(workspacePath: string): string {
  return path.join(workspacePath, MEMORY_DIR);
}
