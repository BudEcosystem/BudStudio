/**
 * Core browser lifecycle manager singleton.
 *
 * Wraps Playwright's persistent browser context to provide a stable,
 * reusable browser session for agent tool calls. Handles launch,
 * navigation, accessibility snapshots, screenshots, tab management,
 * and graceful cleanup.
 *
 * The singleton pattern ensures a single browser instance is shared
 * across all tool invocations within the process lifetime.
 */

import os from "os";
import path from "path";
import fs from "fs";
import {
  chromium,
  type BrowserContext,
  type Page,
  type Locator,
} from "playwright-core";
import { validateNavigationUrl } from "./ssrf-guard";
import {
  formatAccessibilityTree,
  type RefEntry,
  type AccessibilityNode,
} from "./accessibility";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout for page navigation actions (goto, goBack, goForward). */
const NAVIGATION_TIMEOUT_MS = 30_000;

/** Timeout for element interaction actions (click, fill, etc.). */
const ACTION_TIMEOUT_MS = 10_000;

/** Timeout for screenshot capture. */
const SCREENSHOT_TIMEOUT_MS = 15_000;

/** Maximum character length for extracted text output. */
const MAX_OUTPUT_LENGTH = 50_000;

// ---------------------------------------------------------------------------
// BrowserManager
// ---------------------------------------------------------------------------

/**
 * Singleton manager for a persistent Playwright browser context.
 *
 * Provides methods for navigation, accessibility snapshots, screenshots,
 * tab management, and element reference resolution. The underlying
 * browser context is lazily created on first use and persists user data
 * (cookies, localStorage) across sessions via a profile directory.
 *
 * @example
 * ```typescript
 * const browser = BrowserManager.getInstance();
 * await browser.navigateTo("https://example.com");
 * const snapshot = await browser.takeSnapshot();
 * console.log(snapshot);
 * ```
 */
export class BrowserManager {
  private static instance: BrowserManager | null = null;

  private context: BrowserContext | null = null;
  private activePage: Page | null = null;

  /** Maps ref ids (e.g. "e1") to Playwright Locators for the active page. */
  private elementRefs: Map<string, Locator> = new Map();

  /** Metadata for each ref id, storing the role and accessible name. */
  private refEntries: Map<string, RefEntry> = new Map();

  /** Filesystem path used for persistent browser profile data. */
  private profilePath: string;

  /** Whether to launch the browser in headless mode. */
  private headless: boolean;

  /** Whether the process exit cleanup handler has been registered. */
  private exitHandlerRegistered = false;

  /**
   * Private constructor to enforce the singleton pattern.
   * Use {@link BrowserManager.getInstance} to obtain the instance.
   */
  private constructor() {
    this.profilePath = path.join(
      os.homedir(),
      ".bud",
      "browser",
      "default",
      "user-data"
    );

    const headlessEnv = process.env.BUD_BROWSER_HEADLESS;
    this.headless =
      headlessEnv !== undefined
        ? headlessEnv.toLowerCase() === "true"
        : false;
  }

  /**
   * Returns the singleton BrowserManager instance, creating it if necessary.
   *
   * @returns The shared BrowserManager instance
   */
  static getInstance(): BrowserManager {
    if (BrowserManager.instance === null) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  // -------------------------------------------------------------------------
  // Context & Page lifecycle
  // -------------------------------------------------------------------------

  /**
   * Ensures a browser context is running and returns it.
   *
   * If no context exists or the browser has disconnected, a new persistent
   * context is launched using Chromium with the configured profile path.
   * A process exit handler is registered for cleanup.
   *
   * @returns The active BrowserContext
   */
  async ensureContext(): Promise<BrowserContext> {
    // Return existing context if still connected
    if (this.context !== null) {
      try {
        // Accessing pages() will throw if the browser has disconnected
        this.context.pages();
        return this.context;
      } catch {
        // Browser disconnected — fall through to re-launch
        this.context = null;
        this.activePage = null;
      }
    }

    // Ensure the profile directory exists
    fs.mkdirSync(this.profilePath, { recursive: true });

    // Launch using the system-installed Chrome with an isolated profile.
    // "channel: chrome" tells Playwright to use the user's Chrome binary
    // instead of requiring a bundled Chromium download.
    const context = await chromium.launchPersistentContext(this.profilePath, {
      channel: "chrome",
      headless: this.headless,
      viewport: { width: 1280, height: 720 },
      args: [
        "--no-first-run",
        "--disable-blink-features=AutomationControlled",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    // Register cleanup on process exit (only once)
    if (!this.exitHandlerRegistered) {
      process.on("exit", () => this.cleanupSync());
      this.exitHandlerRegistered = true;
    }

    this.context = context;

    // Set active page to the first existing page or create a new one
    const pages = context.pages();
    this.activePage =
      pages.length > 0 ? (pages[0] as Page) : await context.newPage();

    return context;
  }

  /**
   * Returns the currently active page, ensuring the context is running.
   *
   * If the active page has been closed, switches to the last open page
   * in the context or creates a new one.
   *
   * @returns The active Page
   */
  async getActivePage(): Promise<Page> {
    await this.ensureContext();

    if (this.activePage !== null && !this.activePage.isClosed()) {
      return this.activePage;
    }

    // Active page is gone — pick the last open page or create one
    const pages = this.context!.pages();
    if (pages.length > 0) {
      this.activePage = pages[pages.length - 1] as Page;
    } else {
      this.activePage = await this.context!.newPage();
    }

    return this.activePage!;
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  /**
   * Navigates the active page to the given URL, or goes back/forward in history.
   *
   * Special values:
   * - `"back"` — navigate back in the browser history
   * - `"forward"` — navigate forward in the browser history
   *
   * All other URLs are validated against the SSRF guard before navigation.
   *
   * @param url - The target URL, or `"back"` / `"forward"` for history navigation
   * @returns An object with the resulting page `title` and `url`
   * @throws If the URL fails SSRF validation or navigation times out
   */
  async navigateTo(url: string): Promise<{ title: string; url: string }> {
    const page = await this.getActivePage();

    if (url === "back") {
      await page.goBack({ timeout: NAVIGATION_TIMEOUT_MS });
    } else if (url === "forward") {
      await page.goForward({ timeout: NAVIGATION_TIMEOUT_MS });
    } else {
      await validateNavigationUrl(url);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    }

    return { title: await page.title(), url: page.url() };
  }

  // -------------------------------------------------------------------------
  // Accessibility snapshots
  // -------------------------------------------------------------------------

  /**
   * Takes an accessibility snapshot of the active page and formats it
   * as numbered-ref text for LLM consumption.
   *
   * Interactive elements are assigned ref ids (e.g. `"e1"`, `"e2"`) and
   * stored internally so they can be resolved to Playwright Locators via
   * {@link resolveRef}.
   *
   * @returns The formatted accessibility tree text, prefixed with the page URL
   */
  async takeSnapshot(): Promise<string> {
    const page = await this.getActivePage();

    const snapshot = (await page.accessibility.snapshot()) as AccessibilityNode | null;
    const { text, refs } = formatAccessibilityTree(snapshot);

    // Rebuild element refs and metadata for the new snapshot
    this.elementRefs.clear();
    this.refEntries.clear();

    for (const [refId, entry] of Array.from(refs)) {
      const locator = page.getByRole(entry.role as any, { name: entry.name });
      this.elementRefs.set(refId, locator);
      this.refEntries.set(refId, entry);
    }

    return `[Page URL: ${page.url()}]\n\n${text}`;
  }

  // -------------------------------------------------------------------------
  // Screenshots
  // -------------------------------------------------------------------------

  /**
   * Captures a full-page screenshot and returns it as a base64 data URI.
   *
   * @returns A `data:image/png;base64,...` string
   */
  async takeScreenshot(): Promise<string> {
    const page = await this.getActivePage();

    const buffer = await page.screenshot({ timeout: SCREENSHOT_TIMEOUT_MS });
    return `data:image/png;base64,${buffer.toString("base64")}`;
  }

  // -------------------------------------------------------------------------
  // Element ref resolution
  // -------------------------------------------------------------------------

  /**
   * Resolves a snapshot ref id to a Playwright Locator.
   *
   * Refs are generated by {@link takeSnapshot} and are valid until the
   * next snapshot is taken. If the ref is not found, an error is thrown
   * instructing the caller to take a fresh snapshot.
   *
   * @param ref - The ref id to resolve (e.g. `"e1"`)
   * @returns The corresponding Playwright Locator
   * @throws If the ref id is not found in the current ref map
   */
  resolveRef(ref: string): Locator {
    const locator = this.elementRefs.get(ref);
    if (!locator) {
      throw new Error(
        `Element reference '${ref}' not found. Run browser_snapshot first to get current element references.`
      );
    }
    return locator;
  }

  // -------------------------------------------------------------------------
  // Tab management
  // -------------------------------------------------------------------------

  /**
   * Lists all open tabs (pages) in the browser context.
   *
   * @returns An array of tab descriptors with index, title, url, and
   *          whether the tab is the currently active one
   */
  async listTabs(): Promise<
    Array<{ index: number; title: string; url: string; active: boolean }>
  > {
    await this.ensureContext();

    const pages = this.context!.pages();
    const result: Array<{
      index: number;
      title: string;
      url: string;
      active: boolean;
    }> = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      result.push({
        index: i,
        title: await page.title(),
        url: page.url(),
        active: page === this.activePage,
      });
    }

    return result;
  }

  /**
   * Switches the active tab to the page at the given index.
   *
   * Element refs are cleared since they belong to the previous page.
   *
   * @param index - The zero-based tab index to switch to
   * @throws If the index is out of bounds
   */
  async switchTab(index: number): Promise<void> {
    await this.ensureContext();

    const pages = this.context!.pages();
    if (index < 0 || index >= pages.length) {
      throw new Error(
        `Tab index ${index} is out of bounds. There are ${pages.length} tab(s) open (indices 0-${pages.length - 1}).`
      );
    }

    this.activePage = pages[index] as Page;
    await this.activePage.bringToFront();

    // Refs are page-specific — clear them when switching tabs
    this.elementRefs.clear();
    this.refEntries.clear();
  }

  /**
   * Creates a new empty tab and makes it the active page.
   *
   * Element refs are cleared since the new tab has no snapshot yet.
   */
  async createTab(): Promise<void> {
    await this.ensureContext();

    const page = await this.context!.newPage();
    this.activePage = page;

    this.elementRefs.clear();
    this.refEntries.clear();
  }

  // -------------------------------------------------------------------------
  // Text extraction
  // -------------------------------------------------------------------------

  /**
   * Extracts text content from the active page or a specific element.
   *
   * When a ref is provided, resolves it to a Locator and extracts its
   * text content. Otherwise, extracts the full body text of the page.
   * Output is truncated to {@link MAX_OUTPUT_LENGTH} characters.
   *
   * @param ref - Optional element ref id to extract text from
   * @returns The extracted text, or `"(No text content)"` if empty
   */
  async extractText(ref?: string): Promise<string> {
    const page = await this.getActivePage();
    let text: string | null = null;

    if (ref !== undefined) {
      const locator = this.resolveRef(ref);
      text = await locator.textContent({ timeout: ACTION_TIMEOUT_MS });
    } else {
      // Try body textContent first, fall back to stripping HTML from page content
      text = await page.textContent("body").catch(() => null);
      if (text === null) {
        const html = await page.content();
        text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }

    if (text === null || text.trim().length === 0) {
      return "(No text content)";
    }

    // Truncate to the maximum output length
    if (text.length > MAX_OUTPUT_LENGTH) {
      text = text.slice(0, MAX_OUTPUT_LENGTH);
    }

    return text;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Gracefully closes the browser context and resets all internal state.
   *
   * Safe to call multiple times. After cleanup, the next call to
   * {@link ensureContext} will launch a fresh browser.
   */
  async cleanup(): Promise<void> {
    if (this.context !== null) {
      await this.context.close();
    }

    this.context = null;
    this.activePage = null;
    this.elementRefs.clear();
    this.refEntries.clear();
  }

  /**
   * Synchronous cleanup wrapper for use in process exit handlers.
   *
   * Fires {@link cleanup} without awaiting — best-effort teardown
   * since async operations are not guaranteed to complete during
   * process exit.
   */
  private cleanupSync(): void {
    this.cleanup().catch(() => {
      // Fire-and-forget — nothing we can do on process exit
    });
  }
}
