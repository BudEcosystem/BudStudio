/**
 * Browser tool implementations for BudAgent.
 *
 * Each class wraps a specific browser action (navigate, click, fill, etc.)
 * behind the standard Tool interface so the agent can invoke them through
 * the unified tool-calling mechanism. All tools delegate to a shared
 * {@link BrowserManager} instance for actual browser interaction.
 */

import type { Tool, ToolParameter } from "../base";
import { BrowserManager } from "./browser-manager";

// ---------------------------------------------------------------------------
// Special keyboard keys recognised by BrowserTypeTool
// ---------------------------------------------------------------------------

const SPECIAL_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

// ---------------------------------------------------------------------------
// 1. BrowserNavigateTool
// ---------------------------------------------------------------------------

/**
 * Navigates the browser to a URL or through history (back / forward).
 */
export class BrowserNavigateTool implements Tool {
  name = "browser_navigate";
  description =
    "Navigate the browser to a URL, or use 'back'/'forward' for history navigation";
  parameters: ToolParameter[] = [
    {
      name: "url",
      type: "string",
      description:
        "The URL to navigate to. Use 'back' or 'forward' for history navigation.",
    },
  ];
  requiresApproval = true;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const url = params.url as string | undefined;
    if (!url || typeof url !== "string") {
      throw new Error("url parameter is required and must be a string");
    }

    const result = await this.manager.navigateTo(url);

    // Automatically take a snapshot after navigation so the agent can
    // immediately see the page without a separate browser_snapshot call.
    const snapshot = await this.manager.takeSnapshot();

    return `[Navigated] Title: ${result.title} | URL: ${result.url}\n\n${snapshot}`;
  }
}

// ---------------------------------------------------------------------------
// 2. BrowserSnapshotTool
// ---------------------------------------------------------------------------

/**
 * Takes an accessibility snapshot of the current page for LLM consumption.
 */
export class BrowserSnapshotTool implements Tool {
  name = "browser_snapshot";
  description =
    "Take an accessibility snapshot of the current page, returning a text representation with element references";
  parameters: ToolParameter[] = [];
  requiresApproval = false;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(_params: Record<string, unknown>): Promise<string> {
    return await this.manager.takeSnapshot();
  }
}

// ---------------------------------------------------------------------------
// 3. BrowserClickTool
// ---------------------------------------------------------------------------

/**
 * Clicks an element identified by its snapshot reference id.
 */
export class BrowserClickTool implements Tool {
  name = "browser_click";
  description =
    "Click an element on the page using its reference id from a previous snapshot";
  parameters: ToolParameter[] = [
    {
      name: "ref",
      type: "string",
      description:
        "The element reference id from the accessibility snapshot (e.g. 'e1')",
    },
    {
      name: "button",
      type: "string",
      description: "Mouse button to click with",
      required: false,
      enum: ["left", "right", "middle"],
    },
  ];
  requiresApproval = true;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const ref = params.ref as string | undefined;
    if (!ref || typeof ref !== "string") {
      throw new Error("ref parameter is required and must be a string");
    }

    const button = (params.button as string | undefined) || "left";
    const locator = this.manager.resolveRef(ref);
    await locator.click({
      button: button as "left" | "right" | "middle",
      timeout: 10_000,
    });

    return `Clicked element ${ref}`;
  }
}

// ---------------------------------------------------------------------------
// 4. BrowserFillTool
// ---------------------------------------------------------------------------

/**
 * Fills an input element with the given value (clears existing content first).
 */
export class BrowserFillTool implements Tool {
  name = "browser_fill";
  description =
    "Fill an input element with a value, clearing any existing content first";
  parameters: ToolParameter[] = [
    {
      name: "ref",
      type: "string",
      description:
        "The element reference id from the accessibility snapshot (e.g. 'e1')",
    },
    {
      name: "value",
      type: "string",
      description: "The value to fill into the input element",
    },
  ];
  requiresApproval = true;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const ref = params.ref as string | undefined;
    const value = params.value as string | undefined;

    if (!ref || typeof ref !== "string") {
      throw new Error("ref parameter is required and must be a string");
    }
    if (value === undefined || typeof value !== "string") {
      throw new Error("value parameter is required and must be a string");
    }

    const locator = this.manager.resolveRef(ref);
    await locator.fill(value, { timeout: 10_000 });

    return `Filled element ${ref}`;
  }
}

// ---------------------------------------------------------------------------
// 5. BrowserTypeTool
// ---------------------------------------------------------------------------

/**
 * Types text or presses a special key, optionally targeting a specific element.
 */
export class BrowserTypeTool implements Tool {
  name = "browser_type";
  description =
    "Type text or press a special key (Enter, Tab, Escape, Backspace, Delete, Arrow keys). Optionally target a specific element first.";
  parameters: ToolParameter[] = [
    {
      name: "text",
      type: "string",
      description:
        "The text to type, or a special key name (Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight)",
    },
    {
      name: "ref",
      type: "string",
      description:
        "Optional element reference id to click before typing, to focus the element",
      required: false,
    },
  ];
  requiresApproval = true;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const text = params.text as string | undefined;
    const ref = params.ref as string | undefined;

    if (!text || typeof text !== "string") {
      throw new Error("text parameter is required and must be a string");
    }

    const page = await this.manager.getActivePage();

    // If a ref is provided, click the element first to focus it
    if (ref) {
      const locator = this.manager.resolveRef(ref);
      await locator.click({ timeout: 10_000 });
    }

    if (SPECIAL_KEYS.has(text)) {
      await page.keyboard.press(text);
      return `Pressed ${text}`;
    }

    await page.keyboard.type(text);
    return ref ? `Typed text into element ${ref}` : "Typed text";
  }
}

// ---------------------------------------------------------------------------
// 6. BrowserScreenshotTool
// ---------------------------------------------------------------------------

/**
 * Captures a screenshot of the current page as a base64 data URI.
 */
export class BrowserScreenshotTool implements Tool {
  name = "browser_screenshot";
  description =
    "Take a screenshot of the current page, returning a base64-encoded PNG data URI";
  parameters: ToolParameter[] = [];
  requiresApproval = false;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(_params: Record<string, unknown>): Promise<string> {
    return await this.manager.takeScreenshot();
  }
}

// ---------------------------------------------------------------------------
// 7. BrowserScrollTool
// ---------------------------------------------------------------------------

/**
 * Scrolls the page or a specific element into view.
 */
export class BrowserScrollTool implements Tool {
  name = "browser_scroll";
  description =
    "Scroll the page up or down by a pixel amount, or scroll a specific element into view";
  parameters: ToolParameter[] = [
    {
      name: "direction",
      type: "string",
      description: "The direction to scroll",
      enum: ["up", "down"],
    },
    {
      name: "amount",
      type: "number",
      description: "The number of pixels to scroll (default: 500)",
      required: false,
    },
    {
      name: "ref",
      type: "string",
      description:
        "Optional element reference id to scroll into view instead of scrolling the page",
      required: false,
    },
  ];
  requiresApproval = false;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const direction = params.direction as string | undefined;
    const amount = (params.amount as number | undefined) ?? 500;
    const ref = params.ref as string | undefined;

    if (!direction || typeof direction !== "string") {
      throw new Error("direction parameter is required and must be a string");
    }

    // If a ref is provided, scroll that element into view
    if (ref) {
      const locator = this.manager.resolveRef(ref);
      await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
      return `Scrolled element ${ref} into view`;
    }

    // Otherwise scroll the page by the given amount
    const page = await this.manager.getActivePage();
    const delta = direction === "down" ? amount : -amount;
    await page.mouse.wheel(0, delta);

    return `Scrolled ${direction}`;
  }
}

// ---------------------------------------------------------------------------
// 8. BrowserSelectTool
// ---------------------------------------------------------------------------

/**
 * Selects an option from a <select> dropdown element.
 */
export class BrowserSelectTool implements Tool {
  name = "browser_select";
  description =
    "Select an option from a dropdown (select) element by its value or visible text";
  parameters: ToolParameter[] = [
    {
      name: "ref",
      type: "string",
      description:
        "The element reference id of the select element from the accessibility snapshot",
    },
    {
      name: "value",
      type: "string",
      description: "The option value or visible text to select",
    },
  ];
  requiresApproval = true;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const ref = params.ref as string | undefined;
    const value = params.value as string | undefined;

    if (!ref || typeof ref !== "string") {
      throw new Error("ref parameter is required and must be a string");
    }
    if (!value || typeof value !== "string") {
      throw new Error("value parameter is required and must be a string");
    }

    const locator = this.manager.resolveRef(ref);
    await locator.selectOption(value, { timeout: 10_000 });

    return `Selected '${value}' in element ${ref}`;
  }
}

// ---------------------------------------------------------------------------
// 9. BrowserTabsTool
// ---------------------------------------------------------------------------

/**
 * Manages browser tabs: list, create, or switch between them.
 */
export class BrowserTabsTool implements Tool {
  name = "browser_tabs";
  description =
    "Manage browser tabs: list all open tabs, create a new tab, or switch to a specific tab by index";
  parameters: ToolParameter[] = [
    {
      name: "action",
      type: "string",
      description: "The tab action to perform",
      enum: ["list", "create", "switch"],
    },
    {
      name: "tab_index",
      type: "number",
      description:
        "The zero-based tab index to switch to (required for 'switch' action)",
      required: false,
    },
  ];
  requiresApproval = false;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const action = params.action as string | undefined;
    const tabIndex = params.tab_index as number | undefined;

    if (!action || typeof action !== "string") {
      throw new Error("action parameter is required and must be a string");
    }

    switch (action) {
      case "list": {
        const tabs = await this.manager.listTabs();
        if (tabs.length === 0) {
          return "No tabs open";
        }
        const lines = tabs.map(
          (tab) =>
            `${tab.index}: ${tab.title} (${tab.url})${tab.active ? " [active]" : ""}`
        );
        return lines.join("\n");
      }

      case "create": {
        await this.manager.createTab();
        return "Created new tab";
      }

      case "switch": {
        if (tabIndex === undefined || typeof tabIndex !== "number") {
          throw new Error(
            "tab_index parameter is required for 'switch' action and must be a number"
          );
        }
        await this.manager.switchTab(tabIndex);
        return `Switched to tab ${tabIndex}`;
      }

      default:
        throw new Error(
          `Unknown tab action '${action}'. Valid actions: list, create, switch`
        );
    }
  }
}

// ---------------------------------------------------------------------------
// 10. BrowserExtractTool
// ---------------------------------------------------------------------------

/**
 * Extracts text content from the page or a specific element.
 */
export class BrowserExtractTool implements Tool {
  name = "browser_extract";
  description =
    "Extract text content from the entire page body, or from a specific element by reference id";
  parameters: ToolParameter[] = [
    {
      name: "ref",
      type: "string",
      description:
        "Optional element reference id to extract text from. If omitted, extracts the full page body text.",
      required: false,
    },
  ];
  requiresApproval = false;

  private manager: BrowserManager;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const ref = params.ref as string | undefined;
    return await this.manager.extractText(ref);
  }
}
