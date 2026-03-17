/**
 * Process tool for BudAgent.
 *
 * Provides process management actions: list, poll, log, write, send_keys, kill, remove.
 * Works with sessions spawned by the bash tool's background mode.
 *
 * Does NOT require approval — the bash command that created the session
 * already went through the approval flow.
 */

import type { Tool, ToolParameter } from "./base";
import { ProcessRegistry } from "./process-registry";
import { stripAnsi } from "./strip-ansi";

/**
 * Process management tool that interacts with background process sessions.
 */
export class ProcessTool implements Tool {
  name = "process";

  description =
    "Manage background processes spawned by the bash tool. " +
    "Actions: list (show all sessions), poll (get new output), log (full output), " +
    "write (send stdin input), send_keys (send signals like ctrl+c), " +
    "kill (terminate process), remove (clean up finished session).";

  parameters: ToolParameter[] = [
    {
      name: "action",
      type: "string",
      description:
        "The action to perform: list, poll, log, write, send_keys, kill, remove",
      enum: ["list", "poll", "log", "write", "send_keys", "kill", "remove"],
    },
    {
      name: "session_id",
      type: "string",
      description:
        "The session ID (required for all actions except list)",
      required: false,
    },
    {
      name: "timeout_ms",
      type: "number",
      description:
        "For poll action: maximum time to wait for new output in ms (default: 5000)",
      required: false,
    },
    {
      name: "offset",
      type: "number",
      description:
        "For log action: character offset to start reading from (default: 0)",
      required: false,
    },
    {
      name: "limit",
      type: "number",
      description:
        "For log action: maximum characters to return",
      required: false,
    },
    {
      name: "input",
      type: "string",
      description:
        "For write action: data to write to process stdin",
      required: false,
    },
    {
      name: "keys",
      type: "string",
      description:
        "For send_keys action: signal or key combo to send (e.g. 'ctrl+c', 'ctrl+d', 'SIGTERM', 'SIGKILL')",
      required: false,
    },
  ];

  /** Process tool does not require approval. */
  requiresApproval = false;

  async execute(params: Record<string, unknown>): Promise<string> {
    const action = params.action as string | undefined;
    if (!action) {
      return "Error: action parameter is required";
    }

    const registry = ProcessRegistry.getInstance();

    try {
      switch (action) {
        case "list":
          return this.handleList(registry);

        case "poll":
          return await this.handlePoll(registry, params);

        case "log":
          return this.handleLog(registry, params);

        case "write":
          return this.handleWrite(registry, params);

        case "send_keys":
          return this.handleSendKeys(registry, params);

        case "kill":
          return this.handleKill(registry, params);

        case "remove":
          return this.handleRemove(registry, params);

        default:
          return `Error: unknown action '${action}'. Valid actions: list, poll, log, write, send_keys, kill, remove`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: ${msg}`;
    }
  }

  private handleList(registry: ProcessRegistry): string {
    const sessions = registry.list();

    if (sessions.length === 0) {
      return "No active or recent process sessions.";
    }

    const lines = sessions.map((s) => {
      const duration = s.durationMs < 1000
        ? `${s.durationMs}ms`
        : `${(s.durationMs / 1000).toFixed(1)}s`;

      const status = s.status === "running"
        ? "RUNNING"
        : s.status === "killed"
          ? `KILLED`
          : `EXIT ${s.exitCode}`;

      const ptyTag = s.isPty ? " [pty]" : "";

      return `${s.sessionId}: ${status}${ptyTag} (${duration}) — ${s.command.slice(0, 80)}`;
    });

    return lines.join("\n");
  }

  private async handlePoll(
    registry: ProcessRegistry,
    params: Record<string, unknown>
  ): Promise<string> {
    const sessionId = params.session_id as string | undefined;
    if (!sessionId) {
      return "Error: session_id is required for poll action";
    }

    const timeoutMs = (params.timeout_ms as number | undefined) ?? 5000;
    const result = await registry.poll(sessionId, timeoutMs);

    let output = stripAnsi(result.output) || "(no new output)";

    if (result.status !== "running") {
      output += `\n\n[Process ${result.status}${result.exitCode !== null ? `, exit code: ${result.exitCode}` : ""}]`;
    }

    return output;
  }

  private handleLog(
    registry: ProcessRegistry,
    params: Record<string, unknown>
  ): string {
    const sessionId = params.session_id as string | undefined;
    if (!sessionId) {
      return "Error: session_id is required for log action";
    }

    const offset = (params.offset as number | undefined) ?? 0;
    const limit = params.limit as number | undefined;
    const result = registry.getLog(sessionId, offset, limit);

    let output = stripAnsi(result.output) || "(no output)";
    output += `\n\n[Total output: ${result.totalLength} chars, status: ${result.status}]`;

    return output;
  }

  private handleWrite(
    registry: ProcessRegistry,
    params: Record<string, unknown>
  ): string {
    const sessionId = params.session_id as string | undefined;
    if (!sessionId) {
      return "Error: session_id is required for write action";
    }

    const input = params.input as string | undefined;
    if (input === undefined || input === null) {
      return "Error: input parameter is required for write action";
    }

    registry.writeStdin(sessionId, input);
    return `Wrote ${input.length} bytes to session ${sessionId}`;
  }

  private handleSendKeys(
    registry: ProcessRegistry,
    params: Record<string, unknown>
  ): string {
    const sessionId = params.session_id as string | undefined;
    if (!sessionId) {
      return "Error: session_id is required for send_keys action";
    }

    const keys = params.keys as string | undefined;
    if (!keys) {
      return "Error: keys parameter is required for send_keys action";
    }

    registry.sendSignal(sessionId, keys);
    return `Sent '${keys}' to session ${sessionId}`;
  }

  private handleKill(
    registry: ProcessRegistry,
    params: Record<string, unknown>
  ): string {
    const sessionId = params.session_id as string | undefined;
    if (!sessionId) {
      return "Error: session_id is required for kill action";
    }

    registry.kill(sessionId);
    return `Killed session ${sessionId}`;
  }

  private handleRemove(
    registry: ProcessRegistry,
    params: Record<string, unknown>
  ): string {
    const sessionId = params.session_id as string | undefined;
    if (!sessionId) {
      return "Error: session_id is required for remove action";
    }

    registry.remove(sessionId);
    return `Removed session ${sessionId}`;
  }
}
