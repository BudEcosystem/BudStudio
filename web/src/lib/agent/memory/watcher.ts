/**
 * File watcher for automatic memory synchronization.
 *
 * Monitors memory files for changes and automatically re-indexes them
 * in the memory database. Supports debouncing, glob patterns, and
 * event-based notifications.
 *
 * NOTE: Requires 'chokidar' package to be installed.
 * Run: npm install chokidar @types/chokidar
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import type { FSWatcher } from "chokidar";
import { MemoryDatabase } from "./database";
import { MemoryChunker, chunkFile } from "./chunker";
import { Embedder } from "./embedder";
import type { MemoryChunk } from "./types";

/**
 * Options for configuring the file watcher behavior.
 */
export interface WatcherOptions {
  /** Debounce time in milliseconds for file changes (default: 1500ms) */
  debounceMs?: number;
  /** Glob patterns for files to watch (default: ['*.md', 'memory/**\/*.md']) */
  patterns?: string[];
  /** Paths to ignore (default: ['node_modules', '.git']) */
  ignored?: string[];
}

/**
 * Events emitted by the MemoryFileWatcher.
 */
export interface WatcherEvents {
  /** Emitted when a file change is detected (before indexing) */
  change: (filePath: string) => void;
  /** Emitted when a file has been successfully indexed */
  indexed: (filePath: string, chunkCount: number) => void;
  /** Emitted when an error occurs during watching or indexing */
  error: (error: Error, filePath?: string) => void;
}

/**
 * Default watcher options.
 */
const DEFAULT_OPTIONS: Required<WatcherOptions> = {
  debounceMs: 1500,
  patterns: ["*.md", "memory/**/*.md"],
  ignored: ["node_modules", ".git"],
};

/**
 * MemoryFileWatcher monitors memory files for changes and automatically
 * re-indexes them in the database.
 *
 * The watcher:
 * - Watches specified glob patterns within the workspace
 * - Debounces rapid file changes to avoid excessive re-indexing
 * - Chunks files and generates embeddings on change
 * - Removes chunks when files are deleted
 * - Emits events for change, indexed, and error states
 *
 * @example
 * ```typescript
 * const watcher = new MemoryFileWatcher(
 *   '/path/to/workspace',
 *   database,
 *   chunker,
 *   embedder,
 *   { debounceMs: 2000 }
 * );
 *
 * watcher.on('indexed', (filePath, chunkCount) => {
 *   console.log(`Indexed ${filePath} with ${chunkCount} chunks`);
 * });
 *
 * watcher.on('error', (error, filePath) => {
 *   console.error(`Error processing ${filePath}:`, error);
 * });
 *
 * watcher.start();
 *
 * // Later, when done
 * watcher.stop();
 * ```
 */
export class MemoryFileWatcher extends EventEmitter {
  private readonly workspacePath: string;
  private readonly database: MemoryDatabase;
  private readonly chunker: MemoryChunker | null;
  private readonly embedder: Embedder;
  private readonly options: Required<WatcherOptions>;

  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isWatchingFlag: boolean = false;

  /**
   * Creates a new MemoryFileWatcher instance.
   *
   * @param workspacePath - Absolute path to the workspace directory to watch
   * @param database - MemoryDatabase instance for storing chunks
   * @param chunker - MemoryChunker instance or null to use the chunkFile function
   * @param embedder - Embedder instance for generating embeddings
   * @param options - Optional configuration for watcher behavior
   */
  constructor(
    workspacePath: string,
    database: MemoryDatabase,
    chunker: MemoryChunker | null,
    embedder: Embedder,
    options?: WatcherOptions
  ) {
    super();
    this.workspacePath = workspacePath;
    this.database = database;
    this.chunker = chunker;
    this.embedder = embedder;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Starts watching files for changes.
   *
   * Watches all patterns specified in the options within the workspace directory.
   * On file add/change, debounces and then re-indexes the file.
   * On file delete, removes all chunks for that file from the database.
   */
  start(): void {
    if (this.isWatchingFlag) {
      return;
    }

    // Dynamic import of chokidar to handle case where it's not installed
    this.initializeWatcher();
  }

  /**
   * Initializes the chokidar watcher asynchronously.
   */
  private async initializeWatcher(): Promise<void> {
    try {
      // Dynamic import to avoid runtime errors if chokidar is not installed
      const chokidar = await import("chokidar");

      // Build watch patterns as absolute paths
      const watchPatterns = this.options.patterns.map((pattern) =>
        path.join(this.workspacePath, pattern)
      );

      // Build ignored patterns
      const ignoredPatterns = this.options.ignored.map((ignore) =>
        path.join(this.workspacePath, ignore)
      );

      this.watcher = chokidar.watch(watchPatterns, {
        ignored: ignoredPatterns,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });

      // Handle file add and change events
      this.watcher.on("add", (filePath: string) => {
        this.handleFileChange(filePath);
      });

      this.watcher.on("change", (filePath: string) => {
        this.handleFileChange(filePath);
      });

      // Handle file deletion
      this.watcher.on("unlink", (filePath: string) => {
        this.handleFileDelete(filePath);
      });

      // Handle watcher errors
      this.watcher.on("error", (error: Error) => {
        this.emit("error", error);
      });

      this.watcher.on("ready", () => {
        this.isWatchingFlag = true;
      });
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error("Failed to initialize file watcher");

      // Check if error is due to missing chokidar
      if (
        err.message.includes("Cannot find module") ||
        err.message.includes("chokidar")
      ) {
        this.emit(
          "error",
          new Error(
            "chokidar package is not installed. Run: npm install chokidar"
          )
        );
      } else {
        this.emit("error", err);
      }
    }
  }

  /**
   * Stops watching files for changes.
   *
   * Clears all pending debounce timers and closes the file watcher.
   */
  stop(): void {
    // Clear all debounce timers
    this.debounceTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.debounceTimers.clear();

    // Close the watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isWatchingFlag = false;
  }

  /**
   * Returns whether the watcher is currently active.
   *
   * @returns True if watching, false otherwise
   */
  isWatching(): boolean {
    return this.isWatchingFlag;
  }

  /**
   * Manually re-indexes a specific file.
   *
   * Useful for triggering re-indexing without relying on file system events.
   *
   * @param filePath - Absolute path to the file to re-index
   * @throws Error if the file does not exist or cannot be read
   */
  async reindexFile(filePath: string): Promise<void> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspacePath, filePath);

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    await this.indexFile(absolutePath);
  }

  /**
   * Re-indexes all memory files matching the configured patterns.
   *
   * Useful for initial indexing or rebuilding the entire memory database.
   */
  async reindexAll(): Promise<void> {
    const glob = await import("glob");

    // Find all matching files
    const files: string[] = [];

    for (const pattern of this.options.patterns) {
      const fullPattern = path.join(this.workspacePath, pattern);
      const matches = await glob.glob(fullPattern, {
        ignore: this.options.ignored.map((i) =>
          path.join(this.workspacePath, i, "**")
        ),
        absolute: true,
      });
      files.push(...matches);
    }

    // Deduplicate files
    const uniqueFiles = Array.from(new Set(files));

    // Index each file
    for (const filePath of uniqueFiles) {
      try {
        await this.indexFile(filePath);
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error(`Failed to index ${filePath}`);
        this.emit("error", err, filePath);
      }
    }
  }

  /**
   * Handles file change events with debouncing.
   *
   * @param filePath - Path to the changed file
   */
  private handleFileChange(filePath: string): void {
    this.emit("change", filePath);

    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);
      try {
        await this.indexFile(filePath);
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error(`Failed to index ${filePath}`);
        this.emit("error", err, filePath);
      }
    }, this.options.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Handles file deletion events.
   *
   * @param filePath - Path to the deleted file
   */
  private handleFileDelete(filePath: string): void {
    // Cancel any pending indexing for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(filePath);
    }

    // Remove chunks from database
    try {
      this.database.deleteChunksByFile(filePath);
      this.emit("indexed", filePath, 0);
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error(`Failed to delete chunks for ${filePath}`);
      this.emit("error", err, filePath);
    }
  }

  /**
   * Indexes a file by chunking, embedding, and storing in the database.
   *
   * Flow:
   * 1. Read file content
   * 2. Chunk using MemoryChunker
   * 3. Delete old chunks for this file from database
   * 4. For each new chunk:
   *    - Generate embedding via Embedder
   *    - Insert into database
   * 5. Emit 'indexed' event with file path and chunk count
   *
   * @param filePath - Absolute path to the file to index
   */
  private async indexFile(filePath: string): Promise<void> {
    // Read file content
    const content = fs.readFileSync(filePath, "utf-8");

    // Chunk the file
    let chunks: MemoryChunk[];
    if (this.chunker) {
      chunks = this.chunker.chunkFile(filePath, content);
    } else {
      chunks = chunkFile(filePath, content);
    }

    // Delete old chunks for this file
    this.database.deleteChunksByFile(filePath);

    // If no chunks (empty file), we're done
    if (chunks.length === 0) {
      this.emit("indexed", filePath, 0);
      return;
    }

    // Generate embeddings for all chunks
    const contents = chunks.map((chunk) => chunk.content);
    const embeddings = await this.embedder.embedBatch(contents);

    // Insert chunks with embeddings into database
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      if (chunk && embedding) {
        chunk.embedding = embedding;
        this.database.insertChunk(chunk);
      }
    }

    this.emit("indexed", filePath, chunks.length);
  }

  // Type-safe event emitter methods
  override on<K extends keyof WatcherEvents>(
    event: K,
    listener: WatcherEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof WatcherEvents>(
    event: K,
    ...args: Parameters<WatcherEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override off<K extends keyof WatcherEvents>(
    event: K,
    listener: WatcherEvents[K]
  ): this {
    return super.off(event, listener);
  }

  override once<K extends keyof WatcherEvents>(
    event: K,
    listener: WatcherEvents[K]
  ): this {
    return super.once(event, listener);
  }
}

/**
 * Configuration for creating a MemoryFileWatcher.
 */
export interface MemoryFileWatcherConfig {
  /** Absolute path to the workspace directory to watch */
  workspacePath: string;
  /** MemoryDatabase instance for storing chunks */
  database: MemoryDatabase;
  /** MemoryChunker instance (optional, uses chunkFile function if not provided) */
  chunker?: MemoryChunker;
  /** Embedder instance for generating embeddings */
  embedder: Embedder;
  /** Optional watcher options */
  options?: WatcherOptions;
}

/**
 * Factory function to create a MemoryFileWatcher instance.
 *
 * @param config - Configuration for the watcher
 * @returns A new MemoryFileWatcher instance
 *
 * @example
 * ```typescript
 * const watcher = createMemoryFileWatcher({
 *   workspacePath: '/path/to/workspace',
 *   database: new MemoryDatabase(),
 *   embedder: new Embedder('http://localhost:3000', 'token'),
 *   options: {
 *     debounceMs: 2000,
 *     patterns: ['**\/*.md'],
 *     ignored: ['node_modules', '.git', 'dist'],
 *   },
 * });
 *
 * watcher.start();
 * ```
 */
export function createMemoryFileWatcher(
  config: MemoryFileWatcherConfig
): MemoryFileWatcher {
  return new MemoryFileWatcher(
    config.workspacePath,
    config.database,
    config.chunker ?? null,
    config.embedder,
    config.options
  );
}
