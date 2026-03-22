/**
 * CLI Agent tool for BudAgent.
 *
 * Provides the ability to spawn a Codex agent in various sandbox modes
 * for autonomous code analysis and modification tasks within a workspace.
 *
 * Supports:
 * - Multiple sandbox security levels (read-only, workspace-write, danger-full-access)
 * - Custom working directories
 * - Optional session completion callbacks
 * - Git repository validation (optional)
 * - Background execution with session IDs
 */

import * as fs from "fs";
import type { Tool, ToolParameter } from "./base";
import { ProcessRegistry } from "./process-registry";
import { createShellEnv } from "./shell-env";

/**
 * Sandbox level options for Codex execution.
 */
export type SandboxLevel =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

/**
 * CLI Agent tool that spawns a Codex agent for code analysis and modifications.
 */
export class CliAgentTool implements Tool {
  /** Tool identifier */
  name = "cli_agent";

  /** Human-readable description */
  description =
    "Spawn a Codex agent to autonomously analyze and modify code. " +
    "Supports multiple sandbox levels for security control. " +
    "Returns a session ID for tracking progress via the process tool.";

  /** Tool parameters definition */
  parameters: ToolParameter[] = [
    {
      name: "prompt",
      type: "string",
      description:
        "The task prompt for the agent. Should clearly describe what analysis or modifications are needed.",
      required: true,
    },
    {
      name: "working_directory",
      type: "string",
      description:
        "The working directory for the agent. Must exist. Defaults to workspace root.",
      required: false,
    },
    {
      name: "sandbox",
      type: "string",
      description:
        'Sandbox security level: "read-only" (file read only), "workspace-write" (can write to workspace, default), "danger-full-access" (unrestricted).',
      enum: ["read-only", "workspace-write", "danger-full-access"],
      required: false,
    },
    {
      name: "skip_git_check",
      type: "boolean",
      description:
        "Skip validation that working directory is a git repository. Defaults to false.",
      required: false,
    },
    {
      name: "ephemeral",
      type: "boolean",
      description:
        "Whether the session is ephemeral (cleaned up automatically). Defaults to true.",
      required: false,
    },
  ];

  /** This tool requires user approval before execution */
  requiresApproval = true;

  /** The workspace directory for resolving relative paths */
  private workspacePath: string;

  /** Optional callback invoked when the Codex session completes */
  private onSessionComplete?: (sessionId: string, output: string, exitCode: number | null) => void;

  /**
   * Creates a new CliAgentTool instance.
   *
   * @param workspacePath - The path to the workspace directory
   * @param onSessionComplete - Optional callback when session completes
   */
  constructor(
    workspacePath: string,
    onSessionComplete?: (sessionId: string, output: string, exitCode: number | null) => void
  ) {
    this.workspacePath = workspacePath;
    this.onSessionComplete = onSessionComplete;
  }

  /**
   * Executes the CLI agent tool by spawning a Codex process.
   *
   * @param params - The execution parameters
   * @returns A promise that resolves to a session ID and status message
   */
  async execute(params: Record<string, unknown>): Promise<string> {
    const prompt = params.prompt as string | undefined;
    const workingDirectory = params.working_directory as string | undefined;
    const sandbox = params.sandbox as SandboxLevel | undefined;
    const skipGitCheck = params.skip_git_check as boolean | undefined;
    const ephemeral = params.ephemeral as boolean | undefined;

    // Validate required parameter
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      throw new Error("Prompt parameter is required and must be a non-empty string");
    }

    // Resolve working directory
    let cwd = this.workspacePath;
    if (workingDirectory) {
      const resolvedPath = workingDirectory.startsWith("/")
        ? workingDirectory
        : `${this.workspacePath}/${workingDirectory}`;

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Working directory does not exist: ${resolvedPath}`);
      }

      cwd = resolvedPath;
    }

    // Validate git repository (unless skipped)
    if (!skipGitCheck) {
      if (!fs.existsSync(`${cwd}/.git`)) {
        throw new Error(
          `Working directory is not a git repository: ${cwd}. ` +
            "Use skip_git_check=true to disable this check."
        );
      }
    }

    // Build the Codex command
    const command = this.buildCodexCommand(prompt, sandbox, ephemeral);

    // Spawn the process
    const registry = ProcessRegistry.getInstance();
    const env = createShellEnv();
    const sessionId = registry.spawn(command, cwd, { pty: true, env });

    // Register callback if provided
    if (this.onSessionComplete) {
      registry.registerOnExit(
        sessionId,
        (output: string, exitCode: number | null) => {
          this.onSessionComplete!(sessionId, output, exitCode);
        }
      );
    }

    const sandboxLevel = sandbox || "workspace-write";
    return (
      `CLI agent started in session ${sessionId}\n` +
      `Working directory: ${cwd}\n` +
      `Sandbox level: ${sandboxLevel}\n` +
      `Status: Running in background — I will automatically follow up when complete.\n` +
      `You can also use the process tool (action: log, poll, list) to check status.`
    );
  }

  /**
   * Builds the Codex command with proper escaping and flags.
   *
   * @param prompt - The task prompt
   * @param sandbox - Sandbox level
   * @param ephemeral - Whether session is ephemeral
   * @returns The complete command string
   */
  private buildCodexCommand(
    prompt: string,
    sandbox: SandboxLevel | undefined,
    ephemeral: boolean | undefined
  ): string {
    let command = "codex exec";

    // Add sandbox flag (validate it's a known value)
    const sandboxLevel = sandbox || "workspace-write";
    const validSandboxLevels = ["read-only", "workspace-write", "danger-full-access"];
    if (!validSandboxLevels.includes(sandboxLevel)) {
      throw new Error(`Invalid sandbox level: ${sandboxLevel}`);
    }
    const escapedSandbox = this.escapeShellArg(sandboxLevel);
    command += ` -s ${escapedSandbox}`;

    // Add prompt (with proper shell escaping)
    const escapedPrompt = this.escapeShellArg(prompt);
    command += ` ${escapedPrompt}`;

    return command;
  }

  /**
   * Escapes a string for safe use in a shell command.
   * Uses single quotes to prevent any shell interpretation.
   *
   * @param arg - The argument to escape
   * @returns The escaped argument
   */
  private escapeShellArg(arg: string): string {
    // Single-quote the arg and escape any single quotes inside it
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
