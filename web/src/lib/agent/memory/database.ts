/**
 * SQLite database implementation for the agent memory system.
 *
 * Uses better-sqlite3 for synchronous SQLite operations in Node.js.
 * Stores code chunks with full-text search (FTS5) and vector similarity search support.
 */

import Database, { Database as DatabaseType } from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MemoryChunk, SearchResult } from "./types";

/**
 * Get the path to the memory database file.
 * Creates the parent directory if it doesn't exist.
 */
function getDatabasePath(): string {
  const homeDir = os.homedir();
  const dbDir = path.join(homeDir, ".bud-studio");

  // Create directory if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  return path.join(dbDir, "memory.db");
}

/**
 * MemoryDatabase provides persistent storage for code chunks with
 * full-text search and vector similarity search capabilities.
 */
export class MemoryDatabase {
  private db: DatabaseType;
  private readonly dbPath: string;

  /**
   * Opens or creates the database and initializes the schema.
   *
   * @param dbPath - Optional custom path to the database file (for testing)
   */
  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? getDatabasePath();
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma("journal_mode = WAL");

    // Initialize the schema
    this.initializeSchema();
  }

  /**
   * Creates the database tables and indexes if they don't exist.
   */
  private initializeSchema(): void {
    // Create the main chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        content TEXT NOT NULL,
        content_hash TEXT,
        headers TEXT,
        embedding BLOB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for efficient lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_file_path
      ON memory_chunks(file_path)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_content_hash
      ON memory_chunks(content_hash)
    `);

    // Create FTS5 virtual table for full-text search
    // Note: FTS5 tables need to be created fresh if the schema changes
    const ftsExists = this.db
      .prepare(
        `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='memory_fts'
      `
      )
      .get();

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE memory_fts USING fts5(
          file_path,
          content,
          content='memory_chunks',
          content_rowid='id'
        )
      `);

      // Create triggers to keep FTS table in sync with main table
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
          INSERT INTO memory_fts(rowid, file_path, content)
          VALUES (new.id, new.file_path, new.content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, file_path, content)
          VALUES ('delete', old.id, old.file_path, old.content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memory_chunks_au AFTER UPDATE ON memory_chunks BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, file_path, content)
          VALUES ('delete', old.id, old.file_path, old.content);
          INSERT INTO memory_fts(rowid, file_path, content)
          VALUES (new.id, new.file_path, new.content);
        END
      `);
    }
  }

  /**
   * Inserts a chunk into the database.
   *
   * @param chunk - The chunk to insert
   * @returns The ID of the inserted chunk
   */
  insertChunk(chunk: MemoryChunk): number {
    const stmt = this.db.prepare(`
      INSERT INTO memory_chunks (
        file_path, start_line, end_line, content, content_hash,
        headers, embedding, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    const headersJson = chunk.headers ? JSON.stringify(chunk.headers) : null;
    const embeddingBlob = chunk.embedding
      ? Buffer.from(chunk.embedding.buffer)
      : null;

    const result = stmt.run(
      chunk.filePath,
      chunk.startLine ?? null,
      chunk.endLine ?? null,
      chunk.content,
      chunk.contentHash ?? null,
      headersJson,
      embeddingBlob,
      chunk.createdAt?.toISOString() ?? now,
      chunk.updatedAt?.toISOString() ?? now
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Gets all chunks for a specific file.
   *
   * @param filePath - The file path to search for
   * @returns Array of chunks belonging to the file
   */
  getChunksByFile(filePath: string): MemoryChunk[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_chunks WHERE file_path = ? ORDER BY start_line
    `);

    const rows = stmt.all(filePath) as DatabaseRow[];
    return rows.map(this.rowToChunk);
  }

  /**
   * Deletes all chunks for a specific file.
   *
   * @param filePath - The file path whose chunks should be deleted
   */
  deleteChunksByFile(filePath: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM memory_chunks WHERE file_path = ?
    `);

    stmt.run(filePath);
  }

  /**
   * Performs a full-text search using BM25 ranking via FTS5.
   *
   * @param query - The search query
   * @param limit - Maximum number of results to return (default: 10)
   * @returns Array of search results with scores
   */
  searchKeyword(query: string, limit: number = 10): SearchResult[] {
    // Escape special FTS5 characters and prepare the query
    const escapedQuery = this.escapeFtsQuery(query);

    const stmt = this.db.prepare(`
      SELECT
        mc.*,
        bm25(memory_fts) as score,
        snippet(memory_fts, 1, '<mark>', '</mark>', '...', 64) as snippet
      FROM memory_fts fts
      JOIN memory_chunks mc ON fts.rowid = mc.id
      WHERE memory_fts MATCH ?
      ORDER BY bm25(memory_fts)
      LIMIT ?
    `);

    const rows = stmt.all(escapedQuery, limit) as (DatabaseRow & {
      score: number;
      snippet: string;
    })[];

    return rows.map((row) => ({
      chunk: this.rowToChunk(row),
      score: Math.abs(row.score), // BM25 returns negative scores, lower is better
      snippet: row.snippet,
    }));
  }

  /**
   * Performs a vector similarity search using cosine similarity.
   *
   * Note: This is a basic implementation that computes similarity in JavaScript.
   * For large datasets, consider using a vector database extension like sqlite-vss.
   *
   * @param embedding - The query embedding vector
   * @param limit - Maximum number of results to return (default: 10)
   * @returns Array of search results with cosine similarity scores
   */
  searchVector(embedding: Float32Array, limit: number = 10): SearchResult[] {
    // Get all chunks with embeddings
    const stmt = this.db.prepare(`
      SELECT * FROM memory_chunks WHERE embedding IS NOT NULL
    `);

    const rows = stmt.all() as DatabaseRow[];

    // Compute cosine similarity for each chunk
    const results: { row: DatabaseRow; score: number }[] = [];

    for (const row of rows) {
      if (row.embedding) {
        const chunkEmbedding = new Float32Array(
          (row.embedding as Buffer).buffer,
          (row.embedding as Buffer).byteOffset,
          (row.embedding as Buffer).byteLength / Float32Array.BYTES_PER_ELEMENT
        );

        const score = this.cosineSimilarity(embedding, chunkEmbedding);
        results.push({ row, score });
      }
    }

    // Sort by similarity (descending) and take top N
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, limit);

    return topResults.map(({ row, score }) => ({
      chunk: this.rowToChunk(row),
      score,
    }));
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Converts a database row to a MemoryChunk object.
   */
  private rowToChunk(row: DatabaseRow): MemoryChunk {
    let embedding: Float32Array | undefined;
    if (row.embedding) {
      const buffer = row.embedding as Buffer;
      embedding = new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
    }

    let headers: string[] | undefined;
    if (row.headers) {
      try {
        headers = JSON.parse(row.headers as string);
      } catch {
        headers = undefined;
      }
    }

    return {
      id: row.id,
      filePath: row.file_path,
      startLine: row.start_line ?? undefined,
      endLine: row.end_line ?? undefined,
      content: row.content,
      contentHash: row.content_hash ?? undefined,
      headers,
      embedding,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    };
  }

  /**
   * Escapes special FTS5 query characters.
   */
  private escapeFtsQuery(query: string): string {
    // FTS5 uses these as special characters: " * OR AND NOT ( ) :
    // For simple queries, wrap each word in quotes to match literally
    const words = query.split(/\s+/).filter((w) => w.length > 0);
    return words.map((word) => `"${word.replace(/"/g, '""')}"`).join(" ");
  }

  /**
   * Computes cosine similarity between two vectors.
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }
}

/**
 * Internal type for database row results.
 */
interface DatabaseRow {
  id: number;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  content: string;
  content_hash: string | null;
  headers: string | null;
  embedding: Buffer | null;
  created_at: string | null;
  updated_at: string | null;
}
