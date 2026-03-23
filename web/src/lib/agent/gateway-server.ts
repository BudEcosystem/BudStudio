/**
 * Gateway relay server — runs in the Next.js Node.js process.
 *
 * Creates a local Socket.IO server that the browser WebView connects to.
 * When the first browser connects with an auth token, we create a
 * LocalGateway that connects to the cloud backend.
 */

import { Server as SocketIOServer } from "socket.io";
import { createServer, Server as HttpServer } from "http";
import { LocalGateway } from "./gateway";

let gatewayInstance: LocalGateway | null = null;
let ioServer: SocketIOServer | null = null;
let httpServer: HttpServer | null = null;
let _backendUrl = "";
let _workspacePath = "";

function extractAuthCookie(cookieHeader: string): string {
  const match = cookieHeader.match(/fastapiusersauth=([^;]+)/);
  return match ? match[1] : "";
}

export async function startGatewayServer(
  port: number,
  backendUrl: string,
  authToken: string,
  workspacePath: string,
): Promise<void> {
  if (ioServer) return;

  _backendUrl = backendUrl;
  _workspacePath = workspacePath;

  httpServer = createServer();
  ioServer = new SocketIOServer(httpServer, {
    cors: {
      origin: ["http://127.0.0.1:3030", "http://localhost:3030"],
      credentials: true,
    },
    path: "/socket.io",
  });

  // If explicit auth token provided, connect to backend immediately
  if (authToken) {
    try {
      await connectGateway(authToken);
    } catch {
      // Will retry on first browser connection
    }
  }

  ioServer.on("connection", (socket) => {
    // Get auth token from cookie or auth payload
    const cookieHeader = (socket.handshake.headers.cookie as string) || "";
    const token =
      extractAuthCookie(cookieHeader) ||
      (socket.handshake.auth as Record<string, string>)?.token ||
      "";

    // Register event listeners IMMEDIATELY — don't await anything first

    socket.on("agent:execute", async (
      data: { session_id: string; message: string; model?: string },
      ack?: (resp: { session_id: string; error?: string }) => void,
    ) => {
      // Connect to backend if not connected
      if (!gatewayInstance?.isConnected() && token) {
        try {
          await connectGateway(token);
        } catch (err) {
          console.error("[gateway-server] connectGateway failed:", err instanceof Error ? err.message : err);
        }
      }

      if (!gatewayInstance?.isConnected()) {
        const reason = token ? "connection failed" : "no auth token";
        if (ack) ack({ session_id: data.session_id, error: `Gateway not connected to backend (${reason})` });
        return;
      }

      gatewayInstance.execute(data.session_id, data.message, data.model);
      if (ack) ack({ session_id: data.session_id });
    });

    socket.on("agent:stop", (
      data: { session_id: string },
      ack?: (resp: { session_id: string }) => void,
    ) => {
      gatewayInstance?.stop(data.session_id);
      if (ack) ack({ session_id: data.session_id });
    });

    socket.on("tool:approval", (data: {
      session_id: string;
      tool_call_id: string;
      approved: boolean;
    }) => {
      gatewayInstance?.approve(data.session_id, data.tool_call_id, data.approved);
    });

    socket.on("tool:delta", () => { /* no-op */ });
  });

  httpServer.listen(port, "127.0.0.1");
}

async function connectGateway(authToken: string): Promise<void> {
  if (gatewayInstance?.isConnected()) return;

  console.log(`[gateway-server] connectGateway: url=${_backendUrl}, token=${authToken.substring(0, 8)}...`);
  gatewayInstance?.disconnect();
  gatewayInstance = new LocalGateway(
    _backendUrl,
    authToken,
    _workspacePath,
    (event, payload) => {
      ioServer?.emit(event, payload);
    },
  );

  try {
    await gatewayInstance.connect();
    console.log("[gateway-server] connectGateway: SUCCESS");
  } catch (err) {
    console.error("[gateway-server] connectGateway: FAILED:", err instanceof Error ? err.message : err);
    throw err;
  }
}

export function stopGatewayServer(): void {
  gatewayInstance?.disconnect();
  gatewayInstance = null;
  ioServer?.close();
  ioServer = null;
  httpServer?.close();
  httpServer = null;
}

export function isGatewayServerRunning(): boolean {
  return ioServer !== null;
}
