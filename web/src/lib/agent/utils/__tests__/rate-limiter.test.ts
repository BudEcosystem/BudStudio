/**
 * Tests for the rate limiting utilities.
 *
 * Tests cover:
 * - Token acquisition (acquire)
 * - tryAcquire returns false when no tokens
 * - Token refill over time
 * - maxBurst limits
 * - ToolRateLimiter per-tool limits
 * - Unlimited tools
 */

import {
  RateLimiter,
  ToolRateLimiter,
  createToolRateLimiter,
  DEFAULT_TOOL_RATE_LIMITS,
  RateLimiterConfig,
} from "../rate-limiter";

describe("RateLimiter", () => {
  describe("constructor validation", () => {
    it("should throw error for non-positive tokensPerInterval", () => {
      expect(() => {
        new RateLimiter({ tokensPerInterval: 0, interval: 1000 });
      }).toThrow("tokensPerInterval must be positive");

      expect(() => {
        new RateLimiter({ tokensPerInterval: -1, interval: 1000 });
      }).toThrow("tokensPerInterval must be positive");
    });

    it("should throw error for non-positive interval", () => {
      expect(() => {
        new RateLimiter({ tokensPerInterval: 10, interval: 0 });
      }).toThrow("interval must be positive");

      expect(() => {
        new RateLimiter({ tokensPerInterval: 10, interval: -1000 });
      }).toThrow("interval must be positive");
    });

    it("should throw error for negative maxBurst", () => {
      expect(() => {
        new RateLimiter({ tokensPerInterval: 10, interval: 1000, maxBurst: -1 });
      }).toThrow("maxBurst cannot be negative");
    });

    it("should allow maxBurst of 0", () => {
      expect(() => {
        new RateLimiter({ tokensPerInterval: 10, interval: 1000, maxBurst: 0 });
      }).not.toThrow();
    });
  });

  describe("token acquisition", () => {
    it("should acquire tokens when available", async () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      // Should not throw and complete quickly
      await limiter.acquire();
      // Use toBeCloseTo to handle floating point precision due to time elapsed
      expect(limiter.getAvailableTokens()).toBeCloseTo(9, 0);
    });

    it("should acquire multiple tokens at once", async () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      await limiter.acquire(5);
      // Use toBeCloseTo to handle floating point precision
      expect(limiter.getAvailableTokens()).toBeCloseTo(5, 0);
    });

    it("should throw error for non-positive tokens in acquire", async () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      await expect(limiter.acquire(0)).rejects.toThrow(
        "Tokens to acquire must be positive"
      );
      await expect(limiter.acquire(-1)).rejects.toThrow(
        "Tokens to acquire must be positive"
      );
    });
  });

  describe("tryAcquire", () => {
    it("should return true when tokens are available", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(9);
    });

    it("should return false when no tokens available", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 2,
        interval: 1000,
      });

      // Exhaust all tokens
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);

      // Now should return false
      expect(limiter.tryAcquire()).toBe(false);
    });

    it("should return false when requesting more tokens than available", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 5,
        interval: 1000,
      });

      expect(limiter.tryAcquire(10)).toBe(false);
      // Tokens should not be consumed on failure
      expect(limiter.getAvailableTokens()).toBe(5);
    });

    it("should throw error for non-positive tokens in tryAcquire", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      expect(() => limiter.tryAcquire(0)).toThrow(
        "Tokens to acquire must be positive"
      );
      expect(() => limiter.tryAcquire(-1)).toThrow(
        "Tokens to acquire must be positive"
      );
    });
  });

  describe("token refill over time", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should refill tokens over time", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10, // 10 tokens per 1000ms = 0.01 tokens/ms
        interval: 1000,
      });

      // Use all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire();
      }
      expect(limiter.getAvailableTokens()).toBeCloseTo(0, 1);

      // Advance time by 500ms - should have ~5 tokens
      jest.advanceTimersByTime(500);
      expect(limiter.getAvailableTokens()).toBeCloseTo(5, 1);

      // Advance time by another 500ms - should be back to 10 tokens
      jest.advanceTimersByTime(500);
      expect(limiter.getAvailableTokens()).toBeCloseTo(10, 1);
    });

    it("should wait for tokens when acquiring and none available", async () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }

      // Start acquisition that will need to wait
      const acquirePromise = limiter.acquire();

      // Advance time to allow refill
      jest.advanceTimersByTime(200);

      await acquirePromise;
      // Should have completed after waiting
    });
  });

  describe("maxBurst limits", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should default maxBurst to tokensPerInterval", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      expect(limiter.getMaxTokens()).toBe(10);
    });

    it("should respect custom maxBurst setting", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
        maxBurst: 15,
      });

      expect(limiter.getMaxTokens()).toBe(15);
      expect(limiter.getAvailableTokens()).toBe(15);
    });

    it("should not exceed maxBurst even after long idle time", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
        maxBurst: 5,
      });

      // Start at maxBurst (5)
      expect(limiter.getAvailableTokens()).toBe(5);

      // Use some tokens
      limiter.tryAcquire(3);
      expect(limiter.getAvailableTokens()).toBe(2);

      // Advance time way beyond what would be needed to fully refill
      jest.advanceTimersByTime(10000);

      // Should be capped at maxBurst
      expect(limiter.getAvailableTokens()).toBe(5);
    });
  });

  describe("reset", () => {
    it("should reset tokens to maximum", () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });

      // Use some tokens
      limiter.tryAcquire(7);
      expect(limiter.getAvailableTokens()).toBe(3);

      // Reset
      limiter.reset();
      expect(limiter.getAvailableTokens()).toBe(10);
    });
  });

  describe("getConfig", () => {
    it("should return a copy of the configuration", () => {
      const config: RateLimiterConfig = {
        tokensPerInterval: 10,
        interval: 1000,
        maxBurst: 15,
      };
      const limiter = new RateLimiter(config);

      const returnedConfig = limiter.getConfig();
      expect(returnedConfig).toEqual(config);
      expect(returnedConfig).not.toBe(config); // Should be a copy
    });
  });
});

describe("ToolRateLimiter", () => {
  describe("construction", () => {
    it("should create with no configuration", () => {
      const limiter = new ToolRateLimiter();
      expect(limiter).toBeDefined();
    });

    it("should create with Map-based limits", () => {
      const limits = new Map<string, RateLimiterConfig>([
        ["bash", { tokensPerInterval: 10, interval: 60000 }],
      ]);
      const limiter = new ToolRateLimiter({ limits });

      expect(limiter.hasLimitForTool("bash")).toBe(true);
    });

    it("should create with Record-based limits", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      expect(limiter.hasLimitForTool("bash")).toBe(true);
    });
  });

  describe("per-tool limits", () => {
    it("should enforce per-tool rate limits", async () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 2, interval: 60000 },
          write_file: { tokensPerInterval: 5, interval: 60000 },
        },
      });

      // bash should have 2 tokens
      expect(limiter.tryAcquireForTool("bash")).toBe(true);
      expect(limiter.tryAcquireForTool("bash")).toBe(true);
      expect(limiter.tryAcquireForTool("bash")).toBe(false);

      // write_file should have 5 tokens
      expect(limiter.tryAcquireForTool("write_file")).toBe(true);
      expect(limiter.tryAcquireForTool("write_file")).toBe(true);
      expect(limiter.tryAcquireForTool("write_file")).toBe(true);
      expect(limiter.tryAcquireForTool("write_file")).toBe(true);
      expect(limiter.tryAcquireForTool("write_file")).toBe(true);
      expect(limiter.tryAcquireForTool("write_file")).toBe(false);
    });

    it("should track available tokens per tool", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      expect(limiter.getAvailableTokensForTool("bash")).toBe(10);

      limiter.tryAcquireForTool("bash", 3);
      expect(limiter.getAvailableTokensForTool("bash")).toBe(7);
    });

    it("should acquire multiple tokens for a tool", async () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      await limiter.acquireForTool("bash", 5);
      expect(limiter.getAvailableTokensForTool("bash")).toBe(5);
    });
  });

  describe("unlimited tools", () => {
    it("should allow unlimited calls for unconfigured tools without default", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 2, interval: 60000 },
        },
        // No defaultLimit
      });

      // unconfigured_tool should be unlimited
      for (let i = 0; i < 100; i++) {
        expect(limiter.tryAcquireForTool("unconfigured_tool")).toBe(true);
      }
    });

    it("should return Infinity for available tokens on unlimited tool", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      expect(limiter.getAvailableTokensForTool("unlimited_tool")).toBe(
        Infinity
      );
    });

    it("should not have limit for unconfigured tool without default", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      expect(limiter.hasLimitForTool("bash")).toBe(true);
      expect(limiter.hasLimitForTool("unconfigured")).toBe(false);
    });
  });

  describe("default limits", () => {
    it("should apply default limit to unconfigured tools", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 2, interval: 60000 },
        },
        defaultLimit: { tokensPerInterval: 5, interval: 60000 },
      });

      // bash uses its configured limit
      expect(limiter.getAvailableTokensForTool("bash")).toBe(2);

      // unconfigured tool uses default limit
      expect(limiter.getAvailableTokensForTool("other_tool")).toBe(5);
    });

    it("should indicate hasLimitForTool when default exists", () => {
      const limiter = new ToolRateLimiter({
        limits: {},
        defaultLimit: { tokensPerInterval: 5, interval: 60000 },
      });

      expect(limiter.hasLimitForTool("any_tool")).toBe(true);
    });
  });

  describe("reset functionality", () => {
    it("should reset specific tool limiter", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      limiter.tryAcquireForTool("bash", 8);
      expect(limiter.getAvailableTokensForTool("bash")).toBe(2);

      expect(limiter.resetForTool("bash")).toBe(true);
      expect(limiter.getAvailableTokensForTool("bash")).toBe(10);
    });

    it("should return false when resetting unconfigured tool", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      expect(limiter.resetForTool("unconfigured")).toBe(false);
    });

    it("should reset all tool limiters", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
          write_file: { tokensPerInterval: 20, interval: 60000 },
        },
      });

      limiter.tryAcquireForTool("bash", 8);
      limiter.tryAcquireForTool("write_file", 15);

      limiter.resetAll();

      expect(limiter.getAvailableTokensForTool("bash")).toBe(10);
      expect(limiter.getAvailableTokensForTool("write_file")).toBe(20);
    });
  });

  describe("dynamic tool limit management", () => {
    it("should add new tool limit", () => {
      const limiter = new ToolRateLimiter({ limits: {} });

      expect(limiter.hasLimitForTool("new_tool")).toBe(false);

      limiter.setToolLimit("new_tool", {
        tokensPerInterval: 5,
        interval: 60000,
      });

      expect(limiter.hasLimitForTool("new_tool")).toBe(true);
      expect(limiter.getAvailableTokensForTool("new_tool")).toBe(5);
    });

    it("should update existing tool limit", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      limiter.tryAcquireForTool("bash", 5);
      expect(limiter.getAvailableTokensForTool("bash")).toBe(5);

      // Update limit - should reset tokens
      limiter.setToolLimit("bash", { tokensPerInterval: 20, interval: 60000 });
      expect(limiter.getAvailableTokensForTool("bash")).toBe(20);
    });

    it("should remove tool limit", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
        },
      });

      expect(limiter.removeToolLimit("bash")).toBe(true);
      expect(limiter.hasLimitForTool("bash")).toBe(false);
      expect(limiter.getAvailableTokensForTool("bash")).toBe(Infinity);
    });

    it("should return false when removing non-existent limit", () => {
      const limiter = new ToolRateLimiter({ limits: {} });

      expect(limiter.removeToolLimit("nonexistent")).toBe(false);
    });
  });

  describe("getConfiguredTools", () => {
    it("should return list of configured tool names", () => {
      const limiter = new ToolRateLimiter({
        limits: {
          bash: { tokensPerInterval: 10, interval: 60000 },
          write_file: { tokensPerInterval: 20, interval: 60000 },
        },
      });

      const tools = limiter.getConfiguredTools();
      expect(tools).toContain("bash");
      expect(tools).toContain("write_file");
      expect(tools).toHaveLength(2);
    });

    it("should return empty array when no tools configured", () => {
      const limiter = new ToolRateLimiter({ limits: {} });

      expect(limiter.getConfiguredTools()).toEqual([]);
    });
  });
});

describe("createToolRateLimiter", () => {
  it("should create limiter with default tool limits", () => {
    const limiter = createToolRateLimiter();

    // Should have the default limits
    expect(limiter.hasLimitForTool("bash")).toBe(true);
    expect(limiter.hasLimitForTool("write_file")).toBe(true);
    expect(limiter.hasLimitForTool("edit_file")).toBe(true);
    expect(limiter.hasLimitForTool("read_file")).toBe(true);
  });

  it("should use DEFAULT_TOOL_RATE_LIMITS values", () => {
    const limiter = createToolRateLimiter();

    // bash should have 10 tokens per minute
    expect(limiter.getAvailableTokensForTool("bash")).toBe(
      DEFAULT_TOOL_RATE_LIMITS.bash.tokensPerInterval
    );
  });

  it("should create limiter with custom limits", () => {
    const limiter = createToolRateLimiter({
      limits: {
        custom_tool: { tokensPerInterval: 5, interval: 30000 },
      },
    });

    expect(limiter.hasLimitForTool("custom_tool")).toBe(true);
    expect(limiter.getAvailableTokensForTool("custom_tool")).toBe(5);
  });

  it("should create limiter with custom default limit", () => {
    const limiter = createToolRateLimiter({
      defaultLimit: { tokensPerInterval: 100, interval: 60000 },
    });

    // Non-configured tools should get the default
    expect(limiter.getAvailableTokensForTool("unknown_tool")).toBe(100);
  });
});

describe("DEFAULT_TOOL_RATE_LIMITS", () => {
  it("should have expected tools configured", () => {
    expect(DEFAULT_TOOL_RATE_LIMITS).toHaveProperty("bash");
    expect(DEFAULT_TOOL_RATE_LIMITS).toHaveProperty("write_file");
    expect(DEFAULT_TOOL_RATE_LIMITS).toHaveProperty("edit_file");
    expect(DEFAULT_TOOL_RATE_LIMITS).toHaveProperty("read_file");
  });

  it("should have reasonable default values", () => {
    // bash should be more restrictive
    expect(DEFAULT_TOOL_RATE_LIMITS.bash.tokensPerInterval).toBeLessThanOrEqual(
      DEFAULT_TOOL_RATE_LIMITS.read_file.tokensPerInterval
    );

    // All should have positive values
    Object.values(DEFAULT_TOOL_RATE_LIMITS).forEach((config) => {
      expect(config.tokensPerInterval).toBeGreaterThan(0);
      expect(config.interval).toBeGreaterThan(0);
    });
  });
});
