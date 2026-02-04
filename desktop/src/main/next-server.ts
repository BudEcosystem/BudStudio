import { createServer } from "http";
import path from "path";
import { app } from "electron";

export async function startNextServer(): Promise<number> {
  // In packaged mode, start the embedded Next.js server
  // In development (not packaged), expect external Next.js dev server
  if (!app.isPackaged) {
    // In development, we expect the Next.js dev server to be running externally
    // Just return the port it's expected to be on
    console.log("Development mode: expecting Next.js dev server on port 3000");
    return 3000;
  }

  // In production, use port 3000 for the embedded Next.js server
  const port = 3000;

  // In production, use the standalone Next.js server
  const webDir = path.join(
    app.isPackaged
      ? path.join(process.resourcesPath, "web")
      : path.join(__dirname, "../../../web/.next/standalone")
  );

  console.log(`Loading Next.js from: ${webDir}`);

  // Set required environment variables for Next.js standalone
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";

  // Enable API proxying in production mode
  process.env.OVERRIDE_API_PRODUCTION = "true";

  // Set NODE_ENV to production for standalone build
  process.env.NODE_ENV = "production";

  // Ensure INTERNAL_URL is set
  if (!process.env.INTERNAL_URL) {
    console.warn("INTERNAL_URL not set in environment variables");
  } else {
    console.log(`Backend URL: ${process.env.INTERNAL_URL}`);
  }

  // Import and start the standalone server
  const serverPath = path.join(webDir, "server.js");

  try {
    // The standalone server auto-starts when imported
    // We need to set up the environment before importing
    process.chdir(webDir);

    // Dynamic import the server
    await import(serverPath);

    // Force set the app name again after Next.js server starts
    // Next.js may override it, so we need to reset it
    app.setName("Bud Studio");

    // Also set process title which controls the menu bar name on macOS
    process.title = "Bud Studio";
    console.log("App name and process title reset to 'Bud Studio' after Next.js import");

    console.log(`Next.js standalone server started on port ${port}`);
    return port;
  } catch (error) {
    console.error("Failed to start Next.js server:", error);
    throw error;
  }
}

async function startProxyServer(port: number): Promise<number> {
  const http = await import("http");

  const server = http.createServer((req, res) => {
    const options = {
      hostname: "127.0.0.1",
      port: 3000,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Proxy error:", err);
      res.writeHead(502);
      res.end("Bad Gateway - Is the Next.js dev server running?");
    });

    req.pipe(proxyReq);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Proxy server listening on port ${port}`);
      resolve(port);
    });
  });
}
