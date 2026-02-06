/**
 * Session Client for Agent Session Persistence
 *
 * This module provides a client for interacting with the remote Onyx backend
 * for agent session persistence. It handles creating, retrieving, updating,
 * and deleting agent sessions and their associated messages.
 *
 * Includes retry logic for transient failures and proper error categorization.
 */

import {
  SessionError,
  NetworkError,
  isRetryableError,
} from "./utils/errors";
import { withRetry, type RetryOptions } from "./utils/retry";

// ==============================================================================
// Interfaces
// ==============================================================================

/**
 * Status of an agent session, matching backend AgentSessionStatus enum.
 */
export type AgentSessionStatus = "active" | "completed" | "failed" | "stopped";

/**
 * Role of a message in an agent session, matching backend AgentMessageRole enum.
 */
export type AgentMessageRole = "user" | "assistant" | "tool" | "system";

/**
 * Represents an agent session.
 */
export interface AgentSession {
  /** Unique identifier for the session */
  id: string;
  /** ID of the user who owns the session */
  userId: string | null;
  /** Title of the session */
  title: string | null;
  /** Description of the session */
  description: string | null;
  /** Current status of the session */
  status: AgentSessionStatus;
  /** Path to the workspace directory */
  workspacePath: string | null;
  /** Total tokens used in the session */
  totalTokensUsed: number;
  /** Total tool calls made in the session */
  totalToolCalls: number;
  /** Timestamp when the session was created */
  createdAt: Date;
  /** Timestamp when the session was last updated */
  updatedAt: Date;
  /** Timestamp when the session was completed (if applicable) */
  completedAt: Date | null;
  /** Messages in the session (optional, may be loaded separately) */
  messages?: AgentMessage[];
}

/**
 * Represents a message in an agent session.
 */
export interface AgentMessage {
  /** Unique identifier for the message */
  id: string;
  /** ID of the session this message belongs to */
  sessionId: string;
  /** Role of the message sender */
  role: AgentMessageRole;
  /** Text content of the message */
  content: string | null;
  /** Name of the tool that was called (for tool messages) */
  toolName: string | null;
  /** Input parameters passed to the tool */
  toolInput: Record<string, unknown> | null;
  /** Output/result from the tool execution */
  toolOutput: Record<string, unknown> | null;
  /** Error message if the tool execution failed */
  toolError: string | null;
  /** Timestamp when the message was created */
  createdAt: Date;
}

/**
 * Input for creating a new message.
 */
export interface MessageInput {
  /** Role of the message sender */
  role: AgentMessageRole;
  /** Text content of the message */
  content?: string | null;
  /** Name of the tool that was called (for tool messages) */
  toolName?: string | null;
  /** Input parameters passed to the tool */
  toolInput?: Record<string, unknown> | null;
  /** Output/result from the tool execution */
  toolOutput?: Record<string, unknown> | null;
  /** Error message if the tool execution failed */
  toolError?: string | null;
}

// ==============================================================================
// Internal Response Types (matching backend API)
// ==============================================================================

interface ApiSessionSnapshot {
  id: string;
  user_id: string | null;
  title: string | null;
  description: string | null;
  status: string;
  workspace_path: string | null;
  total_tokens_used: number;
  total_tool_calls: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ApiMessageSnapshot {
  id: string;
  session_id: string;
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  tool_error: string | null;
  created_at: string;
}

interface CreateSessionResponse {
  session_id: string;
}

interface SessionListResponse {
  sessions: ApiSessionSnapshot[];
}

interface SessionHistoryResponse {
  messages: ApiMessageSnapshot[];
}

interface AddMessageResponse {
  message_id: string;
}

interface StatusResponse {
  status: string;
}

interface DeleteSessionResponse {
  status: string;
}

// ==============================================================================
// Error Classes (Legacy - kept for backwards compatibility)
// ==============================================================================

/**
 * Error thrown when a session is not found.
 * @deprecated Use SessionError.notFound() instead
 */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

/**
 * Error thrown when an API request fails.
 * @deprecated Use SessionError.fromResponse() instead
 */
export class SessionApiError extends Error {
  public readonly statusCode: number;
  public readonly detail: string;

  constructor(statusCode: number, detail: string) {
    super(`API error (${statusCode}): ${detail}`);
    this.name = "SessionApiError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

// ==============================================================================
// Retry Configuration
// ==============================================================================

/** Default retry options for session API calls */
const DEFAULT_SESSION_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  delay: 1000,
  backoff: 2,
  maxDelay: 10000,
  shouldRetry: isRetryableError,
};

// ==============================================================================
// Helper Functions
// ==============================================================================

/**
 * Convert an API session snapshot to an AgentSession.
 */
function toAgentSession(snapshot: ApiSessionSnapshot): AgentSession {
  return {
    id: snapshot.id,
    userId: snapshot.user_id,
    title: snapshot.title,
    description: snapshot.description,
    status: snapshot.status as AgentSessionStatus,
    workspacePath: snapshot.workspace_path,
    totalTokensUsed: snapshot.total_tokens_used,
    totalToolCalls: snapshot.total_tool_calls,
    createdAt: new Date(snapshot.created_at),
    updatedAt: new Date(snapshot.updated_at),
    completedAt: snapshot.completed_at ? new Date(snapshot.completed_at) : null,
  };
}

/**
 * Convert an API message snapshot to an AgentMessage.
 */
function toAgentMessage(snapshot: ApiMessageSnapshot): AgentMessage {
  return {
    id: snapshot.id,
    sessionId: snapshot.session_id,
    role: snapshot.role as AgentMessageRole,
    content: snapshot.content,
    toolName: snapshot.tool_name,
    toolInput: snapshot.tool_input,
    toolOutput: snapshot.tool_output,
    toolError: snapshot.tool_error,
    createdAt: new Date(snapshot.created_at),
  };
}

// ==============================================================================
// Session Client
// ==============================================================================

/**
 * Client for interacting with the agent session API.
 *
 * Provides methods for creating, retrieving, updating, and deleting
 * agent sessions and their associated messages.
 *
 * @example
 * ```typescript
 * const client = new SessionClient('https://api.example.com', 'auth-token');
 *
 * // Create a new session
 * const session = await client.createSession('My Session', '/path/to/workspace');
 *
 * // Add a message
 * const message = await client.addMessage(session.id, {
 *   role: 'user',
 *   content: 'Hello, agent!'
 * });
 *
 * // Get the session with messages
 * const fullSession = await client.getSession(session.id);
 * const messages = await client.getMessages(session.id);
 * ```
 */
export class SessionClient {
  private readonly apiBaseUrl: string;
  private readonly authToken: string;
  private readonly retryOptions: RetryOptions;

  /**
   * Create a new SessionClient.
   *
   * @param apiBaseUrl - Base URL for the Onyx backend API (e.g., 'https://api.example.com')
   * @param authToken - Authentication token for API requests
   * @param retryOptions - Optional retry configuration
   */
  constructor(
    apiBaseUrl: string,
    authToken: string,
    retryOptions?: RetryOptions
  ) {
    // Remove trailing slash from base URL
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.authToken = authToken;
    this.retryOptions = retryOptions ?? DEFAULT_SESSION_RETRY_OPTIONS;
  }

  /**
   * Make an authenticated request to the API with retry logic.
   *
   * @param method - HTTP method
   * @param path - API path
   * @param body - Optional request body
   * @param sessionId - Optional session ID for error context
   * @returns The response data
   * @throws SessionError for session-specific failures
   * @throws NetworkError for network failures
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    sessionId?: string
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;

    return withRetry(
      async () => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (this.authToken) {
          headers["Authorization"] = `Bearer ${this.authToken}`;
        }

        let response: Response;
        try {
          response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
        } catch (error) {
          // Convert fetch errors to NetworkError
          if (error instanceof Error) {
            throw NetworkError.fromFetchError(error, url);
          }
          throw error;
        }

        if (!response.ok) {
          let errorDetail = `HTTP ${response.status}`;
          try {
            const errorData = await response.json();
            errorDetail = errorData.detail || errorDetail;
          } catch {
            // Ignore JSON parsing errors
          }

          // Throw appropriate SessionError
          throw SessionError.fromResponse(
            response,
            errorDetail,
            sessionId
          );
        }

        // Handle empty responses (e.g., 204 No Content)
        const text = await response.text();
        if (!text) {
          return {} as T;
        }

        return JSON.parse(text) as T;
      },
      {
        ...this.retryOptions,
        onRetry: (error: Error, attempt: number, delay: number) => {
          console.warn(
            `Session API retry ${attempt} for ${method} ${path}: ${error.message} (waiting ${delay}ms)`
          );
        },
      }
    );
  }

  /**
   * Make an authenticated request without retry.
   *
   * Use this for operations where retry doesn't make sense
   * (e.g., checking if a session exists).
   */
  private async requestNoRetry<T>(
    method: string,
    path: string,
    body?: unknown,
    sessionId?: string
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw NetworkError.fromFetchError(error, url);
      }
      throw error;
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw SessionError.notFound(sessionId ?? "unknown");
      }

      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorDetail = errorData.detail || errorDetail;
      } catch {
        // Ignore JSON parsing errors
      }

      throw SessionError.fromResponse(response, errorDetail, sessionId);
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  /**
   * Create a new agent session.
   *
   * @param title - Optional title for the session
   * @param workspacePath - Optional path to the workspace directory
   * @returns The created session (without messages)
   */
  async createSession(
    title?: string,
    workspacePath?: string
  ): Promise<AgentSession> {
    const response = await this.request<CreateSessionResponse>(
      "POST",
      "/api/agent/sessions",
      {
        title: title || null,
        workspace_path: workspacePath || null,
      }
    );

    // Fetch the full session details
    const session = await this.getSession(response.session_id);
    if (!session) {
      throw new Error("Failed to retrieve created session");
    }

    return session;
  }

  /**
   * Get a specific agent session by ID.
   *
   * @param sessionId - The ID of the session to retrieve
   * @returns The session, or null if not found
   */
  async getSession(sessionId: string): Promise<AgentSession | null> {
    try {
      const snapshot = await this.requestNoRetry<ApiSessionSnapshot>(
        "GET",
        `/api/agent/sessions/${sessionId}`,
        undefined,
        sessionId
      );
      return toAgentSession(snapshot);
    } catch (error) {
      // Handle both old and new error types for backwards compatibility
      if (
        error instanceof SessionNotFoundError ||
        (error instanceof SessionError && error.code === "SESSION_NOT_FOUND")
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all agent sessions for the current user.
   *
   * @param options - Optional parameters for filtering
   * @returns Array of sessions (without messages)
   */
  async listSessions(options?: {
    includeCompleted?: boolean;
    limit?: number;
  }): Promise<AgentSession[]> {
    const params = new URLSearchParams();

    if (options?.includeCompleted !== undefined) {
      params.set("include_completed", String(options.includeCompleted));
    }
    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }

    const queryString = params.toString();
    const path = `/api/agent/sessions${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<SessionListResponse>("GET", path);
    return response.sessions.map(toAgentSession);
  }

  /**
   * Add a message to an agent session.
   *
   * @param sessionId - The ID of the session
   * @param message - The message to add
   * @returns The created message
   */
  async addMessage(
    sessionId: string,
    message: MessageInput
  ): Promise<AgentMessage> {
    const response = await this.request<AddMessageResponse>(
      "POST",
      `/api/agent/sessions/${sessionId}/messages`,
      {
        role: message.role,
        content: message.content ?? null,
        tool_name: message.toolName ?? null,
        tool_input: message.toolInput ?? null,
        tool_output: message.toolOutput ?? null,
        tool_error: message.toolError ?? null,
      }
    );

    // Return a constructed message object
    // Note: We don't have all the details, so we construct what we can
    return {
      id: response.message_id,
      sessionId,
      role: message.role,
      content: message.content ?? null,
      toolName: message.toolName ?? null,
      toolInput: message.toolInput ?? null,
      toolOutput: message.toolOutput ?? null,
      toolError: message.toolError ?? null,
      createdAt: new Date(),
    };
  }

  /**
   * Get all messages for an agent session.
   *
   * @param sessionId - The ID of the session
   * @param options - Optional parameters for pagination
   * @returns Array of messages
   */
  async getMessages(
    sessionId: string,
    options?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<AgentMessage[]> {
    const params = new URLSearchParams();

    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set("offset", String(options.offset));
    }

    const queryString = params.toString();
    const path = `/api/agent/sessions/${sessionId}/history${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<SessionHistoryResponse>("GET", path);
    return response.messages.map(toAgentMessage);
  }

  /**
   * Delete an agent session and all its messages.
   *
   * @param sessionId - The ID of the session to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.request<DeleteSessionResponse>(
      "DELETE",
      `/api/agent/sessions/${sessionId}`
    );
  }

  /**
   * Update the status of an agent session.
   *
   * @param sessionId - The ID of the session
   * @param status - The new status
   */
  async updateSessionStatus(
    sessionId: string,
    status: AgentSessionStatus
  ): Promise<void> {
    await this.request<StatusResponse>(
      "PATCH",
      `/api/agent/sessions/${sessionId}/status`,
      { status }
    );
  }

  /**
   * Update the title of an agent session.
   *
   * @param sessionId - The ID of the session
   * @param title - The new title
   * @returns The updated session
   */
  async updateSessionTitle(
    sessionId: string,
    title: string
  ): Promise<AgentSession> {
    const snapshot = await this.request<ApiSessionSnapshot>(
      "PATCH",
      `/api/agent/sessions/${sessionId}/title`,
      { title }
    );
    return toAgentSession(snapshot);
  }
}

/**
 * Create a SessionClient instance with the given configuration.
 *
 * @param config - Configuration object with apiBaseUrl and authToken
 * @returns A new SessionClient instance
 */
export function createSessionClient(config: {
  apiBaseUrl: string;
  authToken: string;
}): SessionClient {
  return new SessionClient(config.apiBaseUrl, config.authToken);
}
