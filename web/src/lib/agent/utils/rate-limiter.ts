/**
 * Rate limiting utilities for the agent system.
 *
 * Implements a token bucket algorithm for controlling the rate of tool calls
 * and other operations. This helps prevent overwhelming external systems
 * and ensures fair resource usage.
 */

/**
 * Configuration for a rate limiter.
 */
export interface RateLimiterConfig {
  /** Number of tokens added per interval */
  tokensPerInterval: number;

  /** Interval in milliseconds for token refill */
  interval: number;

  /**
   * Maximum number of tokens that can accumulate.
   * Defaults to tokensPerInterval if not specified.
   */
  maxBurst?: number;
}

/**
 * Per-tool rate limit configuration.
 */
export interface ToolRateLimitConfig {
  /** Tool name */
  toolName: string;

  /** Rate limiter configuration for this tool */
  config: RateLimiterConfig;
}

/**
 * Configuration for creating a ToolRateLimiter.
 */
export interface ToolRateLimiterConfig {
  /** Map of tool names to their rate limit configurations */
  limits: Map<string, RateLimiterConfig> | Record<string, RateLimiterConfig>;

  /**
   * Default rate limit for tools not explicitly configured.
   * If not provided, tools without explicit limits are unlimited.
   */
  defaultLimit?: RateLimiterConfig;
}

/**
 * Default tool rate limits (tokens per minute).
 */
export const DEFAULT_TOOL_RATE_LIMITS: Record<string, RateLimiterConfig> = {
  bash: { tokensPerInterval: 10, interval: 60000 },
  write_file: { tokensPerInterval: 20, interval: 60000 },
  edit_file: { tokensPerInterval: 30, interval: 60000 },
  read_file: { tokensPerInterval: 100, interval: 60000 },
};

/**
 * Token bucket rate limiter.
 *
 * Implements the token bucket algorithm where:
 * - Tokens are added at a constant rate (tokensPerInterval/interval)
 * - Tokens accumulate up to maxBurst
 * - Operations consume tokens; if not enough tokens, wait or fail
 *
 * @example
 * ```typescript
 * // Allow 10 operations per minute, burst up to 15
 * const limiter = new RateLimiter({
 *   tokensPerInterval: 10,
 *   interval: 60000,
 *   maxBurst: 15,
 * });
 *
 * // Wait until tokens are available
 * await limiter.acquire();
 *
 * // Try without waiting
 * if (limiter.tryAcquire()) {
 *   // Proceed with operation
 * }
 * ```
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefillTime: number;

  /**
   * Creates a new RateLimiter.
   *
   * @param config - Configuration for the rate limiter
   * @throws Error if configuration values are invalid
   */
  constructor(private readonly config: RateLimiterConfig) {
    // Validate configuration
    if (config.tokensPerInterval <= 0) {
      throw new Error("tokensPerInterval must be positive");
    }
    if (config.interval <= 0) {
      throw new Error("interval must be positive");
    }
    if (config.maxBurst !== undefined && config.maxBurst < 0) {
      throw new Error("maxBurst cannot be negative");
    }

    this.maxTokens = config.maxBurst ?? config.tokensPerInterval;
    this.tokens = this.maxTokens;
    this.refillRate = config.tokensPerInterval / config.interval;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refills tokens based on elapsed time since last refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /**
   * Calculate time needed to wait for tokens to be available.
   *
   * @param tokens - Number of tokens needed
   * @returns Time to wait in milliseconds, or 0 if tokens are available
   */
  private calculateWaitTime(tokens: number): number {
    this.refill();

    if (this.tokens >= tokens) {
      return 0;
    }

    const tokensNeeded = tokens - this.tokens;
    return Math.ceil(tokensNeeded / this.refillRate);
  }

  /**
   * Acquire tokens, waiting if necessary.
   *
   * This method will wait until enough tokens are available.
   * Use for operations that must eventually complete.
   *
   * @param tokens - Number of tokens to acquire (default: 1)
   * @throws Error if tokens is not positive
   *
   * @example
   * ```typescript
   * // Wait for 1 token
   * await limiter.acquire();
   *
   * // Wait for 5 tokens
   * await limiter.acquire(5);
   * ```
   */
  async acquire(tokens: number = 1): Promise<void> {
    if (tokens <= 0) {
      throw new Error("Tokens to acquire must be positive");
    }

    // If requesting more than maxTokens, we can still satisfy it by waiting
    // but we need to handle this case specially
    if (tokens > this.maxTokens) {
      // Wait for enough time to accumulate the required tokens
      const waitTime = Math.ceil(tokens / this.refillRate);
      await this.sleep(waitTime);
      // After waiting, we have effectively "consumed" the tokens
      // Reset the bucket state
      this.tokens = 0;
      this.lastRefillTime = Date.now();
      return;
    }

    const waitTime = this.calculateWaitTime(tokens);

    if (waitTime > 0) {
      await this.sleep(waitTime);
      // Refill after sleeping
      this.refill();
    }

    // Consume tokens
    this.tokens -= tokens;
  }

  /**
   * Try to acquire tokens without waiting.
   *
   * This method returns immediately with success or failure.
   * Use for operations that can be skipped or need immediate response.
   *
   * @param tokens - Number of tokens to acquire (default: 1)
   * @returns True if tokens were acquired, false if not enough tokens
   * @throws Error if tokens is not positive
   *
   * @example
   * ```typescript
   * if (limiter.tryAcquire()) {
   *   await performOperation();
   * } else {
   *   console.log('Rate limited, try again later');
   * }
   * ```
   */
  tryAcquire(tokens: number = 1): boolean {
    if (tokens <= 0) {
      throw new Error("Tokens to acquire must be positive");
    }

    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Get the current number of available tokens.
   *
   * Note: This triggers a refill calculation first.
   *
   * @returns The number of available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get the maximum number of tokens (burst limit).
   *
   * @returns The maximum token count
   */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * Reset the rate limiter to full capacity.
   *
   * This refills tokens to the maximum and resets timing.
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /**
   * Get the rate limiter configuration.
   *
   * @returns A copy of the configuration
   */
  getConfig(): RateLimiterConfig {
    return { ...this.config };
  }

  /**
   * Sleep for a specified duration.
   *
   * @param ms - Duration in milliseconds
   * @returns Promise that resolves after the duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Rate limiter for tool calls with per-tool configuration.
 *
 * This class manages rate limits for different tools, allowing
 * different operations to have different rate limits.
 *
 * @example
 * ```typescript
 * const toolLimiter = new ToolRateLimiter({
 *   limits: {
 *     bash: { tokensPerInterval: 10, interval: 60000 },
 *     write_file: { tokensPerInterval: 20, interval: 60000 },
 *   },
 * });
 *
 * // Before executing a tool
 * await toolLimiter.acquireForTool('bash');
 * await executeTool('bash', args);
 * ```
 */
export class ToolRateLimiter {
  private readonly limiters: Map<string, RateLimiter> = new Map();
  private readonly defaultLimit?: RateLimiterConfig;

  /**
   * Creates a new ToolRateLimiter.
   *
   * @param config - Configuration with per-tool rate limits
   */
  constructor(config?: ToolRateLimiterConfig) {
    this.defaultLimit = config?.defaultLimit;

    if (config?.limits) {
      const limits =
        config.limits instanceof Map
          ? Array.from(config.limits.entries())
          : Object.entries(config.limits);

      for (const [toolName, limiterConfig] of limits) {
        this.limiters.set(toolName, new RateLimiter(limiterConfig));
      }
    }
  }

  /**
   * Acquire tokens for a specific tool, waiting if necessary.
   *
   * If the tool has no configured limit and no default limit is set,
   * this method returns immediately (unlimited rate).
   *
   * @param toolName - Name of the tool to acquire for
   * @param tokens - Number of tokens to acquire (default: 1)
   *
   * @example
   * ```typescript
   * // Wait for rate limit before executing bash
   * await toolLimiter.acquireForTool('bash');
   * ```
   */
  async acquireForTool(toolName: string, tokens: number = 1): Promise<void> {
    const limiter = this.getLimiterForTool(toolName);

    if (limiter) {
      await limiter.acquire(tokens);
    }
    // If no limiter, the tool is unlimited
  }

  /**
   * Try to acquire tokens for a specific tool without waiting.
   *
   * If the tool has no configured limit and no default limit is set,
   * this method returns true immediately (unlimited rate).
   *
   * @param toolName - Name of the tool to acquire for
   * @param tokens - Number of tokens to acquire (default: 1)
   * @returns True if tokens were acquired or tool is unlimited, false otherwise
   */
  tryAcquireForTool(toolName: string, tokens: number = 1): boolean {
    const limiter = this.getLimiterForTool(toolName);

    if (limiter) {
      return limiter.tryAcquire(tokens);
    }

    // If no limiter, the tool is unlimited
    return true;
  }

  /**
   * Get available tokens for a specific tool.
   *
   * @param toolName - Name of the tool
   * @returns Available tokens, or Infinity if the tool is unlimited
   */
  getAvailableTokensForTool(toolName: string): number {
    const limiter = this.getLimiterForTool(toolName);

    if (limiter) {
      return limiter.getAvailableTokens();
    }

    // If no limiter, the tool is unlimited
    return Infinity;
  }

  /**
   * Reset the rate limiter for a specific tool.
   *
   * @param toolName - Name of the tool to reset
   * @returns True if the tool had a limiter that was reset, false otherwise
   */
  resetForTool(toolName: string): boolean {
    const limiter = this.limiters.get(toolName);

    if (limiter) {
      limiter.reset();
      return true;
    }

    return false;
  }

  /**
   * Reset all rate limiters.
   */
  resetAll(): void {
    Array.from(this.limiters.values()).forEach((limiter) => {
      limiter.reset();
    });
  }

  /**
   * Add or update a rate limit for a tool.
   *
   * @param toolName - Name of the tool
   * @param config - Rate limiter configuration
   */
  setToolLimit(toolName: string, config: RateLimiterConfig): void {
    this.limiters.set(toolName, new RateLimiter(config));
  }

  /**
   * Remove the rate limit for a tool.
   *
   * @param toolName - Name of the tool
   * @returns True if the limit was removed, false if it didn't exist
   */
  removeToolLimit(toolName: string): boolean {
    return this.limiters.delete(toolName);
  }

  /**
   * Check if a tool has a configured rate limit.
   *
   * @param toolName - Name of the tool
   * @returns True if the tool has a rate limit (explicit or default)
   */
  hasLimitForTool(toolName: string): boolean {
    return this.limiters.has(toolName) || this.defaultLimit !== undefined;
  }

  /**
   * Get the rate limiter for a tool, creating one if needed from default.
   *
   * @param toolName - Name of the tool
   * @returns The rate limiter or undefined if no limit configured
   */
  private getLimiterForTool(toolName: string): RateLimiter | undefined {
    // First check for explicit limiter
    const explicit = this.limiters.get(toolName);
    if (explicit) {
      return explicit;
    }

    // If no explicit limiter but we have a default, create one
    if (this.defaultLimit) {
      const limiter = new RateLimiter(this.defaultLimit);
      this.limiters.set(toolName, limiter);
      return limiter;
    }

    // No limit for this tool
    return undefined;
  }

  /**
   * Get all configured tool names.
   *
   * @returns Array of tool names with rate limits
   */
  getConfiguredTools(): string[] {
    return Array.from(this.limiters.keys());
  }
}

/**
 * Factory function to create a ToolRateLimiter with default or custom configuration.
 *
 * @param config - Optional custom configuration. If not provided, uses default limits.
 * @returns A configured ToolRateLimiter
 *
 * @example
 * ```typescript
 * // Create with default limits
 * const limiter = createToolRateLimiter();
 *
 * // Create with custom limits
 * const customLimiter = createToolRateLimiter({
 *   limits: {
 *     bash: { tokensPerInterval: 5, interval: 60000 },
 *   },
 *   defaultLimit: { tokensPerInterval: 50, interval: 60000 },
 * });
 * ```
 */
export function createToolRateLimiter(
  config?: Partial<ToolRateLimiterConfig>
): ToolRateLimiter {
  // Merge with defaults if no limits provided
  const limits = config?.limits ?? DEFAULT_TOOL_RATE_LIMITS;

  return new ToolRateLimiter({
    limits,
    defaultLimit: config?.defaultLimit,
  });
}
