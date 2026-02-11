/**
 * Local Agent Execution API Route (Proxy + Local Tool Executor)
 *
 * This route acts as a bridge between the browser and the backend agent orchestrator.
 * It proxies the backend SSE stream to the browser, translating event types.
 * When the backend requests a local tool execution, this route executes the tool
 * using Node.js (file I/O, bash, etc.) and sends the result back to the backend.
 */

import * as fs from "fs";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ToolRegistry,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  BashTool,
  GlobTool,
  GrepTool,
} from "@/lib/agent/tools";
import type { AgentEvent } from "@/lib/agent/types";
import { syncWorkspaceFileToBackend } from "@/lib/agent/tools/local-execution";
import { INTERNAL_URL } from "@/lib/constants";

// Debug logging to file
function debugLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [API-Proxy] ${message}\n`;
  try {
    fs.appendFileSync("/tmp/bud-agent-debug.log", logLine);
  } catch {
    // Ignore file write errors
  }
}

/**
 * Request body schema for agent execution.
 */
interface ExecuteRequest {
  sessionId: string;
  message: string;
  workspacePath: string;
  timezone?: string;
}

/**
 * Backend SSE event types.
 */
interface BackendEvent {
  type: string;
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_call_id?: string;
  tool_output?: string | null;
  tool_error?: string | null;
  is_local?: boolean;
  requires_approval?: boolean;
  error?: string;
  new_session_id?: string;
  summary?: string;
}

/**
 * Validates the request body and returns typed data or error.
 */
function validateRequest(
  body: unknown
): { valid: true; data: ExecuteRequest } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const { sessionId, message, workspacePath, timezone } = body as Record<
    string,
    unknown
  >;

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return { valid: false, error: "sessionId is required and must be a string" };
  }

  if (typeof message !== "string" || message.trim() === "") {
    return { valid: false, error: "message is required and must be a string" };
  }

  if (typeof workspacePath !== "string" || workspacePath.trim() === "") {
    return {
      valid: false,
      error: "workspacePath is required and must be a string",
    };
  }

  return {
    valid: true,
    data: {
      sessionId: sessionId.trim(),
      message: message.trim(),
      workspacePath: workspacePath.trim(),
      timezone: typeof timezone === "string" ? timezone.trim() : undefined,
    },
  };
}

/**
 * Extract cookie string for forwarding to the backend.
 */
async function getCookieString(): Promise<string> {
  const requestCookies = await cookies();
  return requestCookies
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/**
 * Create an SSE-formatted message from an AgentEvent.
 */
function formatSSEMessage(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Default workspace path when the requested path doesn't exist on the server. */
const SERVER_FALLBACK_WORKSPACE = "/tmp/bud-workspace";

/**
 * Resolve the workspace path, ensuring it exists on the filesystem.
 * If the requested path doesn't exist, falls back to SERVER_FALLBACK_WORKSPACE.
 * Creates the directory if it doesn't exist yet.
 */
function resolveWorkspacePath(requestedPath: string): string {
  let workspacePath = requestedPath;

  // If the requested path doesn't exist, use the server fallback
  if (!fs.existsSync(workspacePath)) {
    debugLog(
      `Workspace path "${workspacePath}" does not exist, falling back to "${SERVER_FALLBACK_WORKSPACE}"`
    );
    workspacePath = SERVER_FALLBACK_WORKSPACE;
  }

  // Ensure the workspace directory exists
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
    debugLog(`Created workspace directory: ${workspacePath}`);
  }

  return workspacePath;
}

/**
 * Create a ToolRegistry with local tools registered.
 */
function createLocalToolRegistry(workspacePath: string): ToolRegistry {
  const registry = new ToolRegistry(workspacePath);
  registry.register(new ReadFileTool(workspacePath));
  registry.register(new WriteFileTool(workspacePath));
  registry.register(new EditFileTool(workspacePath));
  registry.register(new BashTool(workspacePath));
  registry.register(new GlobTool(workspacePath));
  registry.register(new GrepTool(workspacePath));
  return registry;
}

/**
 * Translate a backend event to a frontend AgentEvent.
 * Returns null if the event should not be forwarded (e.g., local_tool_request).
 */
function translateEvent(backendEvent: BackendEvent): AgentEvent | null {
  switch (backendEvent.type) {
    case "bud_agent_thinking":
      return { type: "thinking" };
    case "bud_agent_text":
      return { type: "text", content: backendEvent.content || "" };
    case "bud_agent_tool_start":
      return {
        type: "tool_start",
        toolName: backendEvent.tool_name || "",
        toolInput: backendEvent.tool_input || {},
        toolCallId: backendEvent.tool_call_id || "",
      };
    case "bud_agent_tool_result":
      return {
        type: "tool_result",
        toolName: backendEvent.tool_name || "",
        toolOutput: backendEvent.tool_output || "",
        toolError: backendEvent.tool_error || undefined,
        toolCallId: backendEvent.tool_call_id || "",
      };
    case "bud_agent_approval_required":
      return {
        type: "approval_required",
        toolName: backendEvent.tool_name || "",
        toolInput: backendEvent.tool_input || {},
        toolCallId: backendEvent.tool_call_id || "",
      };
    case "bud_agent_complete":
      return { type: "complete", content: backendEvent.content || "" };
    case "bud_agent_error":
      return { type: "error", error: backendEvent.error || "Unknown error" };
    case "bud_agent_stopped":
      return { type: "stopped" };
    case "bud_agent_done":
      return { type: "done" };
    case "bud_agent_session_compacted":
      return {
        type: "session_compacted",
        newSessionId: backendEvent.new_session_id || "",
        summary: backendEvent.summary || "",
      };
    case "bud_agent_local_tool_request":
      // Handled separately — not forwarded directly
      return null;
    default:
      debugLog(`Unknown backend event type: ${backendEvent.type}`);
      return null;
  }
}

/**
 * Execute a local tool and submit the result to the backend.
 */
async function executeLocalTool(
  registry: ToolRegistry,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolCallId: string,
  sessionId: string,
  apiBaseUrl: string,
  cookieString: string
): Promise<{ output?: string; error?: string }> {
  const tool = registry.get(toolName);
  if (!tool) {
    const error = `Unknown local tool: ${toolName}`;
    debugLog(error);
    // Submit error to backend
    await submitToolResult(
      sessionId,
      toolCallId,
      undefined,
      error,
      apiBaseUrl,
      cookieString
    );
    return { error };
  }

  try {
    debugLog(
      `Executing local tool: ${toolName} with input: ${JSON.stringify(toolInput).substring(0, 200)}`
    );
    const output = await tool.execute(toolInput);
    debugLog(`Tool ${toolName} completed successfully`);

    // Sync workspace file to backend DB after write/edit operations
    if (toolName === "write_file" || toolName === "edit_file") {
      const filePath = toolInput.path as string;
      if (filePath) {
        syncWorkspaceFileToBackend(
          registry.getWorkspacePath(),
          filePath,
          apiBaseUrl,
          cookieString
        ).catch(() => {});
      }
    }

    // Submit result to backend
    await submitToolResult(
      sessionId,
      toolCallId,
      output,
      undefined,
      apiBaseUrl,
      cookieString
    );
    return { output };
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Unknown tool execution error";
    debugLog(`Tool ${toolName} failed: ${error}`);
    // Submit error to backend
    await submitToolResult(
      sessionId,
      toolCallId,
      undefined,
      error,
      apiBaseUrl,
      cookieString
    );
    return { error };
  }
}

/**
 * POST tool result back to the backend.
 */
async function submitToolResult(
  sessionId: string,
  toolCallId: string,
  output: string | undefined,
  error: string | undefined,
  apiBaseUrl: string,
  cookieString: string
): Promise<void> {
  try {
    const response = await fetch(
      `${apiBaseUrl}/agent/sessions/${sessionId}/tool-result`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieString,
        },
        body: JSON.stringify({
          tool_call_id: toolCallId,
          output: output || null,
          error: error || null,
        }),
      }
    );
    if (!response.ok) {
      debugLog(`Failed to submit tool result: HTTP ${response.status}`);
    }
  } catch (err) {
    debugLog(`Error submitting tool result: ${err}`);
  }
}

/**
 * POST handler for agent execution.
 *
 * Proxies the request to the backend agent orchestrator and handles
 * local tool execution when requested.
 */
export async function POST(request: NextRequest): Promise<Response> {
  debugLog("POST request received!");

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  // Validate request
  const validation = validateRequest(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  let { sessionId } = validation.data;
  const { message, workspacePath, timezone } = validation.data;

  // Get cookie string for backend API calls
  const cookieString = await getCookieString();

  // Get API base URL
  const apiBaseUrl = INTERNAL_URL || "http://localhost:8080";

  // Resolve the workspace path (validates existence, creates fallback if needed)
  const resolvedWorkspacePath = resolveWorkspacePath(workspacePath);

  debugLog(`Workspace path resolved: ${resolvedWorkspacePath}`);

  // Create local tool registry with the resolved path
  const registry = createLocalToolRegistry(resolvedWorkspacePath);

  // Create a TransformStream for SSE
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Start the proxy in the background
  const proxyStream = async (): Promise<void> => {
    try {
      debugLog(
        `Proxying to backend: ${apiBaseUrl}/agent/sessions/${sessionId}/execute`
      );

      // Call the backend execute endpoint
      // NOTE: The backend routes do not have an /api prefix. The /api prefix
      // only exists in the Next.js routing layer and is stripped by the
      // generic [...path] proxy. We must call the backend directly without it.
      const backendResponse = await fetch(
        `${apiBaseUrl}/agent/sessions/${sessionId}/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieString,
          },
          body: JSON.stringify({
            message,
            workspace_path: resolvedWorkspacePath,
            timezone,
          }),
          signal: request.signal,
        }
      );

      if (!backendResponse.ok) {
        const errorText = await backendResponse
          .text()
          .catch(() => "Request failed");
        debugLog(
          `Backend returned error: ${backendResponse.status} - ${errorText}`
        );
        const errorEvent: AgentEvent = {
          type: "error",
          error: `Backend error: HTTP ${backendResponse.status}`,
        };
        await writer.write(encoder.encode(formatSSEMessage(errorEvent)));
        const doneEvent: AgentEvent = { type: "done" };
        await writer.write(encoder.encode(formatSSEMessage(doneEvent)));
        return;
      }

      if (!backendResponse.body) {
        const errorEvent: AgentEvent = {
          type: "error",
          error: "Empty response from backend",
        };
        await writer.write(encoder.encode(formatSSEMessage(errorEvent)));
        const doneEvent: AgentEvent = { type: "done" };
        await writer.write(encoder.encode(formatSSEMessage(doneEvent)));
        return;
      }

      // Read the backend SSE stream
      const reader = backendResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Skip empty lines and SSE comments (keepalive)
          if (!trimmedLine || trimmedLine.startsWith(":")) {
            continue;
          }

          // Parse JSON line (backend sends JSON lines, not SSE "data:" format)
          try {
            const backendEvent = JSON.parse(trimmedLine) as BackendEvent;

            // Handle local tool requests — execute locally and POST result to backend.
            // NOTE: Do NOT emit tool_start/tool_result here. The backend's
            // LocalToolBridge already emits bud_agent_tool_start before this event
            // and bud_agent_tool_result after it receives our result. Those events
            // are translated and forwarded to the browser by the translateEvent()
            // path below, so emitting duplicates here would cause the UI to show
            // each tool call twice.
            // Handle compaction: update sessionId for subsequent tool results
            if (backendEvent.type === "bud_agent_session_compacted") {
              if (backendEvent.new_session_id) {
                sessionId = backendEvent.new_session_id;
                debugLog(`Session compacted, new sessionId: ${sessionId}`);
              }
            }

            if (backendEvent.type === "bud_agent_local_tool_request") {
              const toolName = backendEvent.tool_name || "";
              const toolInput = backendEvent.tool_input || {};
              const toolCallId = backendEvent.tool_call_id || "";

              // Execute the tool locally and POST result to backend
              await executeLocalTool(
                registry,
                toolName,
                toolInput,
                toolCallId,
                sessionId,
                apiBaseUrl,
                cookieString
              );

              continue;
            }

            // Translate and forward other events
            const frontendEvent = translateEvent(backendEvent);
            if (frontendEvent) {
              await writer.write(
                encoder.encode(formatSSEMessage(frontendEvent))
              );

              // Stop on terminal events
              if (
                frontendEvent.type === "done" ||
                frontendEvent.type === "error" ||
                frontendEvent.type === "stopped"
              ) {
                break;
              }
            }
          } catch (e) {
            debugLog(`Failed to parse backend event: ${e}`);
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const backendEvent = JSON.parse(buffer.trim()) as BackendEvent;
          const frontendEvent = translateEvent(backendEvent);
          if (frontendEvent) {
            await writer.write(
              encoder.encode(formatSSEMessage(frontendEvent))
            );
          }
        } catch {
          debugLog(`Failed to parse final buffer: ${buffer}`);
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        debugLog("Request aborted by client");
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      debugLog(`Proxy error: ${errorMessage}`);
      const errorEvent: AgentEvent = { type: "error", error: errorMessage };
      await writer.write(encoder.encode(formatSSEMessage(errorEvent)));
      const doneEvent: AgentEvent = { type: "done" };
      await writer.write(encoder.encode(formatSSEMessage(doneEvent)));
    } finally {
      try {
        await writer.close();
      } catch {
        // Writer may already be closed
      }
    }
  };

  // Start proxying in background
  proxyStream();

  // Return the SSE response
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * OPTIONS handler for CORS preflight requests.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
