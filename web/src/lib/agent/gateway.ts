/**
 * LocalGateway — Socket.IO client that connects to the cloud backend.
 * Executes local tools (bash, files, browser) in the Node.js process.
 * Forwards display events to the WebView via the onEvent callback.
 */

import * as fs from "fs";
import * as path from "path";
import { io, Socket } from "socket.io-client";
import type { ToolRegistry } from "./tools";
import { createLocalToolRegistry } from "./tools/local-execution";

interface ToolRequestPayload {
  session_id: string;
  ind: number;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_call_id: string;
}

interface ToolResultPayload {
  session_id: string;
  tool_call_id: string;
  output: string | null;
  error: string | null;
}

interface AckResponse {
  session_id?: string;
  error?: string;
  code?: string;
}

export class LocalGateway {
  private socket: Socket | null = null;
  private registry: ToolRegistry | null = null;
  private activeToolAbort: AbortController | null = null;
  private pendingResults: ToolResultPayload[] = [];

  constructor(
    private backendUrl: string,
    private authToken: string,
    private workspacePath: string,
    private onEvent: (event: string, payload: unknown) => void,
  ) {}

  async connect(): Promise<void> {
    this.registry = await createLocalToolRegistry(this.workspacePath);

    this.socket = io(this.backendUrl, {
      path: "/ws/agent",
      auth: { token: this.authToken },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this.socket.on("tool:request", (data: ToolRequestPayload) => {
      this.handleToolRequest(data);
    });

    const forwardEvents = [
      "agent:message_start", "agent:message_delta",
      "agent:reasoning_start", "agent:reasoning_delta",
      "agent:section_end", "agent:citation", "agent:artifact",
      "agent:session_compacted", "agent:session_updated",
      "agent:stopped", "agent:done", "agent:error",
      "tool:approval_required", "tool:start", "tool:delta",
    ];
    for (const event of forwardEvents) {
      this.socket.on(event, (data: unknown) => this.onEvent(event, data));
    }

    this.socket.on("connect", () => {
      this.onEvent("gateway:connected", {});
      this.flushPendingResults();
    });
    this.socket.on("disconnect", (reason: string) => {
      this.onEvent("gateway:disconnected", { reason });
    });
    this.socket.on("connect_error", (err: Error) => {
      this.onEvent("gateway:error", { error: err.message });
    });
  }

  private async handleToolRequest(data: ToolRequestPayload): Promise<void> {
    const { tool_name, tool_input, tool_call_id, session_id } = data;
    this.onEvent("tool:request", data);

    if (!this.registry) {
      this.sendToolResult(session_id, tool_call_id, null, "Gateway not initialized");
      return;
    }

    const tool = this.registry.get(tool_name);
    if (!tool) {
      this.sendToolResult(session_id, tool_call_id, null, `Unknown local tool: ${tool_name}`);
      return;
    }

    this.activeToolAbort = new AbortController();
    try {
      const output = await tool.execute(tool_input);

      if (tool_name === "write_file" || tool_name === "edit_file") {
        this.emitFileSync(session_id, tool_input.path as string);
      }

      this.sendToolResult(session_id, tool_call_id, output, null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      this.sendToolResult(session_id, tool_call_id, null,
        err instanceof Error ? err.message : "Unknown tool execution error");
    } finally {
      this.activeToolAbort = null;
    }
  }

  private emitFileSync(sessionId: string, filePath: string): void {
    try {
      const resolvedPath = path.resolve(this.workspacePath, filePath);
      if (!fs.existsSync(resolvedPath)) return;
      const content = fs.readFileSync(resolvedPath, "utf-8");
      this.socket?.emit("file:sync", {
        session_id: sessionId,
        workspace_path: this.workspacePath,
        file_path: filePath,
        content,
      });
    } catch { /* ignore sync errors */ }
  }

  private sendToolResult(sessionId: string, toolCallId: string, output: string | null, error: string | null): void {
    const payload: ToolResultPayload = { session_id: sessionId, tool_call_id: toolCallId, output, error };
    if (this.socket?.connected) {
      this.socket.emit("tool:result", payload);
    } else {
      this.pendingResults.push(payload);
    }
  }

  private flushPendingResults(): void {
    while (this.pendingResults.length > 0) {
      const result = this.pendingResults.shift()!;
      this.socket?.emit("tool:result", result);
    }
  }

  execute(sessionId: string, message: string, model?: string): void {
    this.socket?.emit("agent:execute", {
      session_id: sessionId, message, workspace_path: this.workspacePath, model,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, (ack: AckResponse) => {
      if (ack?.error) this.onEvent("agent:error", { session_id: sessionId, error: ack.error });
    });
  }

  approve(sessionId: string, toolCallId: string, approved: boolean): void {
    this.socket?.emit("tool:approval", { session_id: sessionId, tool_call_id: toolCallId, approved });
  }

  stop(sessionId: string): void {
    if (this.activeToolAbort) this.activeToolAbort.abort();
    this.socket?.emit("agent:stop", { session_id: sessionId }, (ack: AckResponse) => {
      if (ack?.error) this.onEvent("agent:error", { session_id: sessionId, error: ack.error });
    });
  }

  disconnect(): void {
    if (this.activeToolAbort) this.activeToolAbort.abort();
    this.socket?.disconnect();
    this.socket = null;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}
