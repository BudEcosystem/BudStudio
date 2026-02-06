/**
 * LLM Client for BudAgent - Calls remote Onyx backend for LLM streaming.
 *
 * This client handles communication with the Onyx chat API to get LLM responses
 * with support for streaming, tool calls, cancellation, and retry logic.
 */

import * as fs from "fs";
import type { ToolSchema } from "./tools/base";
import type { LLMStreamChunk, Message, ToolCall } from "./types";
import { LLMError, NetworkError } from "./utils/errors";
import { withRetry, type RetryOptions } from "./utils/retry";

// Debug logging to file
function debugLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [LLMClient] ${message}\n`;
  try {
    fs.appendFileSync("/tmp/bud-agent-debug.log", logLine);
  } catch {
    // Ignore file write errors
  }
}

/**
 * Options for streaming LLM requests.
 */
export interface StreamOptions {
  /** LLM model to use (e.g., 'gpt-4o', 'claude-3-opus') */
  model?: string;
  /** Tool schemas available for the LLM to call */
  tools?: ToolSchema[];
  /** AbortSignal for cancelling the request */
  signal?: AbortSignal;
  /** Temperature for response randomness (0-2) */
  temperature?: number;
  /** System prompt override */
  systemPrompt?: string;
  /** Chat session ID for the Onyx backend */
  chatSessionId?: string;
  /** Parent message ID for threading */
  parentMessageId?: number | null;
  /** Retry options for transient failures */
  retryOptions?: RetryOptions;
}

/**
 * Packet types from the Onyx streaming API.
 * These match the backend streaming_models.py definitions.
 */
interface MessageDeltaPacket {
  ind: number;
  obj: {
    type: "message_delta";
    content: string;
  };
}

interface MessageStartPacket {
  ind: number;
  obj: {
    type: "message_start";
    content: string;
    final_documents: unknown[] | null;
  };
}

interface ToolCallPacket {
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
}

interface ErrorPacket {
  error: string;
  stack_trace?: string;
  auth_error?: boolean;
}

interface StopPacket {
  ind: number;
  obj: {
    type: "stop";
  };
}

interface AnswerPiecePacket {
  answer_piece: string;
}

interface MessageResponseIDPacket {
  user_message_id: number | null;
  reserved_assistant_message_id: number;
}

/** Union type for all possible packet types */
type StreamPacket =
  | MessageDeltaPacket
  | MessageStartPacket
  | StopPacket
  | ToolCallPacket
  | ErrorPacket
  | AnswerPiecePacket
  | MessageResponseIDPacket
  | Record<string, unknown>;

/**
 * Parse a line from the streaming response.
 */
function parseStreamLine(line: string): StreamPacket | null {
  if (!line || line.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(line) as StreamPacket;
  } catch {
    // Try to extract JSON object if the line contains one
    const jsonMatch = line.match(/\{[^{}]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as StreamPacket;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Check if a packet is a message delta packet.
 */
function isMessageDeltaPacket(packet: StreamPacket): packet is MessageDeltaPacket {
  return (
    "ind" in packet &&
    "obj" in packet &&
    typeof packet.obj === "object" &&
    packet.obj !== null &&
    "type" in packet.obj &&
    packet.obj.type === "message_delta"
  );
}

/**
 * Check if a packet is a message start packet.
 */
function isMessageStartPacket(packet: StreamPacket): packet is MessageStartPacket {
  return (
    "ind" in packet &&
    "obj" in packet &&
    typeof packet.obj === "object" &&
    packet.obj !== null &&
    "type" in packet.obj &&
    packet.obj.type === "message_start"
  );
}

/**
 * Check if a packet is an answer piece packet.
 */
function isAnswerPiecePacket(packet: StreamPacket): packet is AnswerPiecePacket {
  return "answer_piece" in packet && typeof packet.answer_piece === "string";
}

/**
 * Check if a packet is a tool call packet.
 */
function isToolCallPacket(packet: StreamPacket): packet is ToolCallPacket {
  return (
    "tool_name" in packet &&
    "tool_args" in packet &&
    typeof packet.tool_name === "string"
  );
}

/**
 * Check if a packet is an error packet.
 */
function isErrorPacket(packet: StreamPacket): packet is ErrorPacket {
  return "error" in packet && typeof packet.error === "string";
}

/**
 * Check if a packet is a stop packet.
 */
function isStopPacket(packet: StreamPacket): packet is StopPacket {
  return (
    "ind" in packet &&
    "obj" in packet &&
    typeof packet.obj === "object" &&
    packet.obj !== null &&
    "type" in packet.obj &&
    packet.obj.type === "stop"
  );
}

/** Default retry options for LLM requests */
const DEFAULT_LLM_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  delay: 1000,
  backoff: 2,
  maxDelay: 30000,
};

/** Longer retry options for rate-limited requests */
const RATE_LIMIT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 5,
  delay: 5000, // Start with 5 seconds for rate limits
  backoff: 2,
  maxDelay: 60000, // Up to 1 minute
};

/**
 * LLMClient handles communication with the Onyx backend for LLM inference.
 *
 * It provides a streaming interface that yields text and tool call chunks
 * as they arrive from the backend. Includes retry logic for transient failures
 * and proper error categorization.
 *
 * @example
 * ```typescript
 * const client = new LLMClient('http://localhost:3000', 'bearer-token');
 *
 * const messages = [
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'Hello!' }
 * ];
 *
 * for await (const chunk of client.stream(messages, { model: 'gpt-4o' })) {
 *   if (chunk.type === 'text') {
 *     process.stdout.write(chunk.content);
 *   } else if (chunk.type === 'tool_call') {
 *     console.log('Tool call:', chunk.toolCall);
 *   }
 * }
 * ```
 */
export class LLMClient {
  /** Cached chat session ID for reuse within the same client */
  private chatSessionId: string | null = null;

  /**
   * Creates a new LLMClient.
   *
   * @param apiBaseUrl - Base URL of the Onyx backend API
   * @param authToken - Authentication token for API requests
   */
  constructor(
    private apiBaseUrl: string,
    private authToken: string
  ) {}

  /**
   * Create a new chat session for the Onyx backend.
   *
   * @param personaId - Optional persona ID (defaults to 0 for default persona)
   * @returns The chat session ID
   */
  async createChatSession(personaId: number = 0): Promise<string> {
    const baseUrl = this.apiBaseUrl.replace(/\/api\/?$/, "");
    const url = `${baseUrl}/api/chat/create-chat-session`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.authToken) {
      headers["Cookie"] = this.authToken;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        persona_id: personaId,
        description: null,
        project_id: null,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new LLMError(
        `Failed to create chat session: ${errorText}`,
        "LLM_API_ERROR",
        undefined, // cause
        false, // isRetryable
        response.status // statusCode
      );
    }

    const data = await response.json();
    return data.chat_session_id;
  }

  /**
   * Get or create a chat session ID.
   * Caches the session ID for reuse within the same client instance.
   *
   * @param personaId - Optional persona ID
   * @returns The chat session ID
   */
  async getOrCreateChatSession(personaId: number = 0): Promise<string> {
    if (!this.chatSessionId) {
      this.chatSessionId = await this.createChatSession(personaId);
    }
    return this.chatSessionId;
  }

  /**
   * Stream a chat completion from the Onyx backend.
   *
   * This method calls the Onyx chat API and yields chunks as they arrive.
   * It supports both text streaming and tool calls.
   *
   * @param messages - The conversation history
   * @param options - Optional streaming configuration
   * @yields LLMStreamChunk - Text content or tool call chunks
   * @throws Error if the request fails or is aborted
   */
  async *stream(
    messages: Message[],
    options?: StreamOptions
  ): AsyncGenerator<LLMStreamChunk> {
    // Ensure we have a chat session ID
    let chatSessionId = options?.chatSessionId;
    if (!chatSessionId) {
      chatSessionId = await this.getOrCreateChatSession();
    }

    // Build URL, avoiding double /api/ if base URL already ends with /api
    const baseUrl = this.apiBaseUrl.replace(/\/api\/?$/, "");
    const url = `${baseUrl}/api/chat/send-message`;

    // Build the request payload with the session ID
    const payload = this.buildPayload(messages, { ...options, chatSessionId });

    // Make the streaming request
    const response = await this.makeStreamingRequest(url, payload, options?.signal);

    // Process the streaming response
    yield* this.processStreamResponse(response, options?.signal);
  }

  /**
   * Build the request payload for the Onyx chat API.
   */
  private buildPayload(
    messages: Message[],
    options?: StreamOptions
  ): Record<string, unknown> {
    // Extract the last user message as the main message
    const userMessages = messages.filter((m) => m.role === "user");
    const lastUserMessage = userMessages[userMessages.length - 1];
    const message = lastUserMessage?.content ?? "";

    // Debug logging
    debugLog(`Building payload with systemPrompt: ${options?.systemPrompt ? options.systemPrompt.substring(0, 200) + "..." : "NO SYSTEM PROMPT"}`);
    debugLog(`Messages count: ${messages.length}`);
    debugLog(`User message: ${message.substring(0, 100)}`);

    // Build the payload matching the CreateChatMessageRequest format
    const payload: Record<string, unknown> = {
      chat_session_id: options?.chatSessionId ?? "",
      parent_message_id: options?.parentMessageId ?? null,
      message,
      prompt_id: null,
      search_doc_ids: null,
      file_descriptors: [],
      regenerate: false,
      retrieval_options: {
        run_search: "auto",
        real_time: true,
        filters: null,
      },
      query_override: null,
      prompt_override: options?.systemPrompt
        ? { system_prompt: options.systemPrompt }
        : null,
      llm_override: options?.model || options?.temperature
        ? {
            temperature: options.temperature,
            model_version: options.model,
          }
        : null,
      use_existing_user_message: false,
      use_agentic_search: false,
    };

    // Add tools if provided
    if (options?.tools && options.tools.length > 0) {
      payload.tools = options.tools;
    }

    // Log the prompt_override being sent
    debugLog(`prompt_override is set: ${!!payload.prompt_override}`);
    if (payload.prompt_override) {
      const po = payload.prompt_override as { system_prompt?: string };
      debugLog(`prompt_override.system_prompt length: ${po.system_prompt?.length ?? 0}`);
      debugLog(`prompt_override.system_prompt preview: ${po.system_prompt?.substring(0, 150) ?? "NONE"}`);
    }

    return payload;
  }

  /**
   * Make the streaming HTTP request to the Onyx backend with retry logic.
   *
   * This method implements intelligent retry behavior:
   * - Retries transient failures (5xx, network errors)
   * - Uses longer delays for rate limiting (429)
   * - Does not retry auth errors or invalid requests
   *
   * @param url - The URL to fetch
   * @param payload - The request payload
   * @param signal - Optional AbortSignal
   * @param retryOptions - Optional retry configuration override
   * @returns The Response object
   * @throws LLMError for LLM-specific failures
   * @throws NetworkError for network failures
   */
  private async makeStreamingRequest(
    url: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
    retryOptions?: RetryOptions
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // The authToken is actually a cookie string (format: "cookie1=value1; cookie2=value2")
    // that needs to be sent as a Cookie header for session-based auth
    if (this.authToken) {
      headers["Cookie"] = this.authToken;
    }

    // Use retry logic for the fetch request
    const effectiveRetryOptions = retryOptions ?? DEFAULT_LLM_RETRY_OPTIONS;

    return withRetry(
      async () => {
        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal,
          });
        } catch (error) {
          // Convert fetch errors to NetworkError
          if (error instanceof Error) {
            throw NetworkError.fromFetchError(error, url);
          }
          throw error;
        }

        if (!response.ok) {
          const errorText = await response.text();
          const llmError = LLMError.fromResponse(response, errorText);

          // For rate limiting, throw with a hint to use longer delays
          if (response.status === 429) {
            // If we have a retry-after value, adjust delay accordingly
            if (llmError.retryAfter && llmError.retryAfter > 0) {
              // The error is retryable, the retry logic will handle delays
            }
          }

          throw llmError;
        }

        return response;
      },
      {
        ...effectiveRetryOptions,
        // Custom shouldRetry that handles LLM-specific errors
        shouldRetry: (error: Error) => {
          // Don't retry if aborted
          if (signal?.aborted) {
            return false;
          }

          // Use default retry logic for errors
          if (error instanceof LLMError) {
            // For rate limiting, always retry with longer delays
            if (error.code === "LLM_RATE_LIMITED") {
              return true;
            }
            return error.isRetryable;
          }

          if (error instanceof NetworkError) {
            return error.isRetryable;
          }

          return false;
        },
        // Callback for logging/monitoring
        onRetry: (error: Error, attempt: number, delay: number) => {
          console.warn(
            `LLM request retry ${attempt}: ${error.message} (waiting ${delay}ms)`
          );
        },
        signal,
      }
    );
  }

  /**
   * Make a streaming request with rate-limit-aware retry options.
   *
   * This is a convenience method for cases where rate limiting is expected.
   */
  private async makeStreamingRequestWithRateLimitRetry(
    url: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Response> {
    return this.makeStreamingRequest(
      url,
      payload,
      signal,
      RATE_LIMIT_RETRY_OPTIONS
    );
  }

  /**
   * Process the streaming response and yield LLMStreamChunk events.
   */
  private async *processStreamResponse(
    response: Response,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    // Track accumulated tool calls for proper yielding
    const pendingToolCalls: Map<string, ToolCall> = new Map();

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        reader.cancel().catch(() => {
          // Ignore cancel errors
        });
      });
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Split by newlines and process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const packet = parseStreamLine(line);
          if (!packet) {
            continue;
          }

          // Process the packet and yield appropriate chunks
          const chunks = this.processPacket(packet, pendingToolCalls);
          for (const chunk of chunks) {
            yield chunk;
          }
        }
      }

      // Process any remaining buffer content
      if (buffer.trim()) {
        const packet = parseStreamLine(buffer);
        if (packet) {
          const chunks = this.processPacket(packet, pendingToolCalls);
          for (const chunk of chunks) {
            yield chunk;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Process a single packet and return any resulting chunks.
   */
  private processPacket(
    packet: StreamPacket,
    pendingToolCalls: Map<string, ToolCall>
  ): LLMStreamChunk[] {
    const chunks: LLMStreamChunk[] = [];

    // Handle message delta packets (streaming text)
    if (isMessageDeltaPacket(packet)) {
      if (packet.obj.content) {
        chunks.push({ type: "text", content: packet.obj.content });
      }
    }
    // Handle message start packets
    else if (isMessageStartPacket(packet)) {
      if (packet.obj.content) {
        chunks.push({ type: "text", content: packet.obj.content });
      }
    }
    // Handle answer piece packets (alternative text streaming format)
    else if (isAnswerPiecePacket(packet)) {
      if (packet.answer_piece) {
        chunks.push({ type: "text", content: packet.answer_piece });
      }
    }
    // Handle tool call packets
    else if (isToolCallPacket(packet)) {
      const toolCallId = this.generateToolCallId();
      const toolCall: ToolCall = {
        id: toolCallId,
        name: packet.tool_name,
        input: packet.tool_args as Record<string, unknown>,
      };
      pendingToolCalls.set(toolCallId, toolCall);
      chunks.push({ type: "tool_call", toolCall });
    }
    // Handle error packets
    else if (isErrorPacket(packet)) {
      // Check for auth errors
      if (packet.auth_error) {
        throw new LLMError(
          packet.error,
          "LLM_AUTH_ERROR",
          undefined,
          false
        );
      }

      // Try to categorize the error
      const errorLower = packet.error.toLowerCase();
      if (errorLower.includes("rate") && errorLower.includes("limit")) {
        throw new LLMError(packet.error, "LLM_RATE_LIMITED", undefined, true);
      }
      if (
        errorLower.includes("context") &&
        errorLower.includes("length")
      ) {
        throw new LLMError(
          packet.error,
          "LLM_CONTEXT_LENGTH_EXCEEDED",
          undefined,
          false
        );
      }
      if (errorLower.includes("timeout")) {
        throw new LLMError(packet.error, "LLM_TIMEOUT", undefined, true);
      }

      // Default to non-retryable LLM error
      throw new LLMError(packet.error, "LLM_API_ERROR", undefined, false);
    }
    // Stop packet signals end of stream (no action needed)
    else if (isStopPacket(packet)) {
      // Stream complete
    }

    return chunks;
  }

  /**
   * Generate a unique ID for tool calls.
   */
  private generateToolCallId(): string {
    return `tool_call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Create a simple completion without streaming.
 *
 * This is a convenience function for cases where streaming is not needed.
 *
 * @param client - The LLMClient to use
 * @param messages - The conversation history
 * @param options - Optional configuration
 * @returns The complete response content
 */
export async function complete(
  client: LLMClient,
  messages: Message[],
  options?: StreamOptions
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  let content = "";
  const toolCalls: ToolCall[] = [];

  for await (const chunk of client.stream(messages, options)) {
    if (chunk.type === "text") {
      content += chunk.content;
    } else if (chunk.type === "tool_call") {
      toolCalls.push(chunk.toolCall);
    }
  }

  return { content, toolCalls };
}
