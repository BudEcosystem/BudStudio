/**
 * Accessibility tree formatting for LLM consumption.
 *
 * Converts Playwright's `page.accessibility.snapshot()` output into a
 * numbered-ref text format that an LLM can reason over. Interactive
 * elements receive numbered refs (e.g. `e1`, `e2`) so the LLM can
 * reference them in tool calls; non-interactive elements are included
 * for context but without refs.
 */

/** Maximum character length for the formatted output text. */
const MAX_OUTPUT_CHARS = 50_000;

/**
 * Matches the shape returned by Playwright's `page.accessibility.snapshot()`.
 *
 * Each node in the tree represents a single accessible element with its
 * ARIA role, computed name, optional state properties, and children.
 */
export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  invalid?: string;
  checked?: boolean | "mixed";
  pressed?: boolean | "mixed";
  selected?: boolean;
  expanded?: boolean;
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  children?: AccessibilityNode[];
}

/**
 * A reference entry stored alongside each numbered ref.
 *
 * Allows callers to map a ref id (e.g. `"e3"`) back to the element's
 * role and accessible name so that downstream tools can locate or
 * interact with it.
 */
export interface RefEntry {
  role: string;
  name: string;
}

/**
 * Set of ARIA roles considered interactive.
 *
 * Only elements with one of these roles will be assigned a numbered ref
 * in the formatted output.
 */
const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "link",
  "button",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

/**
 * Build a state annotation string for an interactive element.
 *
 * Appends human-readable state hints such as `(value: "...")`,
 * `(checked)`, `(disabled)`, etc. so the LLM understands the
 * current state of the control without needing raw ARIA attributes.
 *
 * @param node - The accessibility node to inspect
 * @returns A parenthesised annotation string, or empty string if no
 *          notable state is present
 */
function buildStateAnnotation(node: AccessibilityNode): string {
  const parts: string[] = [];

  // Value — most useful for textboxes, sliders, spinbuttons
  if (node.value !== undefined && node.value !== "") {
    parts.push(`value: "${node.value}"`);
  } else if (node.valuetext !== undefined && node.valuetext !== "") {
    parts.push(`value: "${node.valuetext}"`);
  }

  // Checked / pressed / selected / expanded
  if (node.checked === true) {
    parts.push("checked");
  } else if (node.checked === "mixed") {
    parts.push("mixed");
  }

  if (node.pressed === true) {
    parts.push("pressed");
  } else if (node.pressed === "mixed") {
    parts.push("pressed: mixed");
  }

  if (node.selected === true) {
    parts.push("selected");
  }

  if (node.expanded === true) {
    parts.push("expanded");
  } else if (node.expanded === false) {
    parts.push("collapsed");
  }

  // Disabled / required / readonly
  if (node.disabled === true) {
    parts.push("disabled");
  }

  if (node.required === true) {
    parts.push("required");
  }

  if (node.readonly === true) {
    parts.push("readonly");
  }

  if (parts.length === 0) {
    return "";
  }

  return ` (${parts.join(", ")})`;
}

/**
 * Determine whether a node should be skipped entirely.
 *
 * Nodes with empty names and no children are considered noise and are
 * excluded from the output to keep the snapshot concise.
 *
 * @param node - The node to evaluate
 * @returns `true` if the node should be omitted
 */
function isNoiseNode(node: AccessibilityNode): boolean {
  const hasName = node.name !== undefined && node.name.trim() !== "";
  const hasChildren = node.children !== undefined && node.children.length > 0;
  return !hasName && !hasChildren;
}

/**
 * Format a Playwright accessibility snapshot into numbered-ref text.
 *
 * Walks the accessibility tree depth-first. Interactive elements are
 * assigned sequential refs (`e1`, `e2`, ...) and stored in the returned
 * `refs` map. Non-interactive elements are rendered without a ref
 * prefix. The output text is indented by tree depth (2 spaces per
 * level) and truncated at {@link MAX_OUTPUT_CHARS}.
 *
 * @param snapshot - The root node returned by
 *   `page.accessibility.snapshot()`, or `null` if the snapshot failed
 * @returns An object containing:
 *   - `text` — the human/LLM-readable formatted tree
 *   - `refs` — a map from ref id (e.g. `"e1"`) to its {@link RefEntry}
 *
 * @example
 * ```typescript
 * const snapshot = await page.accessibility.snapshot();
 * const { text, refs } = formatAccessibilityTree(snapshot);
 * console.log(text);
 * // [Page] Title: Example Domain
 * //   [heading] "Example Domain"
 * //   [paragraph] "This domain is for use in illustrative examples."
 * //   e1: [link] "More information..."
 * ```
 */
export function formatAccessibilityTree(
  snapshot: AccessibilityNode | null
): { text: string; refs: Map<string, RefEntry> } {
  if (snapshot === null) {
    return { text: "[No accessibility snapshot available]", refs: new Map() };
  }

  const lines: string[] = [];
  const refs = new Map<string, RefEntry>();
  let refCounter = 0;
  let charCount = 0;
  let truncated = false;

  /**
   * Append a line to the output buffer, respecting the character limit.
   *
   * @returns `false` if the limit was exceeded and traversal should stop
   */
  function appendLine(line: string): boolean {
    // +1 for the newline character between lines
    const addition = charCount === 0 ? line.length : line.length + 1;
    if (charCount + addition > MAX_OUTPUT_CHARS) {
      truncated = true;
      return false;
    }
    lines.push(line);
    charCount += addition;
    return true;
  }

  /**
   * Recursively walk the tree and build output lines.
   *
   * @param node - Current node to process
   * @param depth - Current indentation depth
   * @returns `false` if the character limit was hit and traversal should stop
   */
  function walk(node: AccessibilityNode, depth: number): boolean {
    if (isNoiseNode(node)) {
      return true;
    }

    const indent = "  ".repeat(depth);
    const isInteractive = INTERACTIVE_ROLES.has(node.role);
    const nameDisplay = node.name.trim();

    let line: string;

    if (isInteractive) {
      refCounter++;
      const refId = `e${refCounter}`;
      refs.set(refId, { role: node.role, name: nameDisplay });

      const stateAnnotation = buildStateAnnotation(node);
      line = `${indent}${refId}: [${node.role}] "${nameDisplay}"${stateAnnotation}`;
    } else {
      // For the root WebArea / RootWebArea, emit a special header line
      if (
        depth === 0 &&
        (node.role === "WebArea" || node.role === "RootWebArea")
      ) {
        line = `[Page] Title: ${nameDisplay}`;
      } else {
        line = `${indent}[${node.role}] "${nameDisplay}"`;
      }
    }

    if (!appendLine(line)) {
      return false;
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        if (!walk(child, depth + 1)) {
          return false;
        }
      }
    }

    return true;
  }

  walk(snapshot, 0);

  if (truncated) {
    lines.push("\n[Snapshot truncated]");
  }

  return { text: lines.join("\n"), refs };
}
