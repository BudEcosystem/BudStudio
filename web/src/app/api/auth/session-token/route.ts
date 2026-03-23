/**
 * Returns the current user's session token (fastapiusersauth cookie value).
 *
 * This endpoint exists so that client-side code can obtain the auth token
 * for passing to the Socket.IO gateway relay server, which runs on a
 * different port and therefore doesn't receive HttpOnly cookies from the
 * browser automatically.
 *
 * Security: This is a same-origin endpoint — only the WebView on
 * 127.0.0.1:3030 can call it, and it simply echoes back the cookie
 * the browser already possesses.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get("fastapiusersauth");

  if (!authCookie?.value) {
    return NextResponse.json({ token: null }, { status: 401 });
  }

  return NextResponse.json({ token: authCookie.value });
}
