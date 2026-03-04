/**
 * Shared local tool execution utility.
 *
 * Provides functions to create a ToolRegistry and execute local tools,
 * used by both the interactive SSE proxy and the cron tool execution route.
 */

import * as fs from "fs";
import * as path from "path";
import {
  ToolRegistry,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  BashTool,
  GlobTool,
  GrepTool,
} from "@/lib/agent/tools";
/** Default workspace path when the requested path doesn't exist on the server. */
const SERVER_FALLBACK_WORKSPACE = "/tmp/bud-workspace";

/**
 * Resolve the workspace path, ensuring it exists on the filesystem.
 * If the requested path doesn't exist, falls back to SERVER_FALLBACK_WORKSPACE.
 * Creates the directory if it doesn't exist yet.
 */
export function resolveWorkspacePath(requestedPath: string): string {
  let workspacePath = requestedPath;

  if (!fs.existsSync(workspacePath)) {
    workspacePath = SERVER_FALLBACK_WORKSPACE;
  }

  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  return workspacePath;
}

/**
 * Create a ToolRegistry with all local tools registered.
 *
 * This function is async because browser tools use playwright-core which
 * webpack wraps as an async module. The dynamic import() ensures we properly
 * await the async module initialization.
 */
export async function createLocalToolRegistry(
  workspacePath: string
): Promise<ToolRegistry> {
  const registry = new ToolRegistry(workspacePath);
  registry.register(new ReadFileTool(workspacePath));
  registry.register(new WriteFileTool(workspacePath));
  registry.register(new EditFileTool(workspacePath));
  registry.register(new BashTool(workspacePath));
  registry.register(new GlobTool(workspacePath));
  registry.register(new GrepTool(workspacePath));

  // Browser automation tools — loaded lazily via dynamic import() to properly
  // await the async module (playwright-core is an external package that webpack
  // wraps as an async module). A synchronous require() would return before the
  // module's async init completes, leaving exports undefined.
  try {
    fs.appendFileSync(
      "/tmp/bud-agent-debug.log",
      `[${new Date().toISOString()}] [local-execution] Attempting to load browser tools via dynamic import...\n`
    );
    const browserModule = await import("./browser");
    fs.appendFileSync(
      "/tmp/bud-agent-debug.log",
      `[${new Date().toISOString()}] [local-execution] Browser module loaded, keys: ${Object.keys(browserModule).join(", ")}\n`
    );
    const { createBrowserTools } = browserModule;
    if (typeof createBrowserTools !== "function") {
      throw new Error(
        `createBrowserTools is ${typeof createBrowserTools}, not a function. Module keys: ${Object.keys(browserModule).join(", ")}`
      );
    }
    const browserTools = createBrowserTools();
    fs.appendFileSync(
      "/tmp/bud-agent-debug.log",
      `[${new Date().toISOString()}] [local-execution] Created ${browserTools.length} browser tools: ${browserTools.map((t) => t.name).join(", ")}\n`
    );
    for (const tool of browserTools) {
      registry.register(tool);
    }
  } catch (err) {
    // Browser tools unavailable (playwright-core or Chromium not installed).
    // Non-browser tools continue to work normally.
    const errMsg =
      err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    fs.appendFileSync(
      "/tmp/bud-agent-debug.log",
      `[${new Date().toISOString()}] [local-execution] Browser tools not loaded: ${errMsg}\n`
    );
    console.warn("[local-execution] Browser tools not loaded:", errMsg);
  }

  // Log all registered tools for debugging
  const toolNames = registry.getAll().map((t) => t.name);
  fs.appendFileSync(
    "/tmp/bud-agent-debug.log",
    `[${new Date().toISOString()}] [local-execution] Registry created with ${toolNames.length} tools: ${toolNames.join(", ")}\n`
  );

  return registry;
}

/**
 * Execute a local tool and return the result.
 */
export async function executeLocalToolCall(
  registry: ToolRegistry,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<{ output?: string; error?: string }> {
  const tool = registry.get(toolName);
  if (!tool) {
    return { error: `Unknown local tool: ${toolName}` };
  }

  try {
    const output = await tool.execute(toolInput);
    return { output };
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Unknown tool execution error";
    return { error };
  }
}

/**
 * Sync a workspace file to the backend database after a local write/edit.
 * This ensures the backend sees file updates
 * made through the agent's file tools.
 */
export async function syncWorkspaceFileToBackend(
  workspacePath: string,
  filePath: string,
  apiBaseUrl: string,
  cookieString: string
): Promise<void> {
  try {
    if (!filePath) return;

    const resolvedPath = path.resolve(workspacePath, filePath);
    if (!fs.existsSync(resolvedPath)) return;

    const content = fs.readFileSync(resolvedPath, "utf-8");

    const resp = await fetch(`${apiBaseUrl}/api/agent/workspace-files`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieString,
      },
      body: JSON.stringify({ path: filePath, content }),
    });

    if (!resp.ok) {
      console.warn(`Failed to sync workspace file ${filePath}: ${resp.status}`);
    }
  } catch {
    // Non-critical: don't let sync failures affect tool execution
  }
}
