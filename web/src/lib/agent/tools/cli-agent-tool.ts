/**
 * CLI Agent tool for BudAgent.
 *
 * Provides the ability to spawn a Codex agent in various sandbox modes
 * for autonomous code analysis and modification tasks within a workspace.
 *
 * Supports:
 * - Multiple sandbox security levels (read-only, workspace-write, danger-full-access)
 * - Custom working directories
 * - Git repository validation (optional)
 * - Awaits process completion and returns the full output as the tool result
 */

import * as fsp from "fs/promises";
import { execFile } from "child_process";
import type { Tool, ToolParameter } from "./base";
import { ProcessRegistry } from "./process-registry";
import { createShellEnv } from "./shell-env";

// Debug logging
async function debugLog(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [cli-agent] ${message}\n`;
  try {
    await fsp.appendFile("/tmp/bud-agent-debug.log", logLine);
  } catch {
    // Ignore file write errors
  }
}

/**
 * Sandbox level options for Codex execution.
 */
export type SandboxLevel =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

/**
 * Format the completion message from a CLI agent process exit.
 * Interprets exit codes and structures the output for the LLM.
 */
export function formatCliCompletionMessage(
  output: string,
  exitCode: number | null
): string {
  let exitDescription: string;
  if (exitCode === null) {
    exitDescription = "completed (exit status unknown)";
  } else if (exitCode === 0) {
    exitDescription = "completed successfully";
  } else if (exitCode === 137 || exitCode === 143) {
    exitDescription = "was terminated";
  } else {
    exitDescription = `failed with exit code ${exitCode}`;
  }

  return (
    `Codex ${exitDescription}.\n\n` +
    `Full output:\n\n${output}\n\n` +
    `Please summarize what was accomplished, including any errors or unexpected outcomes. Be concise.`
  );
}

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
    "Awaits completion and returns the full output.";

  /** Tool parameters definition */
  parameters: ToolParameter[] = [
    {
      name: "prompt",
      type: "string",
      description:
        "The task prompt for the agent. For 'exec': describes the task. For 'resume': provides the user's answer or follow-up instruction.",
      required: true,
    },
    {
      name: "action",
      type: "string",
      description:
        'Action mode: "exec" (default) starts a new session, "resume" continues the most recent session with a follow-up prompt (e.g., user\'s answer to a question the agent asked).',
      enum: ["exec", "resume"],
      required: false,
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

  /**
   * Creates a new CliAgentTool instance.
   *
   * @param workspacePath - The path to the workspace directory
   */
  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Executes the CLI agent tool by spawning a Codex process.
   *
   * The returned Promise resolves only when the process exits, delivering
   * the full output as the tool result. This lets the gateway's generic
   * `await tool.execute()` → `sendToolResult()` flow work without any
   * special-casing — identical to how `bash` and other tools behave.
   *
   * @param params - The execution parameters
   * @returns A promise that resolves to the formatted completion message
   */
  async execute(params: Record<string, unknown>): Promise<string> {
    await debugLog(`CliAgentTool.execute() called with params: ${JSON.stringify(params).substring(0, 200)}`);

    const prompt = params.prompt as string | undefined;
    const action = (params.action as string | undefined) || "exec";
    const workingDirectory = params.working_directory as string | undefined;
    const sandbox = params.sandbox as SandboxLevel | undefined;
    const skipGitCheck = params.skip_git_check as boolean | undefined;
    const ephemeral = params.ephemeral as boolean | undefined;

    // Validate required parameter
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      await debugLog("Error: Prompt parameter is required and must be a non-empty string");
      throw new Error("Prompt parameter is required and must be a non-empty string");
    }
    await debugLog(`Prompt validated (action=${action}): ${prompt.substring(0, 100)}...`);

    // Resolve working directory
    let cwd = this.workspacePath;
    if (workingDirectory) {
      const resolvedPath = workingDirectory.startsWith("/")
        ? workingDirectory
        : `${this.workspacePath}/${workingDirectory}`;

      try {
        await fsp.access(resolvedPath);
      } catch {
        throw new Error(`Working directory does not exist: ${resolvedPath}`);
      }

      cwd = resolvedPath;
    }

    // Validate git repository (unless skipped) — only for exec, resume uses existing session
    if (action === "exec" && !skipGitCheck) {
      try {
        await fsp.access(`${cwd}/.git`);
      } catch {
        throw new Error(
          `Working directory is not a git repository: ${cwd}. ` +
            "Use skip_git_check=true to disable this check."
        );
      }
    }

    // Build the Codex command based on action
    let command: string;
    if (action === "resume") {
      command = this.buildResumeCommand(prompt);
    } else {
      command = this.buildCodexCommand(prompt, sandbox, ephemeral);
    }
    await debugLog(`Built command: ${command}`);

    // Spawn the process and await its completion
    const registry = ProcessRegistry.getInstance();
    const env = createShellEnv();

    // --- DEBUG: log environment details ---
    await debugLog(`PATH: ${env.PATH}`);
    await debugLog(`SHELL: ${env.SHELL}`);
    await debugLog(`HOME: ${env.HOME}`);
    try {
      const whichResult = await new Promise<string>((resolve, reject) => {
        execFile("/usr/bin/which", ["codex"], { env, encoding: "utf-8", timeout: 5000 },
          (err, stdout) => {
            if (err) reject(err);
            else resolve((stdout as string).trim());
          });
      });
      await debugLog(`which codex: ${whichResult}`);
    } catch (whichErr: unknown) {
      const msg = whichErr instanceof Error ? whichErr.message : String(whichErr);
      await debugLog(`which codex FAILED: ${msg}`);
    }
    // --- END DEBUG ---

    await debugLog(`Spawning process with cwd: ${cwd}, pty: true`);
    const sessionId = registry.spawn(command, cwd, { pty: true, env });
    await debugLog(`Process spawned with sessionId: ${sessionId}, awaiting completion...`);

    // Check session status immediately to detect race condition
    const sessionInfo = registry.getSession(sessionId);
    await debugLog(`Session ${sessionId} status right after spawn: ${sessionInfo?.status}, exitCode: ${sessionInfo?.exitCode}, outputLength: ${sessionInfo?.outputLength}`);

    return new Promise<string>((resolve) => {
      registry.registerOnExit(
        sessionId,
        (output: string, exitCode: number | null) => {
          debugLog(`Process ${sessionId} exited with code ${exitCode}, outputLength: ${output.length}`);
          debugLog(`Process ${sessionId} output (first 500 chars): ${output.substring(0, 500)}`);
          resolve(formatCliCompletionMessage(output, exitCode));
        }
      );
    });
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

    // Skip git repo check since we might be in temp directories
    command += " --skip-git-repo-check";

    // Auto-approve all actions — the tool runs non-interactively.
    command += " --dangerously-bypass-approvals-and-sandbox";

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
   * Builds a Codex resume command to continue the most recent session.
   *
   * @param prompt - The follow-up prompt (e.g., user's answer)
   * @returns The complete command string
   */
  private buildResumeCommand(prompt: string): string {
    const escapedPrompt = this.escapeShellArg(prompt);
    return `codex resume --last ${escapedPrompt}`;
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
