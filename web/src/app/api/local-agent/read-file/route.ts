/**
 * Local Agent File Read API Route
 *
 * This route allows reading file contents from the workspace for features
 * like the memory update diff preview. It validates that the requested
 * path is within the workspace directory to prevent path traversal.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Request body schema for file read.
 */
interface ReadFileRequest {
  /** Path to the workspace directory */
  workspacePath: string;
  /** Relative path to the file within the workspace */
  filePath: string;
}

/**
 * Validates the request body.
 */
function validateRequest(
  body: unknown
): { valid: true; data: ReadFileRequest } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const { workspacePath, filePath } = body as Record<string, unknown>;

  if (typeof workspacePath !== "string" || workspacePath.trim() === "") {
    return {
      valid: false,
      error: "workspacePath is required and must be a string",
    };
  }

  if (typeof filePath !== "string" || filePath.trim() === "") {
    return {
      valid: false,
      error: "filePath is required and must be a string",
    };
  }

  return {
    valid: true,
    data: {
      workspacePath: workspacePath.trim(),
      filePath: filePath.trim(),
    },
  };
}

/**
 * Validates that a path is within the workspace directory.
 */
function validatePath(workspacePath: string, filePath: string): string | null {
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedPath = path.resolve(workspacePath, filePath);

  // Ensure the resolved path starts with the workspace path
  if (
    !resolvedPath.startsWith(resolvedWorkspace + path.sep) &&
    resolvedPath !== resolvedWorkspace
  ) {
    return null;
  }

  return resolvedPath;
}

/**
 * POST handler for reading file contents.
 */
export async function POST(request: NextRequest): Promise<Response> {
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
    return NextResponse.json(
      { error: (validation as { valid: false; error: string }).error },
      { status: 400 }
    );
  }

  const { workspacePath, filePath } = validation.data;

  // Validate and resolve path
  const resolvedPath = validatePath(workspacePath, filePath);
  if (!resolvedPath) {
    return NextResponse.json(
      { error: "Path is outside the workspace directory" },
      { status: 403 }
    );
  }

  // Try to read the file
  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      return NextResponse.json({ error: "Path is not a file" }, { status: 400 });
    }

    const content = await fs.readFile(resolvedPath, "utf-8");
    return NextResponse.json({ content, exists: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist - return empty content (common for new memory files)
      return NextResponse.json({ content: "", exists: false });
    }

    // Other error
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to read file: ${message}` },
      { status: 500 }
    );
  }
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
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
