/**
 * Browser tools barrel exports.
 *
 * Re-exports the BrowserManager, all individual browser tool classes,
 * accessibility types, and the SSRF guard utilities. Also provides
 * {@link createBrowserTools} as a convenience factory to instantiate
 * the full set of browser tools with a shared manager.
 */

export { BrowserManager } from "./browser-manager";
export {
  BrowserNavigateTool,
  BrowserSnapshotTool,
  BrowserClickTool,
  BrowserFillTool,
  BrowserTypeTool,
  BrowserScreenshotTool,
  BrowserScrollTool,
  BrowserSelectTool,
  BrowserTabsTool,
  BrowserExtractTool,
} from "./browser-tools";
export type { AccessibilityNode, RefEntry } from "./accessibility";
export { validateNavigationUrl, isPrivateIP } from "./ssrf-guard";

import type { Tool } from "../base";
import { BrowserManager } from "./browser-manager";
import {
  BrowserNavigateTool,
  BrowserSnapshotTool,
  BrowserClickTool,
  BrowserFillTool,
  BrowserTypeTool,
  BrowserScreenshotTool,
  BrowserScrollTool,
  BrowserSelectTool,
  BrowserTabsTool,
  BrowserExtractTool,
} from "./browser-tools";

/**
 * Creates all browser tools with a shared BrowserManager instance.
 *
 * The returned tools share a single browser context, so navigation
 * state, element refs, and tab state are consistent across calls.
 *
 * @returns An array of all browser Tool implementations
 */
export function createBrowserTools(): Tool[] {
  const manager = BrowserManager.getInstance();
  return [
    new BrowserNavigateTool(manager),
    new BrowserSnapshotTool(manager),
    new BrowserClickTool(manager),
    new BrowserFillTool(manager),
    new BrowserTypeTool(manager),
    new BrowserScreenshotTool(manager),
    new BrowserScrollTool(manager),
    new BrowserSelectTool(manager),
    new BrowserTabsTool(manager),
    new BrowserExtractTool(manager),
  ];
}
