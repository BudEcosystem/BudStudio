import { INTERNAL_URL } from "@/lib/constants";
import { NextRequest, NextResponse } from "next/server";

/* NextJS is annoying and makes use use a separate function for 
each request type >:( */

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

export async function HEAD(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

export async function OPTIONS(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const params = await props.params;
  return handleRequest(request, params.path);
}

// Helper function to process Set-Cookie headers for desktop app compatibility
// Strips the Secure flag when running locally (for Tauri WebView which doesn't
// treat localhost as a secure context like Chrome does)
function processSetCookieHeaders(headers: Headers): Headers {
  const newHeaders = new Headers();

  // Copy all headers except set-cookie (we'll handle those specially)
  headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") {
      newHeaders.set(key, value);
    }
  });

  // Process set-cookie headers if running in desktop/override mode
  // Use getSetCookie() to get ALL Set-Cookie headers (not just the first one)
  const setCookieHeaders = (headers as any).getSetCookie ? (headers as any).getSetCookie() : [];

  if (setCookieHeaders.length > 0 && process.env.OVERRIDE_API_PRODUCTION === "true") {
    // Strip the Secure flag from ALL cookies for localhost/desktop compatibility
    // This is safe because we're running locally, not over the internet
    setCookieHeaders.forEach((cookie: string) => {
      const modifiedCookie = cookie.replace(/;\s*Secure/gi, "");
      newHeaders.append("set-cookie", modifiedCookie);
    });
  } else if (setCookieHeaders.length > 0) {
    // In production mode, keep cookies as-is
    setCookieHeaders.forEach((cookie: string) => {
      newHeaders.append("set-cookie", cookie);
    });
  }

  return newHeaders;
}

// Paths that are allowed to proxy through in production mode.
// These are backend APIs that the frontend calls directly.
const PRODUCTION_ALLOWED_PREFIXES = ["agent/", "skill", "admin/skill"];

async function handleRequest(request: NextRequest, path: string[]) {
  const joinedPath = path.join("/");
  const isAllowedInProduction = PRODUCTION_ALLOWED_PREFIXES.some((prefix) =>
    joinedPath.startsWith(prefix)
  );

  if (
    !isAllowedInProduction &&
    process.env.NODE_ENV !== "development" &&
    // NOTE: Set this environment variable to 'true' for preview environments
    // Where you want finer-grained control over API access
    process.env.OVERRIDE_API_PRODUCTION !== "true"
  ) {
    return NextResponse.json(
      {
        message:
          "This API is only available in development mode. In production, something else (e.g. nginx) should handle this.",
      },
      { status: 404 }
    );
  }

  try {
    const backendUrl = new URL(`${INTERNAL_URL}/${path.join("/")}`);

    // Get the URL parameters from the request
    const urlParams = new URLSearchParams(request.url.split("?")[1]);

    // Append the URL parameters to the backend URL
    urlParams.forEach((value, key) => {
      backendUrl.searchParams.append(key, value);
    });

    const response = await fetch(backendUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      // @ts-ignore
      duplex: "half",
    });

    // Process headers to handle cookies for desktop compatibility
    const processedHeaders = processSetCookieHeaders(response.headers);

    // Check if the response is a stream
    if (
      response.headers.get("Transfer-Encoding") === "chunked" ||
      response.headers.get("Content-Type")?.includes("stream")
    ) {
      // If it's a stream, create a TransformStream to pass the data through
      const { readable, writable } = new TransformStream();
      response.body?.pipeTo(writable);

      return new NextResponse(readable, {
        status: response.status,
        headers: processedHeaders,
      });
    } else {
      return new NextResponse(response.body, {
        status: response.status,
        headers: processedHeaders,
      });
    }
  } catch (error: unknown) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      {
        message: "Proxy error",
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      },
      { status: 500 }
    );
  }
}
