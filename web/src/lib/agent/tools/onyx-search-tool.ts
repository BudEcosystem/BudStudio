/**
 * Onyx search tool for BudAgent.
 *
 * This tool allows the agent to search through documents using Onyx's
 * RAG (Retrieval-Augmented Generation) search capabilities.
 */

import type { Tool, ToolParameter } from "./base";

/**
 * Represents a document returned from Onyx search.
 */
interface OnyxSearchDocument {
  document_id: string;
  semantic_identifier: string;
  link: string | null;
  blurb: string;
  source_type: string;
  score: number | null;
  match_highlights: string[];
  metadata: Record<string, string | string[]>;
  updated_at: string | null;
  chunk_ind: number;
  boost: number;
  hidden: boolean;
  primary_owners: string[] | null;
  secondary_owners: string[] | null;
}

/**
 * Response from the Onyx admin search API.
 */
interface OnyxSearchResponse {
  documents: OnyxSearchDocument[];
}

/**
 * Configuration for the OnyxSearchTool.
 */
export interface OnyxSearchToolConfig {
  /** Base URL for the Onyx API (e.g., "http://localhost:3000") */
  apiBaseUrl: string;
  /** Authentication token for API requests */
  authToken?: string;
}

/**
 * Tool for searching documents using Onyx RAG search.
 *
 * This tool sends queries to the Onyx backend and returns relevant
 * document snippets with titles, sources, and match highlights.
 *
 * @example
 * ```typescript
 * const tool = new OnyxSearchTool({
 *   apiBaseUrl: 'http://localhost:3000',
 *   authToken: 'your-auth-token'
 * });
 * const results = await tool.execute({
 *   query: 'How do I configure authentication?',
 *   maxResults: 5
 * });
 * ```
 */
export class OnyxSearchTool implements Tool {
  name = "onyx_search";
  description =
    "Search through documents using Onyx RAG search. Returns relevant document snippets " +
    "with titles, sources, and match highlights. Use this to find information in the knowledge base.";

  parameters: ToolParameter[] = [
    {
      name: "query",
      type: "string",
      description:
        "The search query to find relevant documents. Be specific and include key terms.",
    },
    {
      name: "maxResults",
      type: "number",
      description:
        "Maximum number of results to return (default: 5, max: 20)",
      required: false,
    },
  ];

  private apiBaseUrl: string;
  private authToken?: string;

  /**
   * Creates a new OnyxSearchTool.
   *
   * @param config - Configuration for the search tool
   */
  constructor(config: OnyxSearchToolConfig) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.authToken = config.authToken;
  }

  /**
   * Executes the search query against Onyx.
   *
   * @param params - The search parameters
   * @returns Formatted search results with document information
   */
  async execute(params: Record<string, unknown>): Promise<string> {
    const query = params.query as string;
    const maxResults = Math.min(
      Math.max(1, (params.maxResults as number) || 5),
      20
    );

    if (!query || typeof query !== "string") {
      return "Error: 'query' parameter is required and must be a string.";
    }

    if (query.trim().length === 0) {
      return "Error: 'query' parameter cannot be empty.";
    }

    try {
      const response = await this.performSearch(query);

      if (!response.documents || response.documents.length === 0) {
        return `No documents found matching the query: "${query}"`;
      }

      // Limit results to maxResults
      const documents = response.documents.slice(0, maxResults);

      return this.formatSearchResults(query, documents);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error searching documents: ${errorMessage}`;
    }
  }

  /**
   * Performs the actual search request to the Onyx API.
   */
  private async performSearch(query: string): Promise<OnyxSearchResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const url = `${this.apiBaseUrl}/api/admin/search`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        filters: {
          source_type: null,
          document_set: null,
          time_cutoff: null,
          tags: null,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Search request failed (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as OnyxSearchResponse;
    return data;
  }

  /**
   * Formats the search results into a readable string format.
   */
  private formatSearchResults(
    query: string,
    documents: OnyxSearchDocument[]
  ): string {
    const lines: string[] = [
      `Found ${documents.length} result${documents.length === 1 ? "" : "s"} for: "${query}"`,
      "",
    ];

    documents.forEach((doc, index) => {
      const resultNum = index + 1;

      // Title/identifier
      const title = doc.semantic_identifier || doc.document_id;
      lines.push(`--- Result ${resultNum}: ${title} ---`);

      // Source information
      lines.push(`Source: ${doc.source_type}`);

      // Link if available
      if (doc.link) {
        lines.push(`Link: ${doc.link}`);
      }

      // Score if available
      if (doc.score !== null && doc.score !== undefined) {
        lines.push(`Relevance Score: ${doc.score.toFixed(3)}`);
      }

      // Blurb/content snippet
      if (doc.blurb) {
        lines.push("");
        lines.push("Content:");
        lines.push(this.formatBlurb(doc.blurb));
      }

      // Match highlights
      if (doc.match_highlights && doc.match_highlights.length > 0) {
        lines.push("");
        lines.push("Highlighted Matches:");
        for (const highlight of doc.match_highlights.slice(0, 3)) {
          // Show up to 3 highlights
          const cleanHighlight = this.cleanHighlight(highlight);
          if (cleanHighlight) {
            lines.push(`  - ${cleanHighlight}`);
          }
        }
      }

      // Updated date if available
      if (doc.updated_at) {
        const date = new Date(doc.updated_at);
        lines.push(`Last Updated: ${date.toLocaleDateString()}`);
      }

      lines.push("");
    });

    return lines.join("\n");
  }

  /**
   * Formats the document blurb, truncating if necessary.
   */
  private formatBlurb(blurb: string): string {
    const maxLength = 500;
    const cleaned = blurb.replace(/\s+/g, " ").trim();

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    // Truncate at word boundary
    const truncated = cleaned.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "...";
  }

  /**
   * Cleans highlight text by removing Vespa highlighting tags and normalizing whitespace.
   */
  private cleanHighlight(highlight: string): string {
    // Replace Vespa <hi>...</hi> tags with emphasis markers
    const withMarkers = highlight
      .replace(/<hi>/g, "**")
      .replace(/<\/hi>/g, "**");

    // Normalize whitespace
    return withMarkers.replace(/\s+/g, " ").trim();
  }
}

/**
 * Creates an OnyxSearchTool with the given configuration.
 *
 * @param apiBaseUrl - Base URL for the Onyx API
 * @param authToken - Optional authentication token
 * @returns A configured OnyxSearchTool instance
 */
export function createOnyxSearchTool(
  apiBaseUrl: string,
  authToken?: string
): OnyxSearchTool {
  return new OnyxSearchTool({ apiBaseUrl, authToken });
}
