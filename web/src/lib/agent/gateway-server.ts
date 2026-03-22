/**
 * Gateway relay server — runs in the Next.js Node.js process.
 * Creates a local Socket.IO server for browser connections and
 * a LocalGateway client for the cloud backend connection.
 */

import { Server as SocketIOServer } from "socket.io";
import { createServer, Server as HttpServer } from "http";
import { LocalGateway } from "./gateway";

let gatewayInstance: LocalGateway | null = null;
let ioServer: SocketIOServer | null = null;
let httpServer: HttpServer | null = null;

export async function startGatewayServer(
  port: number,
  backendUrl: string,
  authToken: string,
  workspacePath: string,
): Promise<void> {
  if (ioServer) {
    console.log("[gateway-server] Already running, skipping startup");
    return;
  }

  console.log(`[gateway-server] Starting on port ${port}, backend: ${backendUrl}, workspace: ${workspacePath}`);

  httpServer = createServer();
  ioServer = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
  });

  gatewayInstance = new LocalGateway(backendUrl, authToken, workspacePath, (event, payload) => {
    ioServer?.emit(event, payload);
  });

  await gatewayInstance.connect();

  ioServer.on("connection", (socket) => {
    console.log(`[gateway-server] Browser connected: ${socket.id}`);

    socket.on("agent:execute", (data: { session_id: string; message: string; model?: string }, ack?: (resp: { session_id: string }) => void) => {
      gatewayInstance?.execute(data.session_id, data.message, data.model);
      if (ack) ack({ session_id: data.session_id });
    });

    socket.on("agent:stop", (data: { session_id: string }, ack?: (resp: { session_id: string }) => void) => {
      gatewayInstance?.stop(data.session_id);
      if (ack) ack({ session_id: data.session_id });
    });

    socket.on("tool:approval", (data: { session_id: string; tool_call_id: string; approved: boolean }) => {
      gatewayInstance?.approve(data.session_id, data.tool_call_id, data.approved);
    });

    socket.on("tool:delta", () => { /* Client streaming — handled internally */ });

    socket.on("disconnect", (reason: string) => {
      console.log(`[gateway-server] Browser disconnected: ${socket.id} (${reason})`);
    });
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[gateway-server] Listening on http://127.0.0.1:${port}`);
  });
}

export function stopGatewayServer(): void {
  console.log("[gateway-server] Stopping...");
  gatewayInstance?.disconnect();
  gatewayInstance = null;
  ioServer?.close();
  ioServer = null;
  httpServer?.close();
  httpServer = null;
  console.log("[gateway-server] Stopped");
}

export function isGatewayServerRunning(): boolean {
  return ioServer !== null;
}
