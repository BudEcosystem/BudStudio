import { NextRequest, NextResponse } from "next/server";

/**
 * OAuth callback handler for agent connectors
 * Forwards the OAuth code to BudApp to complete the authentication
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gatewayId: string }> }
) {
  const { gatewayId } = await params;
  const body = await req.json();
  const { code, state } = body;

  if (!code) {
    return NextResponse.json(
      { error: "Missing OAuth code" },
      { status: 400 }
    );
  }

  try {
    // Forward to BudApp backend
    const backendUrl = process.env.NEXT_PUBLIC_ONYX_BACKEND_URL || "http://localhost:8080";
    const response = await fetch(
      `${backendUrl}/api/agent/connectors/${gatewayId}/oauth/callback`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Forward cookies for authentication
          Cookie: req.headers.get("cookie") || "",
        },
        body: JSON.stringify({ code, state }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText || "OAuth callback failed" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
