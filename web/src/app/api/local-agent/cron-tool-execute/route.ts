/**
 * Cron Tool Execution API Route
 *
 * Executes a local tool on behalf of a suspended cron execution and
 * submits the result back to the backend to resume the execution.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  resolveWorkspacePath,
  createLocalToolRegistry,
  executeLocalToolCall,
  syncWorkspaceFileToBackend,
} from "@/lib/agent/tools/local-execution";
import { INTERNAL_URL } from "@/lib/constants";

interface CronToolExecuteRequest {
  executionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  workspacePath: string;
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
 * POST handler for cron tool execution.
 *
 * Executes a local tool and submits the result to the backend
 * via the cron execution tool-result endpoint.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: CronToolExecuteRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const { executionId, toolName, toolInput, workspacePath } = body;

  if (!executionId || !toolName) {
    return NextResponse.json(
      { error: "executionId and toolName are required" },
      { status: 400 }
    );
  }

  // Resolve workspace and create tool registry
  const resolvedPath = resolveWorkspacePath(workspacePath || "/tmp/bud-workspace");
  const registry = createLocalToolRegistry(resolvedPath);

  // Execute the tool
  const result = await executeLocalToolCall(registry, toolName, toolInput || {});

  // Sync workspace file to backend DB after write/edit operations
  if (
    (toolName === "write_file" || toolName === "edit_file") &&
    result.output &&
    toolInput?.path
  ) {
    const cookieStr = await getCookieString();
    const base = INTERNAL_URL || "http://localhost:8080";
    syncWorkspaceFileToBackend(
      resolvedPath,
      toolInput.path as string,
      base,
      cookieStr
    ).catch(() => {});
  }

  // Submit result to backend
  const cookieString = await getCookieString();
  const apiBaseUrl = INTERNAL_URL || "http://localhost:8080";

  try {
    const response = await fetch(
      `${apiBaseUrl}/agent/cron/executions/${executionId}/tool-result`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieString,
        },
        body: JSON.stringify({
          output: result.output ?? null,
          error: result.error ?? null,
        }),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend returned ${response.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      status: "submitted",
      output: result.output,
      error: result.error,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to submit tool result: ${errorMessage}` },
      { status: 502 }
    );
  }
}
