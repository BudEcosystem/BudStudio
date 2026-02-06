/**
 * Hybrid search module for the agent memory system.
 *
 * Combines vector similarity search with BM25 keyword search to provide
 * more accurate and relevant results than either method alone.
 *
 * The hybrid approach:
 * 1. Uses semantic understanding from vector embeddings (captures meaning)
 * 2. Augments with keyword matching (captures exact terms)
 * 3. Combines scores with configurable weights
 */

import { MemoryDatabase } from "./database";
import { Embedder } from "./embedder";
import { MemoryChunk, SearchResult as BaseSearchResult } from "./types";

/**
 * Options for hybrid search operations.
 */
export interface HybridSearchOptions {
  /** Maximum number of results to return (default: 6) */
  maxResults?: number;
  /** Weight for vector similarity scores (default: 0.7) */
  vectorWeight?: number;
  /** Weight for keyword BM25 scores (default: 0.3) */
  keywordWeight?: number;
  /** Filter results to specific file paths */
  sources?: string[];
}

/**
 * Result from a hybrid search operation.
 * Extends the base SearchResult with additional scoring details.
 */
export interface HybridSearchResult {
  /** The matching chunk */
  chunk: MemoryChunk;
  /** Combined weighted score (normalized 0-1) */
  score: number;
  /** Original vector similarity score (normalized 0-1) */
  vectorScore?: number;
  /** Original keyword BM25 score (normalized 0-1) */
  keywordScore?: number;
  /** Snippet of matched content with highlighting (from keyword search) */
  snippet?: string;
}

/**
 * Default search options.
 */
const DEFAULT_OPTIONS: Required<HybridSearchOptions> = {
  maxResults: 6,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  sources: [],
};

/**
 * Number of candidate results to fetch from each search type
 * before combining and filtering.
 */
const CANDIDATE_LIMIT = 24;

/**
 * MemorySearch provides hybrid search combining vector similarity
 * and keyword matching for optimal retrieval quality.
 *
 * The hybrid approach leverages:
 * - Vector search: Captures semantic meaning, handles synonyms and paraphrasing
 * - Keyword search: Captures exact matches, important for code identifiers
 *
 * @example
 * ```typescript
 * const db = new MemoryDatabase();
 * const embedder = new Embedder('http://localhost:3000', 'token');
 * const search = new MemorySearch(db, embedder);
 *
 * const results = await search.search('authentication middleware', {
 *   maxResults: 10,
 *   vectorWeight: 0.6,
 *   keywordWeight: 0.4,
 * });
 *
 * for (const result of results) {
 *   console.log(`${result.chunk.filePath}: ${result.score}`);
 * }
 * ```
 */
export class MemorySearch {
  private readonly db: MemoryDatabase;
  private readonly embedder: Embedder;

  /**
   * Creates a new MemorySearch instance.
   *
   * @param db - The MemoryDatabase instance to search
   * @param embedder - The Embedder instance for generating query embeddings
   */
  constructor(db: MemoryDatabase, embedder: Embedder) {
    this.db = db;
    this.embedder = embedder;
  }

  /**
   * Performs a hybrid search combining vector similarity and keyword matching.
   *
   * Algorithm:
   * 1. Generate embedding for the query
   * 2. Run vector search (top 24 candidates)
   * 3. Run keyword search (top 24 candidates)
   * 4. Normalize scores from both searches to 0-1 range
   * 5. Combine with weighted scoring
   * 6. Deduplicate by chunk ID
   * 7. Apply source filters if specified
   * 8. Return top N results sorted by combined score
   *
   * @param query - The search query string
   * @param options - Search options (weights, limits, filters)
   * @returns Array of search results sorted by combined score (descending)
   */
  async search(
    query: string,
    options?: HybridSearchOptions
  ): Promise<HybridSearchResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Validate weights
    if (opts.vectorWeight < 0 || opts.keywordWeight < 0) {
      throw new Error("Search weights must be non-negative");
    }

    const totalWeight = opts.vectorWeight + opts.keywordWeight;
    if (totalWeight === 0) {
      throw new Error("At least one search weight must be positive");
    }

    // Run vector and keyword searches in parallel
    const [vectorResults, keywordResults] = await Promise.all([
      this.runVectorSearch(query),
      this.runKeywordSearch(query),
    ]);

    // Normalize scores for each result set
    const normalizedVectorResults = this.normalizeScores(vectorResults);
    const normalizedKeywordResults = this.normalizeKeywordScores(keywordResults);

    // Combine results using weighted scoring
    const combinedResults = this.combineResults(
      normalizedVectorResults,
      normalizedKeywordResults,
      opts.vectorWeight,
      opts.keywordWeight
    );

    // Apply source filters if specified
    let filteredResults = combinedResults;
    if (opts.sources && opts.sources.length > 0) {
      filteredResults = this.filterBySources(combinedResults, opts.sources);
    }

    // Sort by combined score (descending) and take top N
    filteredResults.sort((a, b) => b.score - a.score);
    return filteredResults.slice(0, opts.maxResults);
  }

  /**
   * Runs vector similarity search using the query embedding.
   *
   * @param query - The search query
   * @returns Array of search results from vector search
   */
  private async runVectorSearch(query: string): Promise<BaseSearchResult[]> {
    try {
      const embedding = await this.embedder.embed(query);
      return this.db.searchVector(embedding, CANDIDATE_LIMIT);
    } catch {
      // If embedding fails, return empty results
      // This allows keyword search to still provide results
      console.warn("Vector search failed, falling back to keyword-only search");
      return [];
    }
  }

  /**
   * Runs keyword search using BM25 ranking.
   *
   * @param query - The search query
   * @returns Array of search results from keyword search
   */
  private runKeywordSearch(query: string): BaseSearchResult[] {
    try {
      return this.db.searchKeyword(query, CANDIDATE_LIMIT);
    } catch {
      // If keyword search fails (e.g., empty query), return empty results
      console.warn("Keyword search failed, falling back to vector-only search");
      return [];
    }
  }

  /**
   * Normalizes vector similarity scores to 0-1 range.
   *
   * Cosine similarity already returns values in [-1, 1] range.
   * We map this to [0, 1] for consistent weighting.
   *
   * @param results - Search results with raw scores
   * @returns Results with normalized scores
   */
  private normalizeScores(
    results: BaseSearchResult[]
  ): Array<BaseSearchResult & { normalizedScore: number }> {
    if (results.length === 0) {
      return [];
    }

    // Cosine similarity is already in [-1, 1], map to [0, 1]
    return results.map((result) => ({
      ...result,
      normalizedScore: (result.score + 1) / 2,
    }));
  }

  /**
   * Normalizes BM25 keyword scores to 0-1 range.
   *
   * BM25 scores can vary widely, so we use min-max normalization
   * across the result set.
   *
   * @param results - Search results with raw BM25 scores
   * @returns Results with normalized scores
   */
  private normalizeKeywordScores(
    results: BaseSearchResult[]
  ): Array<BaseSearchResult & { normalizedScore: number }> {
    if (results.length === 0) {
      return [];
    }

    // Find min and max scores for normalization
    const scores = results.map((r) => r.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    // If all scores are the same, assign 1.0 to all
    if (range === 0) {
      return results.map((result) => ({
        ...result,
        normalizedScore: 1.0,
      }));
    }

    // Min-max normalization to [0, 1]
    return results.map((result) => ({
      ...result,
      normalizedScore: (result.score - minScore) / range,
    }));
  }

  /**
   * Combines vector and keyword results with weighted scoring.
   *
   * Deduplicates by chunk ID, keeping the entry with scores from both
   * search types when available.
   *
   * @param vectorResults - Normalized vector search results
   * @param keywordResults - Normalized keyword search results
   * @param vectorWeight - Weight for vector scores
   * @param keywordWeight - Weight for keyword scores
   * @returns Combined and deduplicated results
   */
  private combineResults(
    vectorResults: Array<BaseSearchResult & { normalizedScore: number }>,
    keywordResults: Array<BaseSearchResult & { normalizedScore: number }>,
    vectorWeight: number,
    keywordWeight: number
  ): HybridSearchResult[] {
    const totalWeight = vectorWeight + keywordWeight;

    // Map to track combined results by chunk ID
    const resultMap = new Map<
      number,
      {
        chunk: MemoryChunk;
        vectorScore?: number;
        keywordScore?: number;
        snippet?: string;
      }
    >();

    // Process vector results
    for (const result of vectorResults) {
      const chunkId = result.chunk.id;
      if (chunkId === undefined) {
        continue;
      }

      resultMap.set(chunkId, {
        chunk: result.chunk,
        vectorScore: result.normalizedScore,
        snippet: result.snippet,
      });
    }

    // Process keyword results, merging with existing entries
    for (const result of keywordResults) {
      const chunkId = result.chunk.id;
      if (chunkId === undefined) {
        continue;
      }

      const existing = resultMap.get(chunkId);
      if (existing) {
        // Merge: keep vector score, add keyword score and snippet
        existing.keywordScore = result.normalizedScore;
        // Prefer keyword snippet as it has highlighting
        if (result.snippet) {
          existing.snippet = result.snippet;
        }
      } else {
        // New entry from keyword search only
        resultMap.set(chunkId, {
          chunk: result.chunk,
          keywordScore: result.normalizedScore,
          snippet: result.snippet,
        });
      }
    }

    // Calculate combined scores
    const combinedResults: HybridSearchResult[] = [];

    resultMap.forEach((entry) => {
      // Use 0 as default for missing scores
      const vScore = entry.vectorScore ?? 0;
      const kScore = entry.keywordScore ?? 0;

      // Weighted combination, normalized by total weight
      const combinedScore =
        (vScore * vectorWeight + kScore * keywordWeight) / totalWeight;

      combinedResults.push({
        chunk: entry.chunk,
        score: combinedScore,
        vectorScore: entry.vectorScore,
        keywordScore: entry.keywordScore,
        snippet: entry.snippet,
      });
    });

    return combinedResults;
  }

  /**
   * Filters results to only include chunks from specified source paths.
   *
   * @param results - Results to filter
   * @param sources - Array of file paths to include
   * @returns Filtered results
   */
  private filterBySources(
    results: HybridSearchResult[],
    sources: string[]
  ): HybridSearchResult[] {
    if (sources.length === 0) {
      return results;
    }

    const sourceSet = new Set(sources);
    return results.filter((result) => sourceSet.has(result.chunk.filePath));
  }
}

/**
 * Factory function to create a MemorySearch instance.
 *
 * @param db - The MemoryDatabase instance to search
 * @param embedder - The Embedder instance for generating query embeddings
 * @returns A new MemorySearch instance
 *
 * @example
 * ```typescript
 * const db = new MemoryDatabase();
 * const embedder = createEmbedder({
 *   apiBaseUrl: 'http://localhost:3000',
 *   authToken: 'your-token',
 * });
 *
 * const search = createMemorySearch(db, embedder);
 * const results = await search.search('user authentication');
 * ```
 */
export function createMemorySearch(
  db: MemoryDatabase,
  embedder: Embedder
): MemorySearch {
  return new MemorySearch(db, embedder);
}

// Re-export for convenience (allow using SearchResult as an alias)
export type SearchResult = HybridSearchResult;
export type SearchOptions = HybridSearchOptions;
