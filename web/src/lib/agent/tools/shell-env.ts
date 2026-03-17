/**
 * Login shell environment resolution.
 *
 * Probes the user's login shell ($SHELL) for the full PATH, which includes
 * entries added by shell configs (nvm, pyenv, homebrew, cargo, etc.).
 * The Next.js server process typically inherits a minimal PATH that misses
 * these tools.
 *
 * Only PATH is merged — not the full environment — to avoid importing
 * dangerous variables like NODE_OPTIONS or LD_PRELOAD.
 */

import { execFileSync } from "child_process";

/** Cached login shell PATH (resolved once per process lifetime). */
let cachedLoginPath: string | null = null;

/** Whether we've already attempted the probe (avoids retrying on failure). */
let probeAttempted = false;

/**
 * Probe the user's login shell for its PATH value.
 *
 * Spawns `$SHELL -l -c "env -0"` with a 15s timeout, parses the
 * NUL-delimited output, and extracts the PATH entry.
 *
 * @returns The login shell's PATH string, or null if the probe fails.
 */
function probeLoginShell(): string | null {
  const shell = process.env.SHELL;
  if (!shell) {
    return null;
  }

  try {
    // Use NUL-delimited output to handle values containing newlines
    const output = execFileSync(shell, ["-l", "-c", "env -0"], {
      timeout: 15_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      // Start with minimal env to avoid recursion issues
      env: {
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: shell,
        TERM: process.env.TERM || "xterm-256color",
        // Pass LANG so locale-dependent tools work
        LANG: process.env.LANG,
      } as unknown as NodeJS.ProcessEnv,
    });

    // Parse NUL-delimited env vars
    const entries = output.split("\0");
    for (const entry of entries) {
      if (entry.startsWith("PATH=")) {
        return entry.slice(5);
      }
    }

    return null;
  } catch {
    // Shell probe failed — could be restricted shell, missing $SHELL, timeout, etc.
    return null;
  }
}

/**
 * Get the login shell's PATH, probing once and caching the result.
 *
 * @returns The login shell PATH, or process.env.PATH as fallback.
 */
export function getLoginShellPath(): string {
  if (!probeAttempted) {
    probeAttempted = true;
    cachedLoginPath = probeLoginShell();
  }

  return cachedLoginPath || process.env.PATH || "";
}

/**
 * Deduplicate PATH entries while preserving order.
 *
 * @param pathStr - A colon-separated PATH string
 * @returns Deduplicated PATH string
 */
function deduplicatePath(pathStr: string): string {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of pathStr.split(":")) {
    if (entry && !seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }

  return result.join(":");
}

/**
 * Create a sanitized environment for command execution with login shell PATH.
 *
 * Merges the login shell PATH (prepended) with process.env.PATH,
 * deduplicates entries, and clears potentially dangerous env vars.
 *
 * @returns A sanitized copy of process.env with augmented PATH.
 */
export function createShellEnv(): NodeJS.ProcessEnv {
  const loginPath = getLoginShellPath();
  const processPath = process.env.PATH || "";

  // Prepend login shell PATH so user-installed tools take priority
  const mergedPath = loginPath !== processPath
    ? deduplicatePath(`${loginPath}:${processPath}`)
    : processPath;

  return {
    ...process.env,
    PATH: mergedPath,
    // Clear potentially dangerous env vars
    SUDO_ASKPASS: "",
  };
}
