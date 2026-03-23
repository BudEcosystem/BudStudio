import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Start the local gateway relay server in the Node.js process.
    // This only runs when GATEWAY_PORT is set (i.e. desktop / Tauri mode).
    const gatewayPort = process.env.GATEWAY_PORT
      ? parseInt(process.env.GATEWAY_PORT, 10)
      : undefined;

    if (gatewayPort) {
      // Pass the full INTERNAL_URL (including /api if present).
      // The gateway derives the Socket.IO path from the URL pathname.
      const backendUrl = (
        process.env.INTERNAL_URL ||
        process.env.NEXT_PUBLIC_BUD_BACKEND_URL ||
        "http://127.0.0.1:8080"
      );
      const authToken = process.env.GATEWAY_AUTH_TOKEN || "";
      const workspacePath = process.env.GATEWAY_WORKSPACE_PATH || process.cwd();

      try {
        const { startGatewayServer } = await import(
          "./lib/agent/gateway-server"
        );
        await startGatewayServer(
          gatewayPort,
          backendUrl,
          authToken,
          workspacePath,
        );
        console.log(
          `[instrumentation] Gateway server started on port ${gatewayPort}`,
        );
      } catch (err) {
        console.error("[instrumentation] Failed to start gateway server:", err);
      }
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
