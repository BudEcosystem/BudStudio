/**
 * Bash tool for BudAgent.
 *
 * Provides the ability to execute shell commands in a workspace directory
 * with safety checks to prevent dangerous operations.
 */

import { spawn } from "child_process";
import type { Tool, ToolParameter } from "./base";

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
  /curl.*\|\s*(ba)?sh/, // Piping curl to shell
  /wget.*\|\s*(ba)?sh/, // Piping wget to shell
];

/** Default timeout in seconds */
const DEFAULT_TIMEOUT_SECONDS = 120;

/** Maximum allowed timeout in seconds */
const MAX_TIMEOUT_SECONDS = 300;

/** Maximum output length before truncation */
const MAX_OUTPUT_LENGTH = 50000;

/**
 * Parameters for the bash tool execute function.
 */
interface BashToolParams {
  /** The shell command to execute */
  command: string;
  /** Timeout in seconds (default: 120, max: 300) */
  timeout?: number;
}

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
 * Creates a sanitized environment for command execution.
 * Removes potentially dangerous environment variables.
 *
 * @returns A sanitized copy of process.env
 */
function createSanitizedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Clear potentially dangerous env vars
    SUDO_ASKPASS: "",
  };
}

/**
 * Bash tool that executes shell commands in a workspace directory.
 *
 * This tool provides a safe way for the agent to execute shell commands
 * by validating commands against a blocklist of dangerous patterns and
 * providing proper timeout and output handling.
 *
 * @example
 * ```typescript
 * const bashTool = new BashTool('/path/to/workspace');
 *
 * // List files
 * const result = await bashTool.execute({ command: 'ls -la' });
 *
 * // Run with custom timeout
 * const result = await bashTool.execute({
 *   command: 'npm install',
 *   timeout: 180
 * });
 * ```
 */
export class BashTool implements Tool {
  /** Tool identifier */
  name = "bash";

  /** Human-readable description */
  description = "Execute a shell command in the workspace directory";

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
      description: "Timeout in seconds (default: 120, max: 300)",
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
   * The command is validated against a blocklist of dangerous patterns before execution.
   * Output is captured from both stdout and stderr, and truncated if too long.
   *
   * @param params - The execution parameters
   * @param params.command - The shell command to execute
   * @param params.timeout - Optional timeout in seconds (default: 120, max: 300)
   * @returns A promise that resolves to the command output
   * @throws Error if the command is blocked for safety reasons
   * @throws Error if the command fails to spawn
   */
  async execute(params: Record<string, unknown>): Promise<string> {
    const command = params.command as string | undefined;
    const timeout = (params.timeout as number | undefined) ?? DEFAULT_TIMEOUT_SECONDS;

    // Validate required parameter
    if (!command || typeof command !== "string") {
      throw new Error("Command parameter is required and must be a string");
    }

    // Validate against blocked patterns
    validateCommand(command);

    // Calculate actual timeout (capped at max)
    const timeoutValue = typeof timeout === "number" ? timeout : DEFAULT_TIMEOUT_SECONDS;
    const actualTimeoutMs = Math.min(timeoutValue, MAX_TIMEOUT_SECONDS) * 1000;

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const proc = spawn("bash", ["-c", command], {
        cwd: this.workspacePath,
        timeout: actualTimeoutMs,
        env: createSanitizedEnv(),
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

        // Truncate if necessary
        output = truncateOutput(output);

        // Return "(No output)" if empty
        resolve(output || "(No output)");
      });

      proc.on("error", (error: Error) => {
        reject(new Error(`Failed to execute command: ${error.message}`));
      });
    });
  }
}
