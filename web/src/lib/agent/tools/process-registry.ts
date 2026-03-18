/**
 * Process Registry — singleton that manages background process sessions.
 *
 * Tracks spawned processes (both regular ChildProcess and PTY handles),
 * their output buffers, exit state, and provides poll/kill/interact APIs.
 *
 * Similar to OpenClaw's exec/process architecture, adapted for BudAgent.
 */

import { spawn, ChildProcess } from "child_process";
import { createShellEnv } from "./shell-env";
import { spawnPty, sendInterrupt, sendEof, type PtyHandle } from "./pty-spawn";

/** Maximum aggregated output buffer size per session (200KB). */
const MAX_AGGREGATED_OUTPUT = 200_000;

/** Time to keep finished sessions before pruning (30 minutes). */
const FINISHED_TTL_MS = 30 * 60 * 1000;

/** Cleanup interval (60 seconds). */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/** Unique session ID counter. */
let nextSessionId = 1;

/** Status of a process session. */
export type SessionStatus = "running" | "finished" | "killed";

/** Information about a session (returned by list/poll). */
export interface SessionInfo {
  sessionId: string;
  command: string;
  cwd: string;
  status: SessionStatus;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  isPty: boolean;
  outputLength: number;
}

/** Options for spawning a process. */
export interface SpawnOptions {
  pty?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Internal representation of a process session. */
interface ProcessSession {
  sessionId: string;
  command: string;
  cwd: string;
  isPty: boolean;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  status: SessionStatus;

  /** Full aggregated output (capped at MAX_AGGREGATED_OUTPUT). */
  aggregatedOutput: string;

  /** New output since last poll(). */
  pendingOutput: string;

  /** Resolve function for long-poll waiters. */
  pollWaiters: Array<(data: string) => void>;

  /** The underlying handle. */
  childProcess: ChildProcess | null;
  ptyHandle: PtyHandle | null;
}

/**
 * Singleton registry for managing background process sessions.
 */
export class ProcessRegistry {
  private static instance: ProcessRegistry | null = null;

  private sessions = new Map<string, ProcessSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Prevent the timer from keeping the process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Get the singleton instance. */
  static getInstance(): ProcessRegistry {
    if (!ProcessRegistry.instance) {
      ProcessRegistry.instance = new ProcessRegistry();
    }
    return ProcessRegistry.instance;
  }

  /**
   * Spawn a new background process.
   *
   * @param command - Shell command to run
   * @param cwd - Working directory
   * @param options - Spawn options (pty mode, custom env)
   * @returns Session ID for the spawned process
   */
  spawn(command: string, cwd: string, options: SpawnOptions = {}): string {
    const sessionId = `ps_${nextSessionId++}`;
    const env = options.env || createShellEnv();
    const usePty = options.pty === true;

    const session: ProcessSession = {
      sessionId,
      command,
      cwd,
      isPty: usePty,
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      status: "running",
      aggregatedOutput: "",
      pendingOutput: "",
      pollWaiters: [],
      childProcess: null,
      ptyHandle: null,
    };

    if (usePty) {
      this.spawnPtySession(session, command, cwd, env);
    } else {
      this.spawnChildSession(session, command, cwd, env);
    }

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  private spawnPtySession(
    session: ProcessSession,
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): void {
    const handle = spawnPty(command, { cwd, env });

    if (!handle) {
      // PTY not available — fall back to regular spawn
      session.isPty = false;
      this.spawnChildSession(session, command, cwd, env);
      session.aggregatedOutput = "[Warning: node-pty not available, using regular spawn]\n";
      session.pendingOutput = session.aggregatedOutput;
      return;
    }

    session.ptyHandle = handle;

    handle.onData((data: string) => {
      this.appendOutput(session, data);
    });

    handle.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      session.status = "finished";
      session.finishedAt = Date.now();
      // Wake up any poll waiters
      this.flushWaiters(session);
    });
  }

  private spawnChildSession(
    session: ProcessSession,
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): void {
    const userShell = env.SHELL || "bash";
    const proc = spawn(userShell, ["-l", "-c", command], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    session.childProcess = proc;

    proc.stdout?.on("data", (data: Buffer) => {
      this.appendOutput(session, data.toString());
    });

    proc.stderr?.on("data", (data: Buffer) => {
      this.appendOutput(session, data.toString());
    });

    proc.on("close", (code: number | null) => {
      session.exitCode = code;
      session.status = "finished";
      session.finishedAt = Date.now();
      this.flushWaiters(session);
    });

    proc.on("error", (err: Error) => {
      this.appendOutput(session, `\n[Process error: ${err.message}]\n`);
      session.status = "finished";
      session.exitCode = -1;
      session.finishedAt = Date.now();
      this.flushWaiters(session);
    });
  }

  private appendOutput(session: ProcessSession, data: string): void {
    // Cap aggregated output
    if (session.aggregatedOutput.length < MAX_AGGREGATED_OUTPUT) {
      const remaining = MAX_AGGREGATED_OUTPUT - session.aggregatedOutput.length;
      session.aggregatedOutput += data.slice(0, remaining);
    }

    // Always append to pending (for poll)
    session.pendingOutput += data;

    // Wake any waiting pollers immediately
    if (session.pollWaiters.length > 0) {
      this.flushWaiters(session);
    }
  }

  private flushWaiters(session: ProcessSession): void {
    const output = session.pendingOutput;
    session.pendingOutput = "";
    for (const resolve of session.pollWaiters) {
      resolve(output);
    }
    session.pollWaiters = [];
  }

  /**
   * Poll for new output since the last poll.
   * Supports long-poll: if no new output is available, waits up to timeoutMs.
   *
   * @param sessionId - The session to poll
   * @param timeoutMs - Maximum time to wait for output (default: 5000)
   * @returns New output since last poll, plus session status
   */
  async poll(
    sessionId: string,
    timeoutMs: number = 5000
  ): Promise<{ output: string; status: SessionStatus; exitCode: number | null }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // If there's pending output or the process is finished, return immediately
    if (session.pendingOutput.length > 0 || session.status !== "running") {
      const output = session.pendingOutput;
      session.pendingOutput = "";
      return { output, status: session.status, exitCode: session.exitCode };
    }

    // Long-poll: wait for output or timeout
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter
        const idx = session.pollWaiters.indexOf(waiterResolve);
        if (idx >= 0) session.pollWaiters.splice(idx, 1);
        resolve({ output: "", status: session.status, exitCode: session.exitCode });
      }, timeoutMs);

      const waiterResolve = (data: string) => {
        clearTimeout(timer);
        resolve({ output: data, status: session.status, exitCode: session.exitCode });
      };

      session.pollWaiters.push(waiterResolve);
    });
  }

  /**
   * Get the full aggregated output log with optional pagination.
   *
   * @param sessionId - The session to get logs from
   * @param offset - Character offset to start from (default: 0)
   * @param limit - Maximum characters to return (default: all)
   * @returns Paginated output log
   */
  getLog(
    sessionId: string,
    offset: number = 0,
    limit?: number
  ): { output: string; totalLength: number; status: SessionStatus } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const total = session.aggregatedOutput.length;
    const end = limit ? Math.min(offset + limit, total) : total;
    const output = session.aggregatedOutput.slice(offset, end);

    return { output, totalLength: total, status: session.status };
  }

  /**
   * Write data to a process's stdin.
   *
   * @param sessionId - The session to write to
   * @param data - Data to write
   */
  writeStdin(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.status !== "running") {
      throw new Error(`Session ${sessionId} is not running`);
    }

    if (session.ptyHandle) {
      session.ptyHandle.write(data);
    } else if (session.childProcess?.stdin) {
      session.childProcess.stdin.write(data);
    } else {
      throw new Error(`Session ${sessionId} has no writable stdin`);
    }
  }

  /**
   * Send a signal or special key sequence to a process.
   *
   * @param sessionId - The session to signal
   * @param signal - Signal name: "ctrl+c", "ctrl+d", "SIGTERM", "SIGKILL", "SIGINT"
   */
  sendSignal(sessionId: string, signal: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (session.status !== "running") {
      throw new Error(`Session ${sessionId} is not running`);
    }

    const normalizedSignal = signal.toLowerCase();

    if (session.ptyHandle) {
      // PTY: send key sequences for ctrl combinations
      if (normalizedSignal === "ctrl+c" || normalizedSignal === "sigint") {
        sendInterrupt(session.ptyHandle);
      } else if (normalizedSignal === "ctrl+d") {
        sendEof(session.ptyHandle);
      } else if (normalizedSignal === "sigterm") {
        session.ptyHandle.kill("SIGTERM");
      } else if (normalizedSignal === "sigkill") {
        session.ptyHandle.kill("SIGKILL");
      } else {
        session.ptyHandle.kill(signal.toUpperCase());
      }
    } else if (session.childProcess) {
      // Regular process: send OS signals
      if (normalizedSignal === "ctrl+c" || normalizedSignal === "sigint") {
        session.childProcess.kill("SIGINT");
      } else if (normalizedSignal === "ctrl+d") {
        session.childProcess.stdin?.end();
      } else if (normalizedSignal === "sigterm") {
        session.childProcess.kill("SIGTERM");
      } else if (normalizedSignal === "sigkill") {
        session.childProcess.kill("SIGKILL");
      } else {
        session.childProcess.kill(signal.toUpperCase() as NodeJS.Signals);
      }
    }
  }

  /**
   * Kill a process and its entire process tree.
   *
   * @param sessionId - The session to kill
   */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== "running") {
      return; // Already finished
    }

    session.status = "killed";
    session.finishedAt = Date.now();

    if (session.ptyHandle) {
      session.ptyHandle.kill("SIGKILL");
    } else if (session.childProcess) {
      // Try process group kill first
      try {
        process.kill(-session.childProcess.pid!, "SIGKILL");
      } catch {
        try {
          session.childProcess.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }
    }

    // Wake any poll waiters so they don't hang
    this.flushWaiters(session);
  }

  /**
   * List all sessions (running + recently finished).
   *
   * @returns Array of session info objects
   */
  list(): SessionInfo[] {
    const result: SessionInfo[] = [];

    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      result.push(this.toSessionInfo(session));
    }

    // Sort: running first, then by start time descending
    result.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;
      return b.startedAt - a.startedAt;
    });

    return result;
  }

  /**
   * Remove a finished session from the registry.
   *
   * @param sessionId - The session to remove
   */
  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === "running") {
      throw new Error(`Cannot remove running session ${sessionId}. Kill it first.`);
    }

    // Clean up handles
    if (session.ptyHandle) {
      session.ptyHandle.dispose();
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Get info for a single session.
   */
  getSession(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.toSessionInfo(session);
  }

  private toSessionInfo(session: ProcessSession): SessionInfo {
    const now = Date.now();
    return {
      sessionId: session.sessionId,
      command: session.command,
      cwd: session.cwd,
      status: session.status,
      exitCode: session.exitCode,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      durationMs: (session.finishedAt || now) - session.startedAt,
      isPty: session.isPty,
      outputLength: session.aggregatedOutput.length,
    };
  }

  /**
   * Clean up finished sessions older than FINISHED_TTL_MS.
   */
  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.sessions.entries());
    for (const [id, session] of entries) {
      if (
        session.status !== "running" &&
        session.finishedAt &&
        now - session.finishedAt > FINISHED_TTL_MS
      ) {
        if (session.ptyHandle) {
          session.ptyHandle.dispose();
        }
        this.sessions.delete(id);
      }
    }
  }
}
