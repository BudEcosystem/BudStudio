/**
 * AgentExecutor - Main execution engine for BudAgent.
 *
 * The executor manages the agent's main loop, coordinating between:
 * - The LLM for decision making
 * - The tool registry for executing actions
 * - The context system for building prompts
 *
 * It yields events as an async generator, allowing real-time streaming
 * of agent activity to the frontend.
 *
 * Includes comprehensive error handling with retry logic for transient failures.
 */

import * as fs from "fs";
import { ContextBuilder } from "./context-builder";
import { LLMClient, type StreamOptions } from "./llm-client";
import type { MemorySearch } from "./memory/search";

// Debug logging to file
function debugLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync("/tmp/bud-agent-debug.log", logLine);
  } catch {
    // Ignore file write errors
  }
}
import {
  ToolRegistry,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  BashTool,
  GlobTool,
  GrepTool,
} from "./tools";
import type {
  AgentConfig,
  AgentEvent,
  AgentState,
  LLMStreamChunk,
  Message,
  RunOptions,
  ToolCall,
  ToolExecutionResult,
} from "./types";
import {
  ToolExecutionError,
  NetworkError,
  isAgentError,
  wrapError,
  type AgentErrorCode,
} from "./utils/errors";
import { withRetry, type RetryOptions } from "./utils/retry";
import {
  ToolRateLimiter,
  createToolRateLimiter,
} from "./utils/rate-limiter";

/** Default maximum number of tool calls per execution */
const DEFAULT_MAX_TOOL_CALLS = 50;

/** Default LLM model */
const DEFAULT_MODEL = "gpt-4o";

/** Default retry options for tool execution */
const DEFAULT_TOOL_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  delay: 500,
  backoff: 2,
  maxDelay: 5000,
};

/**
 * Error event with detailed information.
 */
interface DetailedError {
  message: string;
  code?: AgentErrorCode;
  isRetryable?: boolean;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

/**
 * AgentExecutor manages the execution of agent tasks.
 *
 * It implements an agentic loop that:
 * 1. Sends the conversation to the LLM
 * 2. Processes tool calls requested by the LLM
 * 3. Executes tools locally on the desktop
 * 4. Continues until the LLM provides a final response or limits are reached
 *
 * @example
 * ```typescript
 * const executor = new AgentExecutor('session-123', {
 *   workspacePath: '/path/to/project',
 *   apiBaseUrl: 'http://localhost:3000',
 *   authToken: 'bearer-token',
 * });
 *
 * for await (const event of executor.run('Help me fix the tests')) {
 *   switch (event.type) {
 *     case 'thinking':
 *       console.log('Agent is thinking...');
 *       break;
 *     case 'tool_start':
 *       console.log(`Executing ${event.toolName}...`);
 *       break;
 *     case 'complete':
 *       console.log('Done:', event.content);
 *       break;
 *   }
 * }
 * ```
 */
export class AgentExecutor {
  private state: AgentState = "idle";
  private toolRegistry: ToolRegistry;
  private toolRateLimiter: ToolRateLimiter | null = null;
  private contextBuilder: ContextBuilder;
  private llmClient: LLMClient;
  private memorySearch: MemorySearch | null = null;
  private abortController: AbortController | null = null;
  private messages: Message[] = [];
  private toolCallCount = 0;

  /**
   * Creates a new AgentExecutor.
   *
   * @param sessionId - Unique identifier for this session
   * @param config - Configuration options for the executor
   * @param memorySearch - Optional MemorySearch instance for context building
   */
  constructor(
    private sessionId: string,
    private config: AgentConfig,
    memorySearch?: MemorySearch
  ) {
    // Initialize tool registry with workspace path and API config
    this.toolRegistry = new ToolRegistry(
      config.workspacePath,
      config.apiBaseUrl,
      config.authToken
    );

    // Register default tools
    this.registerDefaultTools();

    // Initialize LLM client for streaming responses
    this.llmClient = new LLMClient(config.apiBaseUrl, config.authToken);

    // Store memory search for context building
    this.memorySearch = memorySearch ?? null;

    // Initialize context builder with workspace path and optional memory search
    this.contextBuilder = new ContextBuilder(
      config.workspacePath,
      memorySearch
    );

    // Register memory tools (with optional memorySearch for search operations)
    this.toolRegistry.registerMemoryTools(memorySearch);

    // Register Onyx search tool if API is configured
    this.toolRegistry.registerOnyxSearchTool();

    // Initialize rate limiter (null means disabled)
    if (config.rateLimitConfig === null) {
      this.toolRateLimiter = null;
    } else if (config.rateLimitConfig) {
      this.toolRateLimiter = new ToolRateLimiter(config.rateLimitConfig);
    } else {
      // Use default rate limits
      this.toolRateLimiter = createToolRateLimiter();
    }
  }

  /**
   * Register the default tools available to the agent.
   *
   * This includes:
   * - File tools: read_file, write_file, edit_file
   * - Search tools: glob, grep
   * - Bash tool: bash (requires approval)
   */
  private registerDefaultTools(): void {
    const workspacePath = this.config.workspacePath;

    // File tools
    this.toolRegistry.register(new ReadFileTool(workspacePath));
    this.toolRegistry.register(new WriteFileTool(workspacePath));
    this.toolRegistry.register(new EditFileTool(workspacePath));

    // Search tools
    this.toolRegistry.register(new GlobTool(workspacePath));
    this.toolRegistry.register(new GrepTool(workspacePath));

    // Bash tool (requires approval for safety)
    this.toolRegistry.register(new BashTool(workspacePath));
  }

  /**
   * Execute the agent loop for a user message.
   *
   * This is the main entry point for running the agent. It yields events
   * that can be used to update the UI in real-time.
   *
   * @param userMessage - The user's message/request to process
   * @param options - Optional run configuration
   * @yields AgentEvent - Events describing the agent's activity
   */
  async *run(
    userMessage: string,
    options?: RunOptions
  ): AsyncGenerator<AgentEvent> {
    // Reset state for new run
    this.state = "thinking";
    this.abortController = new AbortController();
    this.toolCallCount = 0;

    const maxToolCalls = this.config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

    try {
      // Build system prompt using ContextBuilder with memory integration
      const systemPrompt = await this.buildSystemPrompt(
        userMessage,
        options?.additionalContext,
        options?.userTimezone
      );

      // Log system prompt for debugging
      console.log("[AgentExecutor] System prompt length:", systemPrompt.length);
      console.log("[AgentExecutor] System prompt preview:", systemPrompt.substring(0, 500));
      console.log("[AgentExecutor] Registered tools:", this.toolRegistry.getAll().map(t => t.name));

      // Debug log to file
      debugLog(`System prompt length: ${systemPrompt.length}`);
      debugLog(`System prompt preview: ${systemPrompt.substring(0, 300)}`);
      debugLog(`Registered tools: ${this.toolRegistry.getAll().map(t => t.name).join(", ")}`);

      // Initialize conversation with system prompt and user message
      this.messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ];

      // Main agent loop
      while (this.toolCallCount < maxToolCalls) {
        // Check if execution was aborted
        if (this.abortController.signal.aborted) {
          this.state = "stopped";
          yield { type: "stopped" };
          yield { type: "done" };
          return;
        }

        // Yield thinking event
        yield { type: "thinking" };
        this.state = "thinking";

        // Stream LLM response
        let assistantContent = "";
        const toolCalls: ToolCall[] = [];

        // Stream LLM response from the backend
        for await (const chunk of this.streamLLMResponse(
          this.messages,
          options?.model
        )) {
          // Check abort signal during streaming
          if (this.abortController.signal.aborted) {
            this.state = "stopped";
            yield { type: "stopped" };
            yield { type: "done" };
            return;
          }

          if (chunk.type === "text") {
            assistantContent += chunk.content;
            this.state = "streaming";
            yield { type: "text", content: chunk.content };
          } else if (chunk.type === "tool_call") {
            toolCalls.push(chunk.toolCall);
          }
        }

        // Add assistant message to conversation
        const assistantMessage: Message = {
          role: "assistant",
          content: assistantContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        this.messages.push(assistantMessage);

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          this.state = "completed";
          yield { type: "complete", content: assistantContent };
          yield { type: "done" };
          return;
        }

        // Process each tool call
        for (const toolCall of toolCalls) {
          // Check abort signal before each tool
          if (this.abortController.signal.aborted) {
            this.state = "stopped";
            yield { type: "stopped" };
            yield { type: "done" };
            return;
          }

          this.toolCallCount++;
          this.state = "executing_tool";

          // Yield tool start event
          yield {
            type: "tool_start",
            toolName: toolCall.name,
            toolInput: toolCall.input,
            toolCallId: toolCall.id,
          };

          // Check if tool requires approval
          const tool = this.toolRegistry.get(toolCall.name);
          const requiresApproval =
            tool?.requiresApproval && !this.config.autoApprove;

          if (requiresApproval) {
            this.state = "waiting_approval";
            yield {
              type: "approval_required",
              toolName: toolCall.name,
              toolInput: toolCall.input,
              toolCallId: toolCall.id,
            };

            // If we have an approval callback, use it
            if (options?.onApprovalNeeded) {
              const approved = await options.onApprovalNeeded(
                toolCall.name,
                toolCall.input,
                toolCall.id
              );
              if (!approved) {
                // Add a tool result indicating rejection
                this.messages.push({
                  role: "tool",
                  content: "Tool execution was rejected by user",
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                  toolInput: toolCall.input,
                  toolOutput: "Tool execution was rejected by user",
                });
                continue;
              }
            }
            // If no callback, we'll wait for external approval mechanism
            // For now, continue with execution (this will be enhanced later)
          }

          // Execute the tool locally
          const result = await this.executeToolLocally(toolCall);

          // Yield tool result event
          yield {
            type: "tool_result",
            toolName: toolCall.name,
            toolOutput: result.output,
            toolError: result.error,
            toolCallId: toolCall.id,
          };

          // Add tool result to conversation
          this.messages.push({
            role: "tool",
            content: result.error
              ? `Error: ${result.error}`
              : result.output,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolInput: toolCall.input,
            toolOutput: result.output,
          });
        }

        // Continue the loop to get the next LLM response
      }

      // Reached max tool calls
      this.state = "completed";
      yield {
        type: "error",
        error: `Maximum tool calls (${maxToolCalls}) reached`,
      };
      yield { type: "done" };
    } catch (error) {
      this.state = "failed";
      const errorEvent = this.createErrorEvent(error);
      yield errorEvent;
      yield { type: "done" };
    }
  }

  /**
   * Create a detailed error event from an error.
   *
   * @param error - The error to convert
   * @param toolName - Optional tool name for tool errors
   * @param toolInput - Optional tool input for tool errors
   * @returns An AgentEvent with detailed error information
   */
  private createErrorEvent(
    error: unknown,
    toolName?: string,
    toolInput?: Record<string, unknown>
  ): AgentEvent {
    const details: DetailedError = {
      message: "Unknown error occurred",
    };

    if (isAgentError(error)) {
      details.message = error.message;
      details.code = error.code;
      details.isRetryable = error.isRetryable;

      if (error instanceof ToolExecutionError) {
        details.toolName = error.toolName;
        details.toolInput = error.toolInput;
      }
    } else if (error instanceof Error) {
      details.message = error.message;
    } else {
      details.message = String(error);
    }

    // Override with provided tool context if available
    if (toolName) {
      details.toolName = toolName;
    }
    if (toolInput) {
      details.toolInput = toolInput;
    }

    return {
      type: "error",
      error: details.message,
      details,
    };
  }

  /**
   * Build the system prompt for the agent using ContextBuilder.
   *
   * The ContextBuilder assembles the prompt from:
   * - SOUL.md (agent identity)
   * - USER.md (user context)
   * - Memory recall instructions
   * - Relevant memories (if available)
   * - Available tools
   * - Behavioral guidelines
   * - Time and workspace info
   *
   * @param userMessage - The user's message for context-relevant memory retrieval
   * @param additionalContext - Optional additional context to include
   * @param userTimezone - Optional user timezone for temporal awareness
   * @returns The system prompt string
   */
  private async buildSystemPrompt(
    userMessage: string,
    additionalContext?: string,
    userTimezone?: string
  ): Promise<string> {
    return this.contextBuilder.build({
      tools: this.toolRegistry.getAll(),
      userMessage,
      userTimezone,
      additionalContext,
    });
  }

  /**
   * Stream LLM response for the given messages.
   *
   * Uses the LLMClient to call the remote Onyx backend and stream
   * text content and tool calls from the LLM.
   *
   * @param messages - The conversation history to send to the LLM
   * @param model - Optional model override
   * @yields LLMStreamChunk - Chunks of the LLM response
   */
  private async *streamLLMResponse(
    messages: Message[],
    model?: string
  ): AsyncGenerator<LLMStreamChunk> {
    // Extract system prompt from messages if present
    const systemMessage = messages.find((m) => m.role === "system");
    const systemPrompt = systemMessage?.content;

    // Debug log
    debugLog(`streamLLMResponse: systemPrompt exists: ${!!systemPrompt}`);
    debugLog(`streamLLMResponse: systemPrompt length: ${systemPrompt?.length ?? 0}`);
    debugLog(`streamLLMResponse: systemPrompt preview: ${systemPrompt?.substring(0, 200) ?? "NONE"}`);

    // Filter out system message from messages (it will be sent via options.systemPrompt)
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const streamOptions: StreamOptions = {
      model: model ?? this.config.model ?? DEFAULT_MODEL,
      tools: this.toolRegistry.getSchemas(),
      signal: this.abortController?.signal,
      systemPrompt,
    };

    debugLog(`streamLLMResponse: streamOptions.systemPrompt is set: ${!!streamOptions.systemPrompt}`);

    // Stream from the LLM client
    for await (const chunk of this.llmClient.stream(
      conversationMessages,
      streamOptions
    )) {
      yield chunk;
    }
  }

  /**
   * Execute a tool locally on the desktop with retry logic.
   *
   * This method implements intelligent retry behavior for transient failures:
   * - Network errors are retried with exponential backoff
   * - Tool not found errors are not retried
   * - Other errors are checked for retryability
   *
   * @param toolCall - The tool call to execute
   * @returns The result of the tool execution
   */
  private async executeToolLocally(
    toolCall: ToolCall
  ): Promise<ToolExecutionResult> {
    const tool = this.toolRegistry.get(toolCall.name);

    if (!tool) {
      const error = ToolExecutionError.notFound(toolCall.name);
      return {
        output: "",
        error: error.message,
      };
    }

    // Acquire rate limit tokens before executing the tool
    if (this.toolRateLimiter) {
      await this.toolRateLimiter.acquireForTool(toolCall.name);
    }

    // Determine if this tool supports retry
    // Tools that modify state (write, delete) should generally not be retried
    // to avoid duplicate operations
    const isIdempotent = this.isToolIdempotent(toolCall.name);

    if (!isIdempotent) {
      // Execute without retry for non-idempotent tools
      return this.executeToolOnce(tool, toolCall);
    }

    // Execute with retry for idempotent tools
    try {
      const output = await withRetry(
        async () => {
          try {
            return await tool.execute(toolCall.input);
          } catch (error) {
            // Wrap the error in a ToolExecutionError for proper categorization
            if (error instanceof Error) {
              const toolError = new ToolExecutionError(
                error.message,
                toolCall.name,
                this.categorizeToolError(error),
                error,
                this.isToolErrorRetryable(error),
                toolCall.input
              );
              throw toolError;
            }
            throw error;
          }
        },
        {
          ...DEFAULT_TOOL_RETRY_OPTIONS,
          shouldRetry: (error: Error) => {
            // Don't retry if we're aborting
            if (this.abortController?.signal.aborted) {
              return false;
            }

            if (error instanceof ToolExecutionError) {
              return error.isRetryable;
            }

            if (error instanceof NetworkError) {
              return error.isRetryable;
            }

            // Default to not retrying unknown errors
            return false;
          },
          onRetry: (error: Error, attempt: number, delay: number) => {
            console.warn(
              `Tool ${toolCall.name} retry ${attempt}: ${error.message} (waiting ${delay}ms)`
            );
          },
          signal: this.abortController?.signal,
        }
      );

      return { output };
    } catch (error) {
      // Extract the error message and return as result
      const agentError = wrapError(error);
      return {
        output: "",
        error: agentError.message,
      };
    }
  }

  /**
   * Execute a tool once without retry logic.
   *
   * @param tool - The tool to execute
   * @param toolCall - The tool call details
   * @returns The result of the tool execution
   */
  private async executeToolOnce(
    tool: { execute: (input: Record<string, unknown>) => Promise<string> },
    toolCall: ToolCall
  ): Promise<ToolExecutionResult> {
    try {
      const output = await tool.execute(toolCall.input);
      return { output };
    } catch (error) {
      const agentError =
        error instanceof Error
          ? new ToolExecutionError(
              error.message,
              toolCall.name,
              this.categorizeToolError(error),
              error,
              false,
              toolCall.input
            )
          : wrapError(error);

      return {
        output: "",
        error: agentError.message,
      };
    }
  }

  /**
   * Check if a tool is idempotent (safe to retry).
   *
   * Idempotent tools produce the same result regardless of how many
   * times they are executed with the same input.
   *
   * @param toolName - The name of the tool
   * @returns True if the tool is idempotent
   */
  private isToolIdempotent(toolName: string): boolean {
    // Read-only tools are always idempotent
    const readOnlyTools = [
      "read_file",
      "glob",
      "grep",
      "onyx_search",
      "memory_search",
      "memory_get",
    ];

    if (readOnlyTools.includes(toolName)) {
      return true;
    }

    // Write tools are generally not idempotent
    const writeTools = [
      "write_file",
      "edit_file",
      "bash",
      "delete_file",
    ];

    if (writeTools.includes(toolName)) {
      return false;
    }

    // Default to not idempotent for unknown tools
    return false;
  }

  /**
   * Categorize a tool error based on its characteristics.
   *
   * @param error - The error to categorize
   * @returns The appropriate error code
   */
  private categorizeToolError(error: Error): AgentErrorCode {
    const message = error.message.toLowerCase();

    // Check for common error patterns
    if (message.includes("not found") || message.includes("enoent")) {
      return "TOOL_EXECUTION_FAILED";
    }

    if (message.includes("permission") || message.includes("eacces")) {
      return "TOOL_PERMISSION_DENIED";
    }

    if (message.includes("timeout") || message.includes("timed out")) {
      return "TOOL_TIMEOUT";
    }

    if (
      message.includes("invalid") ||
      message.includes("required") ||
      message.includes("missing")
    ) {
      return "TOOL_INVALID_INPUT";
    }

    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("connection")
    ) {
      return "NETWORK_ERROR";
    }

    return "TOOL_EXECUTION_FAILED";
  }

  /**
   * Check if a tool error is retryable.
   *
   * @param error - The error to check
   * @returns True if the error is retryable
   */
  private isToolErrorRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Network errors are usually retryable
    if (
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("econnrefused") ||
      message.includes("econnreset")
    ) {
      return true;
    }

    // Timeout errors are usually retryable
    if (message.includes("timeout") || message.includes("timed out")) {
      return true;
    }

    // File not found, permission errors, and invalid input are not retryable
    if (
      message.includes("not found") ||
      message.includes("enoent") ||
      message.includes("permission") ||
      message.includes("eacces") ||
      message.includes("invalid")
    ) {
      return false;
    }

    // Default to not retryable
    return false;
  }

  /**
   * Stop the current execution.
   *
   * This will abort any in-progress operations and stop the agent loop.
   */
  stop(): void {
    this.abortController?.abort();
    this.state = "stopped";
  }

  /**
   * Get the current state of the executor.
   *
   * @returns The current AgentState
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Get the current conversation messages.
   *
   * @returns A copy of the messages array
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get the session ID for this executor.
   *
   * @returns The session ID string
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the tool registry for this executor.
   *
   * @returns The ToolRegistry instance
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Get the number of tool calls made in the current run.
   *
   * @returns The tool call count
   */
  getToolCallCount(): number {
    return this.toolCallCount;
  }

  /**
   * Get the tool rate limiter for this executor.
   *
   * @returns The ToolRateLimiter instance, or null if rate limiting is disabled
   */
  getToolRateLimiter(): ToolRateLimiter | null {
    return this.toolRateLimiter;
  }

  /**
   * Get the memory search instance for this executor.
   *
   * @returns The MemorySearch instance, or null if not configured
   */
  getMemorySearch(): MemorySearch | null {
    return this.memorySearch;
  }

  /**
   * Set the memory search instance for this executor.
   *
   * This allows lazy initialization of the memory search after construction.
   * Also updates the context builder with the new memory search instance.
   *
   * @param memorySearch - The MemorySearch instance to use
   */
  setMemorySearch(memorySearch: MemorySearch): void {
    this.memorySearch = memorySearch;
    // Recreate context builder with updated memory search
    this.contextBuilder = new ContextBuilder(
      this.config.workspacePath,
      memorySearch
    );
  }

  /**
   * Get the context builder for this executor.
   *
   * @returns The ContextBuilder instance
   */
  getContextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }

  /**
   * Get the LLM client for this executor.
   *
   * @returns The LLMClient instance
   */
  getLLMClient(): LLMClient {
    return this.llmClient;
  }
}
