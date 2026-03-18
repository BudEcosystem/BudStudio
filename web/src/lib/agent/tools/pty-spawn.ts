/**
 * PTY (pseudo-terminal) spawning support.
 *
 * Provides optional PTY mode for commands that need a real terminal
 * (interactive CLIs, colored output, terminal UIs, tools that detect TTY).
 *
 * Uses `node-pty` as an optional dependency — lazy-loaded at runtime.
 * If not installed, PTY requests fall back gracefully with a clear warning.
 */

import { createShellEnv } from "./shell-env";

/** Unified interface matching both ChildProcess and PTY handles. */
export interface PtyHandle {
  pid: number;
  /** Write data to the process stdin. */
  write(data: string): void;
  /** Register a callback for output data (unified stdout+stderr for PTY). */
  onData(callback: (data: string) => void): void;
  /** Register a callback for process exit. */
  onExit(callback: (exitInfo: { exitCode: number; signal?: number }) => void): void;
  /** Send a signal to the process. */
  kill(signal?: string): void;
  /** Resize the PTY terminal. */
  resize?(cols: number, rows: number): void;
  /** Clean up resources. */
  dispose(): void;
}

/** Options for spawning a PTY process. */
export interface PtySpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

/** Whether node-pty is available. Cached after first check. */
let ptyAvailable: boolean | null = null;
let ptyModule: any = null;

/**
 * Check if node-pty is available (lazy-loaded).
 */
function loadNodePty(): any {
  if (ptyAvailable !== null) {
    return ptyAvailable ? ptyModule : null;
  }

  try {
    // Dynamic require to avoid hard dependency
    ptyModule = require("node-pty");
    ptyAvailable = true;
    return ptyModule;
  } catch {
    ptyAvailable = false;
    return null;
  }
}

/**
 * Check if PTY support is available.
 */
export function isPtyAvailable(): boolean {
  loadNodePty();
  return ptyAvailable === true;
}

/** Force-kill timeout: if onExit doesn't fire within this time after SIGKILL, dispose. */
const FORCE_KILL_TIMEOUT_MS = 4_000;

/**
 * Spawn a command in a pseudo-terminal.
 *
 * @param command - The shell command to run (passed to bash -c)
 * @param options - PTY spawn options
 * @returns A PtyHandle, or null if node-pty is not available
 */
export function spawnPty(
  command: string,
  options: PtySpawnOptions = {}
): PtyHandle | null {
  const nodePty = loadNodePty();
  if (!nodePty) {
    return null;
  }

  const env = options.env || createShellEnv();
  const cols = options.cols || 120;
  const rows = options.rows || 30;

  const userShell = env.SHELL || "bash";
  const pty = nodePty.spawn(userShell, ["-l", "-c", command], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: options.cwd || process.cwd(),
    env: { ...env, TERM: "xterm-256color" },
  });

  let exited = false;
  let exitCallback: ((exitInfo: { exitCode: number; signal?: number }) => void) | null = null;
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

  const handle: PtyHandle = {
    pid: pty.pid,

    write(data: string): void {
      if (!exited) {
        pty.write(data);
      }
    },

    onData(callback: (data: string) => void): void {
      pty.onData(callback);
    },

    onExit(callback: (exitInfo: { exitCode: number; signal?: number }) => void): void {
      exitCallback = callback;
      pty.onExit((e: { exitCode: number; signal?: number }) => {
        exited = true;
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
        callback(e);
      });
    },

    kill(signal?: string): void {
      if (exited) return;

      try {
        if (signal === "SIGKILL" || !signal) {
          // For SIGKILL, kill the process tree
          try {
            process.kill(-pty.pid, "SIGKILL");
          } catch {
            // Process group kill may fail; try direct kill
            try {
              process.kill(pty.pid, "SIGKILL");
            } catch {
              // Process already dead
            }
          }
        } else {
          pty.kill(signal);
        }
      } catch {
        // Already dead
      }

      // Set force-kill fallback timer
      if (!exited && !forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          if (!exited) {
            exited = true;
            if (exitCallback) {
              exitCallback({ exitCode: -1, signal: 9 });
            }
          }
        }, FORCE_KILL_TIMEOUT_MS);
      }
    },

    resize(cols: number, rows: number): void {
      if (!exited) {
        pty.resize(cols, rows);
      }
    },

    dispose(): void {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      if (!exited) {
        try {
          pty.kill();
        } catch {
          // Already dead
        }
      }
    },
  };

  return handle;
}

/**
 * Send EOF to a PTY handle.
 * On Unix, this sends Ctrl+D (\x04).
 */
export function sendEof(handle: PtyHandle): void {
  handle.write("\x04");
}

/**
 * Send Ctrl+C (SIGINT) to a PTY handle.
 */
export function sendInterrupt(handle: PtyHandle): void {
  handle.write("\x03");
}
