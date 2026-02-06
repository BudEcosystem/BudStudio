/**
 * Agent utility exports.
 *
 * This module exports all utility functions and classes for the agent system,
 * including error handling, retry logic, and rate limiting.
 */

// Error classes and utilities
export {
  AgentError,
  LLMError,
  ToolExecutionError,
  SessionError,
  NetworkError,
  isAgentError,
  isRetryableError,
  wrapError,
} from "./errors";

export type { AgentErrorCode } from "./errors";

// Retry utilities
export {
  withRetry,
  withRetryResult,
  createRetryable,
  retryMethod,
  RetryExhaustedError,
} from "./retry";

export type { RetryOptions, RetryResult } from "./retry";

// Rate limiting utilities
export {
  RateLimiter,
  ToolRateLimiter,
  createToolRateLimiter,
  DEFAULT_TOOL_RATE_LIMITS,
} from "./rate-limiter";

export type {
  RateLimiterConfig,
  ToolRateLimitConfig,
  ToolRateLimiterConfig,
} from "./rate-limiter";

// Memory file detection utilities
export {
  isMemoryFile,
  getMemoryFileDescription,
  generateDiff,
  formatUnifiedDiff,
  getDiffStats,
} from "./memory-detector";

export type { DiffLine, DiffStats } from "./memory-detector";
