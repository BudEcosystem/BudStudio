/**
 * Agent Memory System
 *
 * Provides persistent storage and retrieval of code chunks for the agent.
 * Supports both keyword-based (BM25) and vector similarity search,
 * as well as hybrid search combining both approaches.
 *
 * @example
 * ```typescript
 * import { MemoryDatabase, MemoryChunk, MemorySearch, createEmbedder } from '@/lib/agent/memory';
 *
 * const db = new MemoryDatabase();
 *
 * // Insert a chunk
 * const chunk: MemoryChunk = {
 *   filePath: '/path/to/file.ts',
 *   startLine: 1,
 *   endLine: 50,
 *   content: 'function hello() { ... }',
 *   headers: ['MyClass', 'hello'],
 * };
 * const id = db.insertChunk(chunk);
 *
 * // Search by keyword
 * const keywordResults = db.searchKeyword('hello function', 10);
 *
 * // Hybrid search (vector + keyword)
 * const embedder = createEmbedder({ apiBaseUrl: 'http://localhost:3000', authToken: 'token' });
 * const search = new MemorySearch(db, embedder);
 * const results = await search.search('hello function', { maxResults: 10 });
 *
 * // Watch for file changes and auto-sync memory
 * import { createMemoryFileWatcher } from '@/lib/agent/memory';
 * const watcher = createMemoryFileWatcher({
 *   workspacePath: '/path/to/workspace',
 *   database: db,
 *   embedder,
 * });
 * watcher.on('indexed', (filePath, count) => console.log(`Indexed ${filePath}: ${count} chunks`));
 * watcher.start();
 *
 * // Clean up
 * watcher.stop();
 * db.close();
 * ```
 */

export { MemoryDatabase } from "./database";
export {
  MemoryChunker,
  chunkFile,
  chunkFiles,
  computeContentHash,
} from "./chunker";
export { Embedder, createEmbedder, EmbeddingError } from "./embedder";
export { MemorySearch, createMemorySearch } from "./search";
export { MemoryFileWatcher, createMemoryFileWatcher } from "./watcher";
export type {
  MemoryChunk,
  SearchResult,
  InsertChunkOptions,
  SearchOptions,
} from "./types";
export type { EmbedderConfig } from "./embedder";
export type {
  HybridSearchOptions,
  HybridSearchResult,
} from "./search";
export type {
  WatcherOptions,
  WatcherEvents,
  MemoryFileWatcherConfig,
} from "./watcher";
