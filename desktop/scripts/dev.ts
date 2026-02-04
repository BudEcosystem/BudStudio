import { spawn, ChildProcess } from "child_process";
import path from "path";
import http from "http";
import { config } from "dotenv";

// Load environment variables from .env file
config({ path: path.resolve(__dirname, "../.env") });

const rootDir = path.resolve(__dirname, "..");
const webDir = path.resolve(rootDir, "../web");

let nextProcess: ChildProcess | null = null;
let electronProcess: ChildProcess | null = null;

function waitForServer(
  port: number,
  maxAttempts = 90,
  interval = 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      attempts++;
      console.log(`Waiting for Next.js server... (attempt ${attempts}/${maxAttempts})`);

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/",
          method: "HEAD",
          timeout: 10000, // Increased timeout for initial page compilation
        },
        (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else if (attempts < maxAttempts) {
            setTimeout(check, interval);
          } else {
            reject(new Error(`Server returned status ${res.statusCode}`));
          }
        }
      );

      req.on("error", () => {
        if (attempts < maxAttempts) {
          setTimeout(check, interval);
        } else {
          reject(new Error("Server did not start in time"));
        }
      });

      req.on("timeout", () => {
        req.destroy();
        if (attempts < maxAttempts) {
          setTimeout(check, interval);
        } else {
          reject(new Error("Server connection timeout"));
        }
      });

      req.end();
    };

    check();
  });
}

async function startNextDev(): Promise<void> {
  console.log("Starting Next.js dev server...");
  console.log(`Backend URL: ${process.env.INTERNAL_URL || "https://chat.pnap.bud.studio"}`);

  nextProcess = spawn("npm", ["run", "dev"], {
    cwd: webDir,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      // Point to the remote Kubernetes backend
      INTERNAL_URL: process.env.INTERNAL_URL || "https://chat.pnap.bud.studio",
    },
  });

  // Pipe Next.js output with prefix
  nextProcess.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        console.log(`[next] ${line}`);
      }
    });
  });

  nextProcess.stderr?.on("data", (data) => {
    const lines = data.toString().split("\n");
    lines.forEach((line: string) => {
      if (line.trim()) {
        console.error(`[next] ${line}`);
      }
    });
  });

  nextProcess.on("error", (err) => {
    console.error("Failed to start Next.js:", err);
    cleanup();
    process.exit(1);
  });

  nextProcess.on("close", (code) => {
    console.log(`Next.js exited with code ${code}`);
    if (electronProcess && !electronProcess.killed) {
      electronProcess.kill();
    }
  });

  // Wait for the server to be ready
  await waitForServer(3000);
  console.log("Next.js server is ready!");
}

async function buildElectron(): Promise<void> {
  console.log("Building Electron TypeScript...");

  const build = (config: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const proc = spawn("npx", ["tsc", "-p", config], {
        cwd: rootDir,
        stdio: "inherit",
        shell: true,
      });

      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tsc ${config} exited with code ${code}`));
      });

      proc.on("error", reject);
    });
  };

  await build("tsconfig.main.json");
  await build("tsconfig.preload.json");
  console.log("Electron build complete!");
}

async function startElectron(): Promise<void> {
  console.log("Starting Electron...");

  electronProcess = spawn("npx", ["electron", "."], {
    cwd: rootDir,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });

  electronProcess.on("error", (err) => {
    console.error("Failed to start Electron:", err);
    cleanup();
    process.exit(1);
  });

  electronProcess.on("close", (code) => {
    console.log(`Electron exited with code ${code}`);
    cleanup();
    process.exit(code || 0);
  });
}

function cleanup(): void {
  console.log("\nShutting down...");

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill();
    // Also kill any child processes (Next.js spawns workers)
    if (nextProcess.pid) {
      try {
        process.kill(-nextProcess.pid, "SIGTERM");
      } catch {
        // Process group might not exist
      }
    }
  }
}

// Handle termination signals
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

// Main
async function main(): Promise<void> {
  try {
    // Check if Next.js is already running
    let nextAlreadyRunning = false;
    try {
      await waitForServer(3000, 1, 100);
      nextAlreadyRunning = true;
      console.log("Next.js server already running on port 3000");
    } catch {
      // Not running, we'll start it
    }

    // Start Next.js if not already running
    if (!nextAlreadyRunning) {
      await startNextDev();
    }

    // Build and start Electron
    await buildElectron();
    await startElectron();
  } catch (error) {
    console.error("Failed to start:", error);
    cleanup();
    process.exit(1);
  }
}

main();
