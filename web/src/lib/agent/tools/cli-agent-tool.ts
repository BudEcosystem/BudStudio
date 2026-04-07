/**
 * CLI Agent tool for BudAgent.
 *
 * Provides the ability to spawn a BudCode agent in various sandbox modes
 * for autonomous code analysis and modification tasks within a workspace.
 *
 * Supports:
 * - Multiple sandbox security levels (read-only, workspace-write, danger-full-access)
 * - Custom working directories
 * - Git repository validation (optional)
 * - Awaits process completion and returns the full output as the tool result
 *
 * In desktop (Tauri) builds the bundled sidecar binary is used automatically.
 * In development / non-desktop environments it falls back to `budcode` on PATH.
 */

import * as os from "os";
import * as path from "path";
import * as fsp from "fs/promises";
import type { Tool, ToolParameter } from "./base";
import { ProcessRegistry } from "./process-registry";
import { createShellEnv } from "./shell-env";

/** Backend-provided LLM credentials injected via _llm_config in tool params. */
interface LlmConfig {
  api_key: string;
  api_base: string | null;
  model: string;
}

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
 * Resolve the budcode binary path.
 *
 * In a Tauri desktop build the sidecar binary lives next to the main
 * executable with a target-triple suffix (e.g. `budcode-aarch64-apple-darwin`).
 * We detect this by looking for the Tauri resource directory layout.
 *
 * Falls back to plain `budcode` (resolved via PATH) for dev / non-desktop
 * environments.
 */
async function resolveBudcodeBinary(): Promise<string> {
  // Fastest path: the Tauri Rust side passes the exact sidecar location.
  const envBinary = process.env.BUDCODE_BINARY;
  if (envBinary) {
    try {
      await fsp.access(envBinary, fsp.constants.X_OK);
      await debugLog(`Using BUDCODE_BINARY env: ${envBinary}`);
      return envBinary;
    } catch {
      await debugLog(`BUDCODE_BINARY set but not accessible: ${envBinary}`);
    }
  }

  // Tauri sidecar: the binary sits next to the main app binary.
  // process.resourcesPath is set by Tauri's Node sidecar env; in a
  // standalone Next.js server spawned by Tauri we can detect the
  // sidecar by probing well-known paths relative to the running binary.
  const platform = process.platform;
  const arch = process.arch;

  // Map Node arch/platform to Rust target triple
  const tripleMap: Record<string, Record<string, string>> = {
    darwin: {
      arm64: "aarch64-apple-darwin",
      x64: "x86_64-apple-darwin",
    },
    win32: {
      x64: "x86_64-pc-windows-msvc",
    },
    linux: {
      x64: "x86_64-unknown-linux-gnu",
      arm64: "aarch64-unknown-linux-gnu",
    },
  };

  const triple = tripleMap[platform]?.[arch];
  const ext = platform === "win32" ? ".exe" : "";
  const sidecarName = triple ? `budcode-${triple}${ext}` : `budcode${ext}`;

  // Check common Tauri sidecar locations
  const candidateDirs: string[] = [];

  // macOS: inside the .app bundle — Contents/MacOS/
  if (platform === "darwin") {
    // When Next.js is spawned by the Tauri app the cwd or known env
    // vars can hint at the app bundle location.
    const execPath = process.env.__TAURI_INTERNALS__
      ? process.execPath
      : undefined;
    if (execPath) {
      candidateDirs.push(path.dirname(execPath));
    }
    // Also check relative to the standalone server entrypoint
    // Typical layout: Bud Studio.app/Contents/Resources/web/.next/standalone/server.js
    //                 Bud Studio.app/Contents/MacOS/budcode-<triple>
    const mainModule = require.main?.filename ?? "";
    if (mainModule.includes(".app/Contents/")) {
      const contentsIdx = mainModule.indexOf(".app/Contents/");
      const contentsDir = mainModule.substring(
        0,
        contentsIdx + ".app/Contents/".length
      );
      candidateDirs.push(path.join(contentsDir, "MacOS"));
    }
  }

  // Windows: same directory as the main .exe
  if (platform === "win32") {
    const mainModule = require.main?.filename ?? "";
    if (mainModule) {
      candidateDirs.push(path.dirname(mainModule));
    }
    // Also try next to process.execPath
    candidateDirs.push(path.dirname(process.execPath));
  }

  // Try each candidate — check both the triple-suffixed name (used during
  // development / pre-bundle) and the plain name (Tauri strips the suffix
  // when copying the sidecar into Contents/MacOS/).
  const namesToTry = [sidecarName, `budcode${ext}`];
  // Deduplicate in case they are already the same
  const uniqueNames = [...new Set(namesToTry)];

  for (const dir of candidateDirs) {
    for (const name of uniqueNames) {
      const candidate = path.join(dir, name);
      try {
        await fsp.access(candidate, fsp.constants.X_OK);
        await debugLog(`Found bundled budcode sidecar at: ${candidate}`);
        return candidate;
      } catch {
        // not found here, continue
      }
    }
  }

  // Fallback: use PATH-resolved `budcode`
  await debugLog("No bundled sidecar found, falling back to budcode on PATH");
  return "budcode";
}

/**
 * Write ~/.budcode/config.toml with the provider config from the BudAgent
 * session so that the budcode sidecar uses the same LLM credentials.
 *
 * Also returns env overrides (BUD_API_KEY) to inject into the process.
 */
async function prepareBudcodeConfig(
  llmConfig: LlmConfig
): Promise<Record<string, string>> {
  const envOverrides: Record<string, string> = {};

  // Set the API key via env var — budcode reads BUD_API_KEY.
  if (llmConfig.api_key) {
    envOverrides.BUD_API_KEY = llmConfig.api_key;
  }

  // Write a minimal config.toml so budcode knows the model + base URL.
  const budcodeDir = path.join(os.homedir(), ".bud", "budcode");
  const configPath = path.join(budcodeDir, "config.toml");

  try {
    await fsp.mkdir(budcodeDir, { recursive: true });

    const lines: string[] = [];

    if (llmConfig.model) {
      lines.push(`model = "${llmConfig.model}"`);
    }

    // If a custom base URL is set, define a model provider and select it.
    if (llmConfig.api_base) {
      lines.push(`model_provider = "bud-studio"`);
      lines.push("");
      lines.push(`[model_providers.bud-studio]`);
      lines.push(`name = "Bud Studio"`);
      lines.push(`base_url = "${llmConfig.api_base}"`);
      lines.push(`env_key = "BUD_API_KEY"`);
    }

    if (lines.length > 0) {
      await fsp.writeFile(configPath, lines.join("\n") + "\n", "utf-8");
      await debugLog(`Wrote budcode config to ${configPath}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await debugLog(`Warning: failed to write budcode config: ${msg}`);
  }

  return envOverrides;
}

/**
 * Sandbox level options for BudCode execution.
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
    `BudCode ${exitDescription}.\n\n` +
    `Full output:\n\n${output}\n\n` +
    `Please summarize what was accomplished, including any errors or unexpected outcomes. Be concise.`
  );
}

/**
 * CLI Agent tool that spawns a BudCode agent for code analysis and modifications.
 */
export class CliAgentTool implements Tool {
  /** Tool identifier */
  name = "cli_agent";

  /** Human-readable description */
  description =
    "Spawn a BudCode agent to autonomously analyze and modify code. " +
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
   * Executes the CLI agent tool by spawning a BudCode process.
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
    await debugLog(
      `CliAgentTool.execute() called with params: ${JSON.stringify(
        params
      ).substring(0, 200)}`
    );

    const prompt = params.prompt as string | undefined;
    const action = (params.action as string | undefined) || "exec";
    const workingDirectory = params.working_directory as string | undefined;
    const sandbox = params.sandbox as SandboxLevel | undefined;
    const skipGitCheck = params.skip_git_check as boolean | undefined;
    const ephemeral = params.ephemeral as boolean | undefined;
    const llmConfig = params._llm_config as LlmConfig | undefined;

    // Validate required parameter
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      await debugLog(
        "Error: Prompt parameter is required and must be a non-empty string"
      );
      throw new Error(
        "Prompt parameter is required and must be a non-empty string"
      );
    }
    await debugLog(
      `Prompt validated (action=${action}): ${prompt.substring(0, 100)}...`
    );

    // Resolve working directory
    let cwd = this.workspacePath;
    if (workingDirectory) {
      const resolvedPath = path.resolve(this.workspacePath, workingDirectory);

      if (!resolvedPath.startsWith(this.workspacePath)) {
        throw new Error(
          `Working directory is outside of the allowed workspace: ${workingDirectory}`
        );
      }

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

    // Resolve the budcode binary path (bundled sidecar or PATH fallback)
    const budcodeBin = await resolveBudcodeBinary();
    await debugLog(`Resolved budcode binary: ${budcodeBin}`);

    // Prepare budcode config and env vars from the session's LLM credentials
    let llmEnvOverrides: Record<string, string> = {};
    if (llmConfig) {
      await debugLog(
        `LLM config provided: model=${llmConfig.model}, api_base=${
          llmConfig.api_base ?? "default"
        }`
      );
      llmEnvOverrides = await prepareBudcodeConfig(llmConfig);
    }

    // Build the command based on action, passing --model from session config
    let command: string;
    if (action === "resume") {
      command = this.buildExecCommand(budcodeBin, "resume", prompt);
    } else {
      command = this.buildExecCommand(
        budcodeBin,
        "exec",
        prompt,
        sandbox,
        ephemeral,
        llmConfig?.model
      );
    }
    await debugLog(`Built command: ${command}`);

    // Spawn the process and await its completion
    const registry = ProcessRegistry.getInstance();
    const env = { ...createShellEnv(), ...llmEnvOverrides };

    // --- DEBUG: log environment details ---
    await debugLog(`PATH: ${env.PATH}`);
    await debugLog(`SHELL: ${env.SHELL}`);
    await debugLog(`HOME: ${env.HOME}`);
    await debugLog(`budcode binary: ${budcodeBin}`);
    await debugLog(`BUD_API_KEY set: ${!!env.BUD_API_KEY}`);
    // --- END DEBUG ---

    await debugLog(`Spawning process with cwd: ${cwd}, pty: true`);
    const sessionId = registry.spawn(command, cwd, { pty: true, env });
    await debugLog(
      `Process spawned with sessionId: ${sessionId}, awaiting completion...`
    );

    // Check session status immediately to detect race condition
    const sessionInfo = registry.getSession(sessionId);
    await debugLog(
      `Session ${sessionId} status right after spawn: ${sessionInfo?.status}, exitCode: ${sessionInfo?.exitCode}, outputLength: ${sessionInfo?.outputLength}`
    );

    return new Promise<string>((resolve) => {
      registry.registerOnExit(
        sessionId,
        (output: string, exitCode: number | null) => {
          debugLog(
            `Process ${sessionId} exited with code ${exitCode}, outputLength: ${output.length}`
          );
          debugLog(
            `Process ${sessionId} output (first 500 chars): ${output.substring(
              0,
              500
            )}`
          );
          resolve(formatCliCompletionMessage(output, exitCode));
        }
      );
    });
  }

  /**
   * Builds a budcode command with proper escaping and flags.
   *
   * @param binary - Resolved path to the budcode binary
   * @param action - "exec" for a new session, "resume" to continue
   * @param prompt - The task prompt or follow-up
   * @param sandbox - Sandbox level (only used for "exec")
   * @param ephemeral - Whether session is ephemeral (only used for "exec")
   * @param model - Model name from session LLM config (only used for "exec")
   * @returns The complete command string
   */
  private buildExecCommand(
    binary: string,
    action: "exec" | "resume",
    prompt: string,
    sandbox?: SandboxLevel,
    ephemeral?: boolean,
    model?: string
  ): string {
    const escapedBin = this.escapeShellArg(binary);
    const escapedPrompt = this.escapeShellArg(prompt);

    if (action === "resume") {
      return `${escapedBin} resume --last ${escapedPrompt}`;
    }

    let command = `${escapedBin} exec`;

    // Skip git repo check since we might be in temp directories
    command += " --skip-git-repo-check";

    // Auto-approve all actions — the tool runs non-interactively.
    command += " --dangerously-bypass-approvals-and-sandbox";

    // Pass the model from the session's LLM config
    if (model) {
      command += ` --model ${this.escapeShellArg(model)}`;
    }

    // Add sandbox flag (validate it's a known value)
    const sandboxLevel = sandbox || "workspace-write";
    const validSandboxLevels = [
      "read-only",
      "workspace-write",
      "danger-full-access",
    ];
    if (!validSandboxLevels.includes(sandboxLevel)) {
      throw new Error(`Invalid sandbox level: ${sandboxLevel}`);
    }
    const escapedSandbox = this.escapeShellArg(sandboxLevel);
    command += ` -s ${escapedSandbox}`;

    // Add prompt (with proper shell escaping)
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
