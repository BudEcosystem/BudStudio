/**
 * Embedding generator for the agent memory system.
 *
 * Provides methods to generate embeddings via the remote Onyx API.
 * Embeddings are used for vector similarity search in the memory database.
 */

/**
 * Configuration for the Embedder.
 */
export interface EmbedderConfig {
  /** Base URL of the Onyx API (e.g., 'http://localhost:3000') */
  apiBaseUrl: string;
  /** Authentication token for API requests */
  authToken: string;
  /** Maximum number of texts to embed in a single request (default: 20) */
  maxBatchSize?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Response from the embedding API endpoint.
 */
interface EmbedResponse {
  embeddings: number[][];
}

/**
 * Error thrown when embedding fails.
 */
export class EmbeddingError extends Error {
  public readonly statusCode?: number;
  public readonly details?: string;

  constructor(message: string, statusCode?: number, details?: string) {
    super(message);
    this.name = "EmbeddingError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Embedder class that generates embeddings via the remote Onyx API.
 *
 * The Onyx API provides an embedding endpoint that uses the configured
 * embedding model (local or cloud-based) to generate vector representations
 * of text.
 *
 * @example
 * ```typescript
 * const embedder = new Embedder('http://localhost:3000', 'auth-token');
 *
 * // Embed a single text
 * const embedding = await embedder.embed('function hello() { return "world"; }');
 *
 * // Embed multiple texts efficiently
 * const embeddings = await embedder.embedBatch([
 *   'const x = 1;',
 *   'function add(a, b) { return a + b; }',
 * ]);
 *
 * // Clean up
 * embedder.close();
 * ```
 */
export class Embedder {
  private readonly apiBaseUrl: string;
  private readonly authToken: string;
  private readonly maxBatchSize: number;
  private readonly timeout: number;
  private abortController: AbortController | null = null;

  /**
   * Creates a new Embedder instance.
   *
   * @param apiBaseUrl - Base URL of the Onyx API
   * @param authToken - Authentication token for API requests
   */
  constructor(apiBaseUrl: string, authToken: string);
  /**
   * Creates a new Embedder instance from a config object.
   *
   * @param config - Configuration for the embedder
   */
  constructor(config: EmbedderConfig);
  constructor(apiBaseUrlOrConfig: string | EmbedderConfig, authToken?: string) {
    if (typeof apiBaseUrlOrConfig === "string") {
      this.apiBaseUrl = apiBaseUrlOrConfig;
      this.authToken = authToken!;
      this.maxBatchSize = 20;
      this.timeout = 30000;
    } else {
      this.apiBaseUrl = apiBaseUrlOrConfig.apiBaseUrl;
      this.authToken = apiBaseUrlOrConfig.authToken;
      this.maxBatchSize = apiBaseUrlOrConfig.maxBatchSize ?? 20;
      this.timeout = apiBaseUrlOrConfig.timeout ?? 30000;
    }
  }

  /**
   * Embeds a single text string.
   *
   * @param text - The text to embed
   * @returns A Float32Array containing the embedding vector
   * @throws {EmbeddingError} If the embedding request fails
   */
  async embed(text: string): Promise<Float32Array> {
    if (!text || text.trim().length === 0) {
      throw new EmbeddingError("Cannot embed empty text");
    }

    const embeddings = await this.embedBatch([text]);
    const embedding = embeddings[0];
    if (!embedding) {
      throw new EmbeddingError("Failed to generate embedding");
    }
    return embedding;
  }

  /**
   * Embeds multiple texts efficiently.
   *
   * If more than `maxBatchSize` texts are provided, the request will be
   * automatically split into multiple batches to avoid overwhelming the API.
   *
   * @param texts - Array of texts to embed
   * @returns Array of Float32Array embeddings corresponding to each input text
   * @throws {EmbeddingError} If the embedding request fails
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    // Filter out empty texts and track their indices
    const validTexts: { text: string; originalIndex: number }[] = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (text && text.trim().length > 0) {
        validTexts.push({ text, originalIndex: i });
      }
    }

    if (validTexts.length === 0) {
      throw new EmbeddingError("All texts are empty");
    }

    // Split into batches if necessary
    const batches: string[][] = [];
    for (let i = 0; i < validTexts.length; i += this.maxBatchSize) {
      batches.push(validTexts.slice(i, i + this.maxBatchSize).map((v) => v.text));
    }

    // Process all batches
    const batchResults: number[][][] = [];
    for (const batch of batches) {
      const result = await this.makeEmbedRequest(batch);
      batchResults.push(result);
    }

    // Flatten batch results
    const flatEmbeddings = batchResults.flat();

    // Create result array with embeddings at correct positions
    // For texts that were empty, we'll need to handle them
    const results: Float32Array[] = new Array(texts.length);
    let embeddingIndex = 0;

    for (const { originalIndex } of validTexts) {
      const embedding = flatEmbeddings[embeddingIndex];
      if (!embedding) {
        throw new EmbeddingError("Missing embedding in response");
      }
      results[originalIndex] = this.toFloat32Array(embedding);
      embeddingIndex++;
    }

    // Fill empty text positions with zero vectors if any embeddings were generated
    if (flatEmbeddings.length > 0) {
      const firstEmbedding = flatEmbeddings[0];
      if (!firstEmbedding) {
        throw new EmbeddingError("Missing first embedding in response");
      }
      const embeddingDimension = firstEmbedding.length;
      for (let i = 0; i < texts.length; i++) {
        if (!results[i]) {
          results[i] = new Float32Array(embeddingDimension);
        }
      }
    }

    return results;
  }

  /**
   * Makes the actual embedding API request.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors as number arrays
   */
  private async makeEmbedRequest(texts: string[]): Promise<number[][]> {
    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => this.abortController?.abort(), this.timeout);

    try {
      // The endpoint follows the pattern used in other Onyx APIs
      // POST /api/agent/embed with { texts: string[] }
      const response = await fetch(`${this.apiBaseUrl}/api/agent/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ texts }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        let errorDetails: string | undefined;
        try {
          const errorBody = await response.json();
          errorDetails = errorBody.detail || errorBody.message || JSON.stringify(errorBody);
        } catch {
          errorDetails = await response.text();
        }

        throw new EmbeddingError(
          `Embedding request failed with status ${response.status}`,
          response.status,
          errorDetails
        );
      }

      const data: EmbedResponse = await response.json();

      if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new EmbeddingError("Invalid response format: missing embeddings array");
      }

      if (data.embeddings.length !== texts.length) {
        throw new EmbeddingError(
          `Embedding count mismatch: expected ${texts.length}, got ${data.embeddings.length}`
        );
      }

      return data.embeddings;
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new EmbeddingError(`Embedding request timed out after ${this.timeout}ms`);
        }
        throw new EmbeddingError(`Embedding request failed: ${error.message}`);
      }

      throw new EmbeddingError("Unknown error during embedding request");
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
    }
  }

  /**
   * Converts a number array to a Float32Array for efficient storage.
   *
   * @param embedding - The embedding as a number array
   * @returns Float32Array representation of the embedding
   */
  private toFloat32Array(embedding: number[]): Float32Array {
    return new Float32Array(embedding);
  }

  /**
   * Closes the embedder and cancels any pending requests.
   */
  close(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

/**
 * Factory function to create an Embedder instance.
 *
 * @param config - Configuration for the embedder
 * @returns A new Embedder instance
 *
 * @example
 * ```typescript
 * const embedder = createEmbedder({
 *   apiBaseUrl: 'http://localhost:3000',
 *   authToken: 'your-auth-token',
 *   maxBatchSize: 10,
 * });
 * ```
 */
export function createEmbedder(config: EmbedderConfig): Embedder {
  return new Embedder(config);
}

/**
 * NOTE: Backend Endpoint Required
 *
 * This Embedder expects a backend endpoint at `POST /api/agent/embed` that:
 *
 * Request:
 * ```json
 * {
 *   "texts": ["text1", "text2", ...]
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...], ...]
 * }
 * ```
 *
 * The endpoint should:
 * 1. Authenticate the user via the Authorization header
 * 2. Use the configured embedding model (from search settings)
 * 3. Return embeddings as arrays of floats
 *
 * See backend/onyx/context/search/utils.py for how embeddings are generated:
 * - Uses EmbeddingModel.from_db_model() with current search settings
 * - Calls model.encode() with EmbedTextType.QUERY for query-type embeddings
 *
 * A sample backend implementation would be:
 * ```python
 * @router.post("/embed")
 * def embed_texts(
 *     request: EmbedTextsRequest,
 *     user: User = Depends(current_user),
 *     db_session: Session = Depends(get_session),
 * ) -> EmbedTextsResponse:
 *     embeddings = get_query_embeddings(request.texts, db_session)
 *     return EmbedTextsResponse(embeddings=embeddings)
 * ```
 */
