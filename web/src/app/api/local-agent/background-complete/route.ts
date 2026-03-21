/**
 * Local Agent Background Completion API Route
 *
 * This route acts as a callback bridge for cli_agent tool completion.
 * When a background CLI process completes (in Node.js), it sends the result here,
 * which forwards it to the backend for publishing to the agent session.
 *
 * Flow:
 * 1. CLI process completes in ProcessRegistry (Node.js)
 * 2. ProcessRegistry calls onComplete callback with output and exitCode
 * 3. Callback sends POST to this route with { budSessionId, output, exitCode }
 * 4. This route forwards to backend's /agent/events/publish
 * 5. Backend publishes resume_execute event to Redis/frontend
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { INTERNAL_URL } from "@/lib/constants";

/**
 * Request body schema for cli agent completion.
 */
interface BackgroundCompleteRequest {
  budSessionId: string;
  output: string;
  exitCode: number | null;
}

/**
 * Validates the request body and returns typed data or error.
 */
function validateRequest(
  body: unknown
): { valid: true; data: BackgroundCompleteRequest } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const { budSessionId, output, exitCode } = body as Record<string, unknown>;

  if (typeof budSessionId !== "string" || budSessionId.trim() === "") {
    return { valid: false, error: "budSessionId is required and must be a string" };
  }

  if (typeof output !== "string") {
    return { valid: false, error: "output is required and must be a string" };
  }

  if (exitCode !== null && typeof exitCode !== "number") {
    return { valid: false, error: "exitCode must be null or a number" };
  }

  return {
    valid: true,
    data: {
      budSessionId: budSessionId.trim(),
      output,
      exitCode: exitCode as number | null,
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
 * POST handler for cli agent background completion.
 *
 * Receives completion event from ProcessRegistry and publishes to backend.
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
    // validation is { valid: false; error: string } here
    const { error } = validation as { valid: false; error: string };
    return NextResponse.json({ error }, { status: 400 });
  }

  const { budSessionId, output, exitCode } = validation.data;

  try {
    // Get cookie string for backend API calls
    const cookieString = await getCookieString();

    // Get API base URL
    const apiBaseUrl = INTERNAL_URL || "http://localhost:8080";

    // Construct the message to send to the agent
    // Interpret exit code for clarity
    let exitDescription = "Unknown";
    if (exitCode === null) {
      exitDescription = "completed (exit status unknown)";
    } else if (exitCode === 0) {
      exitDescription = "completed successfully";
    } else if (exitCode === 137 || exitCode === 143) {
      exitDescription = "was terminated";
    } else {
      exitDescription = `failed with exit code ${exitCode}`;
    }

    const message =
      `Codex ${exitDescription}.\n\n` +
      `Full output:\n\n${output}\n\n` +
      `Please summarize what was accomplished, including any errors or unexpected outcomes. Be concise.`;

    // POST to backend's event publishing endpoint
    const response = await fetch(`${apiBaseUrl}/agent/events/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieString,
      },
      body: JSON.stringify({
        event_type: "resume_execute",
        data: {
          session_id: budSessionId,
          message,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return NextResponse.json(
        {
          error: `Backend error: HTTP ${response.status}`,
          details: errorText,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
