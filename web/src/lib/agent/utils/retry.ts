/**
 * Retry utility for the agent system.
 *
 * Provides a flexible retry mechanism with exponential backoff
 * for handling transient failures in async operations.
 */

import { isRetryableError } from "./errors";

/**
 * Options for the retry mechanism.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries?: number;

  /** Initial delay in milliseconds before first retry. Default: 1000 */
  delay?: number;

  /** Backoff multiplier for exponential backoff. Default: 2 */
  backoff?: number;

  /** Maximum delay in milliseconds between retries. Default: 30000 */
  maxDelay?: number;

  /**
   * Custom function to determine if an error should be retried.
   * If not provided, uses isRetryableError from the errors module.
   */
  shouldRetry?: (error: Error) => boolean;

  /**
   * Callback called before each retry attempt.
   * Can be used for logging or metrics.
   */
  onRetry?: (error: Error, attempt: number, delay: number) => void;

  /**
   * AbortSignal to cancel the retry operation.
   */
  signal?: AbortSignal;
}

/**
 * Default retry options.
 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry" | "signal">> = {
  maxRetries: 3,
  delay: 1000,
  backoff: 2,
  maxDelay: 30000,
  shouldRetry: isRetryableError,
};

/**
 * Result of a retry operation with metadata.
 */
export interface RetryResult<T> {
  /** The successful result value */
  result: T;

  /** Number of attempts made (1 = succeeded on first try) */
  attempts: number;

  /** Total time spent including delays (milliseconds) */
  totalTime: number;
}

/**
 * Error thrown when all retry attempts are exhausted.
 */
export class RetryExhaustedError extends Error {
  /** The last error that occurred */
  public readonly lastError: Error;

  /** Number of attempts made */
  public readonly attempts: number;

  /**
   * Creates a new RetryExhaustedError.
   *
   * @param lastError - The last error that occurred
   * @param attempts - Number of attempts made
   */
  constructor(lastError: Error, attempts: number) {
    super(
      `All ${attempts} retry attempts exhausted. Last error: ${lastError.message}`
    );
    this.name = "RetryExhaustedError";
    this.lastError = lastError;
    this.attempts = attempts;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Calculate the delay for a specific retry attempt using exponential backoff.
 *
 * @param attempt - The current attempt number (0-indexed)
 * @param options - Retry options
 * @returns The delay in milliseconds
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, "onRetry" | "signal">>
): number {
  // Exponential backoff: delay * (backoff ^ attempt)
  const delay = options.delay * Math.pow(options.backoff, attempt);

  // Apply jitter (10% random variation) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() - 0.5) * 2;

  // Clamp to maxDelay
  return Math.min(delay + jitter, options.maxDelay);
}

/**
 * Sleep for a specified duration.
 *
 * @param ms - Duration in milliseconds
 * @param signal - Optional AbortSignal to cancel the sleep
 * @returns Promise that resolves after the duration
 * @throws Error if the operation is aborted
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    if (signal) {
      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(new Error("Operation aborted"));
      };
      signal.addEventListener("abort", abortHandler, { once: true });

      // Clean up the abort handler when the timeout completes
      setTimeout(() => {
        signal.removeEventListener("abort", abortHandler);
      }, ms);
    }
  });
}

/**
 * Execute an async function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Optional retry configuration
 * @returns Promise resolving to the function result
 * @throws RetryExhaustedError if all retry attempts fail
 * @throws The original error if it's not retryable
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withRetry(async () => {
 *   return await fetchData();
 * });
 *
 * // With custom options
 * const result = await withRetry(
 *   async () => fetchData(),
 *   {
 *     maxRetries: 5,
 *     delay: 500,
 *     backoff: 1.5,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`);
 *     },
 *   }
 * );
 *
 * // With abort signal
 * const controller = new AbortController();
 * const result = await withRetry(
 *   async () => fetchData(),
 *   { signal: controller.signal }
 * );
 * // Later: controller.abort();
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { maxRetries, shouldRetry, onRetry, signal } = opts;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // If this was the last attempt, throw
      if (attempt === maxRetries) {
        throw new RetryExhaustedError(err, attempt + 1);
      }

      // Check if the error is retryable
      if (!shouldRetry(err)) {
        throw err;
      }

      // Calculate delay for this attempt
      const delay = calculateDelay(attempt, opts);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(err, attempt + 1, delay);
      }

      // Wait before next attempt
      await sleep(delay, signal);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new RetryExhaustedError(
    lastError ?? new Error("Unknown error"),
    maxRetries + 1
  );
}

/**
 * Execute an async function with retry logic and return detailed results.
 *
 * Similar to withRetry but returns metadata about the retry operation.
 *
 * @param fn - The async function to execute
 * @param options - Optional retry configuration
 * @returns Promise resolving to RetryResult with result and metadata
 * @throws RetryExhaustedError if all retry attempts fail
 * @throws The original error if it's not retryable
 *
 * @example
 * ```typescript
 * const { result, attempts, totalTime } = await withRetryResult(
 *   async () => fetchData()
 * );
 * console.log(`Succeeded after ${attempts} attempts in ${totalTime}ms`);
 * ```
 */
export async function withRetryResult<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { maxRetries, shouldRetry, onRetry, signal } = opts;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      const result = await fn();
      return {
        result,
        attempts: attempt + 1,
        totalTime: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // If this was the last attempt, throw
      if (attempt === maxRetries) {
        throw new RetryExhaustedError(err, attempt + 1);
      }

      // Check if the error is retryable
      if (!shouldRetry(err)) {
        throw err;
      }

      // Calculate delay for this attempt
      const delay = calculateDelay(attempt, opts);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(err, attempt + 1, delay);
      }

      // Wait before next attempt
      await sleep(delay, signal);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new RetryExhaustedError(
    lastError ?? new Error("Unknown error"),
    maxRetries + 1
  );
}

/**
 * Create a retryable version of an async function.
 *
 * This is useful when you want to create a function that always
 * retries without passing options each time.
 *
 * @param fn - The async function to wrap
 * @param options - Retry configuration
 * @returns A new function that wraps the original with retry logic
 *
 * @example
 * ```typescript
 * const fetchWithRetry = createRetryable(
 *   async (url: string) => fetch(url),
 *   { maxRetries: 5 }
 * );
 *
 * const response = await fetchWithRetry('https://api.example.com/data');
 * ```
 */
export function createRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options?: RetryOptions
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return withRetry(() => fn(...args), options);
  };
}

/**
 * Decorator-style retry wrapper for class methods.
 *
 * Note: This is a factory function, not a true decorator,
 * since decorators are not yet widely supported in all environments.
 *
 * @param options - Retry configuration
 * @returns A wrapper function that adds retry logic
 *
 * @example
 * ```typescript
 * class ApiClient {
 *   private fetchData = retryMethod({ maxRetries: 3 })(
 *     async (): Promise<Data> => {
 *       return await this.doFetch();
 *     }
 *   );
 * }
 * ```
 */
export function retryMethod(
  options?: RetryOptions
): <T>(fn: () => Promise<T>) => () => Promise<T> {
  return <T>(fn: () => Promise<T>): (() => Promise<T>) => {
    return () => withRetry(fn, options);
  };
}
