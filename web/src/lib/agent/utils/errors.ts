/**
 * Error classes for the agent system.
 *
 * These custom error classes provide structured error handling with
 * categorization, error codes, and retry information for the agent system.
 */

/**
 * Error codes for agent errors.
 * These codes help identify the type of error for handling and logging.
 */
export type AgentErrorCode =
  // LLM error codes
  | "LLM_API_ERROR"
  | "LLM_RATE_LIMITED"
  | "LLM_CONTEXT_LENGTH_EXCEEDED"
  | "LLM_INVALID_RESPONSE"
  | "LLM_TIMEOUT"
  | "LLM_AUTH_ERROR"
  // Tool execution error codes
  | "TOOL_NOT_FOUND"
  | "TOOL_INVALID_INPUT"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_TIMEOUT"
  | "TOOL_PERMISSION_DENIED"
  // Session error codes
  | "SESSION_NOT_FOUND"
  | "SESSION_API_ERROR"
  | "SESSION_AUTH_ERROR"
  | "SESSION_INVALID_STATE"
  // Network error codes
  | "NETWORK_ERROR"
  | "NETWORK_TIMEOUT"
  | "NETWORK_DNS_ERROR"
  | "NETWORK_CONNECTION_REFUSED"
  // General error codes
  | "UNKNOWN_ERROR";

/**
 * Base error class for all agent-related errors.
 *
 * Provides structured error information including:
 * - Error code for categorization
 * - Original cause for error chaining
 * - Retry information for transient failures
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (error instanceof AgentError && error.isRetryable) {
 *     // Retry the operation
 *   }
 * }
 * ```
 */
export class AgentError extends Error {
  /** Error code for categorization */
  public readonly code: AgentErrorCode;

  /** Original error that caused this error */
  public readonly cause: Error | undefined;

  /** Whether this error can be retried */
  public readonly isRetryable: boolean;

  /**
   * Creates a new AgentError.
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization
   * @param cause - Original error that caused this error
   * @param isRetryable - Whether this error can be retried
   */
  constructor(
    message: string,
    code: AgentErrorCode = "UNKNOWN_ERROR",
    cause?: Error,
    isRetryable: boolean = false
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.cause = cause;
    this.isRetryable = isRetryable;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Returns a JSON representation of the error.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      isRetryable: this.isRetryable,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
    };
  }
}

/**
 * Error thrown when LLM API calls fail.
 *
 * This includes rate limiting, context length issues, auth errors,
 * and other LLM-specific failures.
 *
 * @example
 * ```typescript
 * throw new LLMError(
 *   'Rate limited by API',
 *   'LLM_RATE_LIMITED',
 *   originalError,
 *   true // retryable
 * );
 * ```
 */
export class LLMError extends AgentError {
  /** HTTP status code if applicable */
  public readonly statusCode?: number;

  /** Retry-After header value in seconds (for rate limiting) */
  public readonly retryAfter?: number;

  /**
   * Creates a new LLMError.
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization
   * @param cause - Original error that caused this error
   * @param isRetryable - Whether this error can be retried
   * @param statusCode - HTTP status code if applicable
   * @param retryAfter - Retry-After header value in seconds
   */
  constructor(
    message: string,
    code: AgentErrorCode = "LLM_API_ERROR",
    cause?: Error,
    isRetryable: boolean = false,
    statusCode?: number,
    retryAfter?: number
  ) {
    super(message, code, cause, isRetryable);
    this.name = "LLMError";
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }

  /**
   * Creates an LLMError from an HTTP response.
   *
   * @param response - The HTTP response object
   * @param errorBody - The error body text
   * @returns A new LLMError with appropriate code and retryability
   */
  static fromResponse(response: Response, errorBody: string): LLMError {
    const statusCode = response.status;
    let code: AgentErrorCode = "LLM_API_ERROR";
    let isRetryable = false;
    let retryAfter: number | undefined;

    switch (statusCode) {
      case 401:
      case 403:
        code = "LLM_AUTH_ERROR";
        isRetryable = false;
        break;
      case 429:
        code = "LLM_RATE_LIMITED";
        isRetryable = true;
        // Parse Retry-After header if present
        const retryAfterHeader = response.headers.get("Retry-After");
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10);
          if (isNaN(retryAfter)) {
            // Try parsing as date
            const date = new Date(retryAfterHeader);
            if (!isNaN(date.getTime())) {
              retryAfter = Math.ceil((date.getTime() - Date.now()) / 1000);
            }
          }
        }
        break;
      case 408:
        code = "LLM_TIMEOUT";
        isRetryable = true;
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        code = "LLM_API_ERROR";
        isRetryable = true;
        break;
      default:
        // Check for context length error in body
        if (
          errorBody.toLowerCase().includes("context") &&
          errorBody.toLowerCase().includes("length")
        ) {
          code = "LLM_CONTEXT_LENGTH_EXCEEDED";
          isRetryable = false;
        }
    }

    return new LLMError(
      `LLM request failed with status ${statusCode}: ${errorBody}`,
      code,
      undefined,
      isRetryable,
      statusCode,
      retryAfter
    );
  }

  /**
   * Returns a JSON representation of the error.
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      statusCode: this.statusCode,
      retryAfter: this.retryAfter,
    };
  }
}

/**
 * Error thrown when tool execution fails.
 *
 * This includes tool not found, invalid input, execution failures,
 * and permission issues.
 *
 * @example
 * ```typescript
 * throw new ToolExecutionError(
 *   'File not found: /path/to/file',
 *   'read_file',
 *   'TOOL_EXECUTION_FAILED',
 *   originalError,
 *   false // not retryable
 * );
 * ```
 */
export class ToolExecutionError extends AgentError {
  /** Name of the tool that failed */
  public readonly toolName: string;

  /** Input that was passed to the tool */
  public readonly toolInput?: Record<string, unknown>;

  /**
   * Creates a new ToolExecutionError.
   *
   * @param message - Human-readable error message
   * @param toolName - Name of the tool that failed
   * @param code - Error code for categorization
   * @param cause - Original error that caused this error
   * @param isRetryable - Whether this error can be retried
   * @param toolInput - Input that was passed to the tool
   */
  constructor(
    message: string,
    toolName: string,
    code: AgentErrorCode = "TOOL_EXECUTION_FAILED",
    cause?: Error,
    isRetryable: boolean = false,
    toolInput?: Record<string, unknown>
  ) {
    super(message, code, cause, isRetryable);
    this.name = "ToolExecutionError";
    this.toolName = toolName;
    this.toolInput = toolInput;
  }

  /**
   * Creates a ToolExecutionError for a tool not found error.
   *
   * @param toolName - Name of the tool that was not found
   * @returns A new ToolExecutionError
   */
  static notFound(toolName: string): ToolExecutionError {
    return new ToolExecutionError(
      `Unknown tool: ${toolName}`,
      toolName,
      "TOOL_NOT_FOUND",
      undefined,
      false
    );
  }

  /**
   * Creates a ToolExecutionError for an invalid input error.
   *
   * @param toolName - Name of the tool
   * @param reason - Reason the input is invalid
   * @param toolInput - The invalid input
   * @returns A new ToolExecutionError
   */
  static invalidInput(
    toolName: string,
    reason: string,
    toolInput?: Record<string, unknown>
  ): ToolExecutionError {
    return new ToolExecutionError(
      `Invalid input for tool ${toolName}: ${reason}`,
      toolName,
      "TOOL_INVALID_INPUT",
      undefined,
      false,
      toolInput
    );
  }

  /**
   * Returns a JSON representation of the error.
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      toolName: this.toolName,
      toolInput: this.toolInput,
    };
  }
}

/**
 * Error thrown when session API calls fail.
 *
 * This includes session not found, API errors, and auth errors.
 *
 * @example
 * ```typescript
 * throw new SessionError(
 *   'Session not found',
 *   'SESSION_NOT_FOUND',
 *   originalError,
 *   false
 * );
 * ```
 */
export class SessionError extends AgentError {
  /** HTTP status code if applicable */
  public readonly statusCode?: number;

  /** Session ID if available */
  public readonly sessionId?: string;

  /**
   * Creates a new SessionError.
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization
   * @param cause - Original error that caused this error
   * @param isRetryable - Whether this error can be retried
   * @param statusCode - HTTP status code if applicable
   * @param sessionId - Session ID if available
   */
  constructor(
    message: string,
    code: AgentErrorCode = "SESSION_API_ERROR",
    cause?: Error,
    isRetryable: boolean = false,
    statusCode?: number,
    sessionId?: string
  ) {
    super(message, code, cause, isRetryable);
    this.name = "SessionError";
    this.statusCode = statusCode;
    this.sessionId = sessionId;
  }

  /**
   * Creates a SessionError from an HTTP response.
   *
   * @param response - The HTTP response object
   * @param errorBody - The error body text
   * @param sessionId - Session ID if available
   * @returns A new SessionError with appropriate code and retryability
   */
  static fromResponse(
    response: Response,
    errorBody: string,
    sessionId?: string
  ): SessionError {
    const statusCode = response.status;
    let code: AgentErrorCode = "SESSION_API_ERROR";
    let isRetryable = false;

    switch (statusCode) {
      case 401:
      case 403:
        code = "SESSION_AUTH_ERROR";
        isRetryable = false;
        break;
      case 404:
        code = "SESSION_NOT_FOUND";
        isRetryable = false;
        break;
      case 408:
      case 429:
      case 500:
      case 502:
      case 503:
      case 504:
        code = "SESSION_API_ERROR";
        isRetryable = true;
        break;
    }

    return new SessionError(
      `Session API error (${statusCode}): ${errorBody}`,
      code,
      undefined,
      isRetryable,
      statusCode,
      sessionId
    );
  }

  /**
   * Creates a SessionError for a session not found error.
   *
   * @param sessionId - The session ID that was not found
   * @returns A new SessionError
   */
  static notFound(sessionId: string): SessionError {
    return new SessionError(
      `Session not found: ${sessionId}`,
      "SESSION_NOT_FOUND",
      undefined,
      false,
      404,
      sessionId
    );
  }

  /**
   * Returns a JSON representation of the error.
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      statusCode: this.statusCode,
      sessionId: this.sessionId,
    };
  }
}

/**
 * Error thrown when network operations fail.
 *
 * This includes connection errors, DNS failures, and timeouts.
 *
 * @example
 * ```typescript
 * throw new NetworkError(
 *   'Connection refused',
 *   'NETWORK_CONNECTION_REFUSED',
 *   originalError,
 *   true // retryable
 * );
 * ```
 */
export class NetworkError extends AgentError {
  /** The URL that was being accessed when the error occurred */
  public readonly url?: string;

  /**
   * Creates a new NetworkError.
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization
   * @param cause - Original error that caused this error
   * @param isRetryable - Whether this error can be retried
   * @param url - The URL that was being accessed
   */
  constructor(
    message: string,
    code: AgentErrorCode = "NETWORK_ERROR",
    cause?: Error,
    isRetryable: boolean = true,
    url?: string
  ) {
    super(message, code, cause, isRetryable);
    this.name = "NetworkError";
    this.url = url;
  }

  /**
   * Creates a NetworkError from a fetch error.
   *
   * @param error - The original error from fetch
   * @param url - The URL that was being fetched
   * @returns A new NetworkError with appropriate code and retryability
   */
  static fromFetchError(error: Error, url?: string): NetworkError {
    const message = error.message.toLowerCase();
    let code: AgentErrorCode = "NETWORK_ERROR";
    let isRetryable = true;

    if (message.includes("timeout") || message.includes("timed out")) {
      code = "NETWORK_TIMEOUT";
      isRetryable = true;
    } else if (message.includes("dns") || message.includes("getaddrinfo")) {
      code = "NETWORK_DNS_ERROR";
      isRetryable = true;
    } else if (
      message.includes("refused") ||
      message.includes("econnrefused")
    ) {
      code = "NETWORK_CONNECTION_REFUSED";
      isRetryable = true;
    } else if (message.includes("abort")) {
      // Aborted requests should not be retried
      code = "NETWORK_ERROR";
      isRetryable = false;
    }

    return new NetworkError(
      `Network error: ${error.message}`,
      code,
      error,
      isRetryable,
      url
    );
  }

  /**
   * Returns a JSON representation of the error.
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      url: this.url,
    };
  }
}

/**
 * Type guard to check if an error is an AgentError.
 *
 * @param error - The error to check
 * @returns True if the error is an AgentError
 */
export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/**
 * Type guard to check if an error is retryable.
 *
 * @param error - The error to check
 * @returns True if the error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AgentError) {
    return error.isRetryable;
  }
  return false;
}

/**
 * Wraps an unknown error in an AgentError if it isn't already one.
 *
 * @param error - The error to wrap
 * @param defaultCode - Default error code to use
 * @returns An AgentError instance
 */
export function wrapError(
  error: unknown,
  defaultCode: AgentErrorCode = "UNKNOWN_ERROR"
): AgentError {
  if (error instanceof AgentError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgentError(error.message, defaultCode, error, false);
  }

  return new AgentError(String(error), defaultCode, undefined, false);
}
