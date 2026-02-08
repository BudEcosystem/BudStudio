/**
 * Type definitions for BudAgent executor and message handling.
 *
 * These types define the core data structures used throughout the agent system
 * including state management, configuration, messages, and events.
 */

import type { AgentErrorCode } from "./utils/errors";
import type { ToolRateLimiterConfig } from "./utils/rate-limiter";

/**
 * Represents the current state of the agent executor.
 *
 * State transitions:
 * - idle -> thinking (when run() is called)
 * - thinking -> executing_tool (when LLM requests tool call)
 * - thinking -> streaming (when LLM streams text response)
 * - thinking -> completed (when LLM provides final response)
 * - executing_tool -> waiting_approval (if tool requires approval)
 * - executing_tool -> thinking (after tool execution, continues loop)
 * - waiting_approval -> executing_tool (after approval granted)
 * - waiting_approval -> stopped (if approval denied)
 * - any state -> stopped (when stop() is called)
 * - any state -> failed (on unrecoverable error)
 */
export type AgentState =
  | "idle"
  | "thinking"
  | "executing_tool"
  | "waiting_approval"
  | "streaming"
  | "completed"
  | "failed"
  | "stopped";

/**
 * Configuration for the AgentExecutor.
 */
export interface AgentConfig {
  /** Path to the workspace directory for file operations */
  workspacePath: string;
  /** Base URL for backend API calls */
  apiBaseUrl: string;
  /** Authentication token for API calls */
  authToken: string;
  /** Maximum number of tool calls before stopping. Default: 50 */
  maxToolCalls?: number;
  /** Whether to auto-approve tool calls that require approval. Default: false */
  autoApprove?: boolean;
  /** LLM model to use for the agent. Default: 'gpt-4o' */
  model?: string;
  /**
   * Rate limit configuration for tool calls.
   * If not provided, uses default rate limits.
   * Set to null to disable rate limiting entirely.
   */
  rateLimitConfig?: ToolRateLimiterConfig | null;
}

/**
 * Represents a message in the conversation history.
 *
 * Messages can be from the system, user, assistant (LLM), or tool results.
 */
export interface Message {
  /** The role of the message sender */
  role: "system" | "user" | "assistant" | "tool";
  /** The text content of the message */
  content: string;
  /** Tool calls requested by the assistant (only for assistant messages) */
  toolCalls?: ToolCall[];
  /** ID of the tool call this message is responding to (only for tool messages) */
  toolCallId?: string;
  /** Name of the tool that was called (only for tool messages) */
  toolName?: string;
  /** Input parameters passed to the tool (only for tool messages) */
  toolInput?: Record<string, unknown>;
  /** Output/result from the tool execution (only for tool messages) */
  toolOutput?: string;
}

/**
 * Represents a tool call requested by the LLM.
 */
export interface ToolCall {
  /** Unique identifier for this tool call */
  id: string;
  /** Name of the tool to execute */
  name: string;
  /** Input parameters for the tool */
  input: Record<string, unknown>;
}

/**
 * Detailed error information for error events.
 */
export interface ErrorDetails {
  /** Human-readable error message */
  message: string;
  /** Error code for categorization */
  code?: AgentErrorCode;
  /** Whether the error is retryable */
  isRetryable?: boolean;
  /** Tool name if the error occurred during tool execution */
  toolName?: string;
  /** Tool input if the error occurred during tool execution */
  toolInput?: Record<string, unknown>;
}

/**
 * Events emitted by the AgentExecutor during execution.
 *
 * These events are yielded by the run() async generator and can be used
 * to update the UI in real-time as the agent processes a request.
 */
export type AgentEvent =
  | { type: "thinking" }
  | { type: "text"; content: string }
  | {
      type: "tool_start";
      toolName: string;
      toolInput: Record<string, unknown>;
      toolCallId: string;
    }
  | {
      type: "tool_result";
      toolName: string;
      toolOutput: string;
      toolError?: string;
      toolCallId: string;
    }
  | {
      type: "approval_required";
      toolName: string;
      toolInput: Record<string, unknown>;
      toolCallId: string;
    }
  | { type: "complete"; content: string }
  | { type: "error"; error: string; details?: ErrorDetails }
  | { type: "stopped" }
  | { type: "done" }
  | { type: "session_compacted"; newSessionId: string; summary: string };

/**
 * Chunks received from the LLM during streaming.
 *
 * The LLM can stream either text content or tool call requests.
 */
export type LLMStreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; toolCall: ToolCall };

/**
 * Result of executing a tool.
 */
export interface ToolExecutionResult {
  /** The output from the tool execution */
  output: string;
  /** Error message if the tool execution failed */
  error?: string;
}

/**
 * Options for the agent run.
 */
export interface RunOptions {
  /** Additional context to include in the system prompt */
  additionalContext?: string;
  /** Override the default model for this run */
  model?: string;
  /** User's timezone for temporal awareness (e.g., 'America/New_York') */
  userTimezone?: string;
  /** Callback for when approval is needed */
  onApprovalNeeded?: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolCallId: string
  ) => Promise<boolean>;
}
