/**
 * Local Agent Execution API Route
 *
 * This route handles agent execution requests using Server-Sent Events (SSE)
 * to stream AgentEvent objects from the AgentExecutor back to the client.
 *
 * The agent runs locally on the desktop, executing tools like file operations,
 * bash commands, and searches directly on the user's machine.
 */

import * as fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AgentExecutor } from "@/lib/agent/executor";
import type { AgentEvent } from "@/lib/agent/types";
import { INTERNAL_URL } from "@/lib/constants";

// Debug logging to file
function debugLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [API] ${message}\n`;
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
  /** Unique session identifier for this agent session */
  sessionId: string;
  /** The user's message/request to process */
  message: string;
  /** Path to the workspace directory for file operations */
  workspacePath: string;
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

  const { sessionId, message, workspacePath } = body as Record<string, unknown>;

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
    },
  };
}

/**
 * Extract auth token from cookies for remote API calls.
 * Returns the cookie string to forward to the backend API.
 */
async function getAuthToken(): Promise<string> {
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

/**
 * POST handler for agent execution.
 *
 * Accepts a request with sessionId, message, and workspacePath.
 * Creates an AgentExecutor and streams events back via SSE.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Immediately log that we received the request
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

  const { sessionId, message, workspacePath } = validation.data;

  // Get auth token from cookies
  const authToken = await getAuthToken();

  // Get API base URL from environment
  const apiBaseUrl = INTERNAL_URL || "http://localhost:8080";

  // Create a TransformStream for SSE
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Start the agent execution in the background
  const executeAgent = async (): Promise<void> => {
    let executor: AgentExecutor | null = null;

    try {
      debugLog(`Creating AgentExecutor with sessionId: ${sessionId}, workspacePath: ${workspacePath}`);

      // Create the agent executor
      executor = new AgentExecutor(sessionId, {
        workspacePath,
        apiBaseUrl,
        authToken,
      });

      debugLog(`Running executor with message: ${message.substring(0, 100)}`);

      // Run the agent and stream events
      for await (const event of executor.run(message)) {
        // Check if client disconnected
        if (request.signal.aborted) {
          // Stop the executor if client disconnected
          executor.stop();
          break;
        }

        // Write the event as SSE
        const sseMessage = formatSSEMessage(event);
        await writer.write(encoder.encode(sseMessage));

        // If we received a terminal event, stop streaming
        if (
          event.type === "done" ||
          event.type === "error" ||
          event.type === "stopped"
        ) {
          break;
        }
      }
    } catch (error) {
      // Send error event
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const errorEvent: AgentEvent = { type: "error", error: errorMessage };
      await writer.write(encoder.encode(formatSSEMessage(errorEvent)));

      // Send done event
      const doneEvent: AgentEvent = { type: "done" };
      await writer.write(encoder.encode(formatSSEMessage(doneEvent)));
    } finally {
      // Close the writer
      try {
        await writer.close();
      } catch {
        // Writer may already be closed if client disconnected
      }
    }
  };

  // Start execution without awaiting (runs in background while we stream)
  executeAgent();

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
