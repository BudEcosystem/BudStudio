/**
 * Bash tool for BudAgent.
 *
 * Provides the ability to execute shell commands in a workspace directory
 * with safety checks to prevent dangerous operations.
 *
 * Supports:
 * - Login shell PATH resolution (nvm, pyenv, cargo, etc.)
 * - Background mode (returns session ID immediately)
 * - Wait mode (race: finish fast or auto-background)
 * - PTY mode (pseudo-terminal for TTY-requiring commands)
 * - Increased timeouts (up to 600s)
 */

import { spawn } from "child_process";
import type { Tool, ToolParameter } from "./base";
import { createShellEnv } from "./shell-env";
import { ProcessRegistry } from "./process-registry";
import { spawnPty, isPtyAvailable } from "./pty-spawn";
import { stripAnsi } from "./strip-ansi";

/**
 * Patterns that are blocked for safety reasons.
 * Commands matching any of these patterns will be rejected.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//, // rm -rf /
  /rm\s+-rf\s+~/, // rm -rf ~
  /rm\s+-rf\s+\.\./, // rm -rf ..
  /mkfs/, // filesystem format
  /dd\s+if=/, // disk dump
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, // Fork bomb variations
  />\s*\/dev\/sd/, // Direct disk write
  /chmod\s+-R\s+777\s+\//, // Dangerous permissions
];

/** Default timeout in seconds */
const DEFAULT_TIMEOUT_SECONDS = 120;

/** Maximum allowed timeout in seconds */
const MAX_TIMEOUT_SECONDS = 600;

/** Maximum output length before truncation */
const MAX_OUTPUT_LENGTH = 50000;

/**
 * Validates a command against blocked patterns.
 *
 * @param command - The command to validate
 * @throws Error if the command matches a blocked pattern
 */
function validateCommand(command: string): void {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error("Command blocked for safety reasons");
    }
  }
}

/**
 * Truncates output if it exceeds the maximum length.
 *
 * @param output - The output string to potentially truncate
 * @returns The output, truncated if necessary
 */
function truncateOutput(output: string): string {
  if (output.length > MAX_OUTPUT_LENGTH) {
    return output.slice(0, MAX_OUTPUT_LENGTH) + "\n\n[Output truncated]";
  }
  return output;
}


/**
 * Bash tool that executes shell commands in a workspace directory.
 *
 * Supports background execution, wait-with-timeout, PTY mode, and
 * login shell PATH resolution.
 */
export class BashTool implements Tool {
  /** Tool identifier */
  name = "bash";

  /** Human-readable description */
  description =
    "Execute a shell command in the workspace directory. " +
    "Supports background mode (returns session ID for long-running commands), " +
    "wait mode (auto-background if command doesn't finish in time), " +
    "and pty mode (for commands needing a real terminal).";

  /** Tool parameters definition */
  parameters: ToolParameter[] = [
    {
      name: "command",
      type: "string",
      description: "The shell command to execute",
    },
    {
      name: "timeout",
      type: "number",
      description: "Timeout in seconds (default: 120, max: 600)",
      required: false,
    },
    {
      name: "background",
      type: "boolean",
      description:
        "Run in background and return a session ID immediately. " +
        "Use the process tool to poll output, interact, or kill.",
      required: false,
    },
    {
      name: "wait",
      type: "number",
      description:
        "Wait up to this many milliseconds for the command to finish. " +
        "If it finishes in time, return output normally. " +
        "If not, auto-background and return a session ID.",
      required: false,
    },
    {
      name: "pty",
      type: "boolean",
      description:
        "Run in a pseudo-terminal (PTY). Use for commands that need " +
        "TTY detection, colored output, or interactive prompts. " +
        "Can be combined with background.",
      required: false,
    },
  ];

  /** This tool requires user approval before execution */
  requiresApproval = true;

  /** The workspace directory where commands will be executed */
  private workspacePath: string;

  /**
   * Creates a new BashTool instance.
   *
   * @param workspacePath - The path to the workspace directory where commands will be executed
   */
  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Executes a shell command in the workspace directory.
   *
   * @param params - The execution parameters
   * @returns A promise that resolves to the command output or session ID
   */
  async execute(params: Record<string, unknown>): Promise<string> {
    const command = params.command as string | undefined;
    const timeout = params.timeout as number | undefined;
    const background = params.background as boolean | undefined;
    const wait = params.wait as number | undefined;
    const pty = params.pty as boolean | undefined;

    // Validate required parameter
    if (!command || typeof command !== "string") {
      throw new Error("Command parameter is required and must be a string");
    }

    // Validate against blocked patterns
    validateCommand(command);

    const registry = ProcessRegistry.getInstance();
    const env = createShellEnv();

    // --- Background mode ---
    if (background) {
      const sessionId = registry.spawn(command, this.workspacePath, { pty, env });
      return `Background session started: ${sessionId}\nUse the process tool to poll output, interact, or kill.`;
    }

    // --- Wait mode (race) ---
    if (wait && typeof wait === "number" && wait > 0) {
      return this.executeWithWait(command, wait, env, pty);
    }

    // --- PTY foreground mode ---
    if (pty) {
      return this.executePtyForeground(command, timeout, env);
    }

    // --- Default synchronous mode ---
    return this.executeSynchronous(command, timeout, env);
  }

  /**
   * Wait mode: race between command completion and timeout.
   * If the command finishes within waitMs, return output normally.
   * If not, auto-background and return session ID.
   */
  private async executeWithWait(
    command: string,
    waitMs: number,
    env: NodeJS.ProcessEnv,
    pty?: boolean
  ): Promise<string> {
    const registry = ProcessRegistry.getInstance();
    const sessionId = registry.spawn(command, this.workspacePath, { pty, env });

    // Poll with the wait timeout
    const result = await registry.poll(sessionId, waitMs);

    if (result.status !== "running") {
      // Command finished within the wait period
      const logResult = registry.getLog(sessionId);
      let output = logResult.output;

      if (result.exitCode !== null && result.exitCode !== 0) {
        output += `\n\nExit code: ${result.exitCode}`;
      }

      output = truncateOutput(stripAnsi(output));

      // Clean up the session since we consumed its output synchronously
      try { registry.remove(sessionId); } catch { /* ignore */ }

      return output || "(No output)";
    }

    // Command still running — return session ID
    let partialOutput = stripAnsi(result.output);

    let response = `Command still running. Session: ${sessionId}\n`;
    response += "Use the process tool to poll output, interact, or kill.\n";
    if (partialOutput) {
      response += `\nPartial output so far:\n${truncateOutput(partialOutput)}`;
    }
    return response;
  }

  /**
   * PTY foreground mode: run in a pseudo-terminal and wait for completion.
   */
  private executePtyForeground(
    command: string,
    timeout: number | undefined,
    env: NodeJS.ProcessEnv
  ): Promise<string> {
    const timeoutValue = typeof timeout === "number" ? timeout : DEFAULT_TIMEOUT_SECONDS;
    const actualTimeoutMs = Math.min(timeoutValue, MAX_TIMEOUT_SECONDS) * 1000;

    // Check if PTY is available
    if (!isPtyAvailable()) {
      // Fall back to regular spawn with a warning prefix
      return this.executeSynchronous(command, timeout, env).then(
        (output) => `[Warning: node-pty not available, using regular spawn]\n${output}`
      );
    }

    return new Promise((resolve) => {
      let output = "";
      let killed = false;
      let timeoutHandle: ReturnType<typeof setTimeout>;

      const handle = spawnPty(command, {
        cwd: this.workspacePath,
        env,
      });

      if (!handle) {
        // Should not happen since we checked isPtyAvailable, but be safe
        resolve("[Warning: PTY spawn failed, use regular bash mode]");
        return;
      }

      timeoutHandle = setTimeout(() => {
        if (!killed) {
          killed = true;
          handle.kill("SIGKILL");
          output += "\n\n[Command timed out]";
        }
      }, actualTimeoutMs);

      handle.onData((data: string) => {
        output += data;
        if (output.length > MAX_OUTPUT_LENGTH && !killed) {
          killed = true;
          handle.kill("SIGKILL");
        }
      });

      handle.onExit(({ exitCode }) => {
        clearTimeout(timeoutHandle);

        let result = stripAnsi(output);

        if (exitCode !== null && exitCode !== 0) {
          result += `\n\nExit code: ${exitCode}`;
        }

        result = truncateOutput(result);
        handle.dispose();
        resolve(result || "(No output)");
      });
    });
  }

  /**
   * Default synchronous execution with login shell env.
   */
  private executeSynchronous(
    command: string,
    timeout: number | undefined,
    env: NodeJS.ProcessEnv
  ): Promise<string> {
    const timeoutValue = typeof timeout === "number" ? timeout : DEFAULT_TIMEOUT_SECONDS;
    const actualTimeoutMs = Math.min(timeoutValue, MAX_TIMEOUT_SECONDS) * 1000;

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const proc = spawn("bash", ["-c", command], {
        cwd: this.workspacePath,
        timeout: actualTimeoutMs,
        env,
      });

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        // Kill process if output is too large
        if (stdout.length > MAX_OUTPUT_LENGTH && !killed) {
          killed = true;
          proc.kill();
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code: number | null) => {
        let output = stdout;

        // Append stderr if present
        if (stderr) {
          output += `\n\nSTDERR:\n${stderr}`;
        }

        // Append exit code if non-zero
        if (code !== null && code !== 0) {
          output += `\n\nExit code: ${code}`;
        }

        // Strip ANSI escape sequences and truncate
        output = truncateOutput(stripAnsi(output));

        // Return "(No output)" if empty
        resolve(output || "(No output)");
      });

      proc.on("error", (error: Error) => {
        reject(new Error(`Failed to execute command: ${error.message}`));
      });
    });
  }
}
