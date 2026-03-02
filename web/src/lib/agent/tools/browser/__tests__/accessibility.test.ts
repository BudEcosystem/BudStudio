/**
 * Tests for the accessibility tree formatter module.
 *
 * Tests cover:
 * - Null snapshot handling
 * - Interactive element ref assignment
 * - Non-interactive element rendering (no refs)
 * - Nested element indentation
 * - Noise node filtering
 * - State annotations (checked, value, etc.)
 * - Output truncation at MAX_OUTPUT_CHARS
 *
 * All tests exercise `formatAccessibilityTree` with mock accessibility
 * snapshots. No mocking is needed since this is pure function testing.
 */

import {
  formatAccessibilityTree,
  AccessibilityNode,
  RefEntry,
} from "../accessibility";

describe("formatAccessibilityTree", () => {
  describe("null snapshot", () => {
    it("should return a no-snapshot message and empty refs map", () => {
      const result = formatAccessibilityTree(null);

      expect(result.text).toBe("[No accessibility snapshot available]");
      expect(result.refs).toBeInstanceOf(Map);
      expect(result.refs.size).toBe(0);
    });
  });

  describe("simple page with interactive elements", () => {
    const snapshot: AccessibilityNode = {
      role: "WebArea",
      name: "Test Page",
      children: [
        { role: "link", name: "Home" },
        { role: "button", name: "Submit" },
        { role: "textbox", name: "Search", value: "hello" },
      ],
    };

    let result: { text: string; refs: Map<string, RefEntry> };

    beforeEach(() => {
      result = formatAccessibilityTree(snapshot);
    });

    it("should include the page title header", () => {
      expect(result.text).toContain("[Page] Title: Test Page");
    });

    it("should assign refs e1, e2, e3 to the three interactive elements", () => {
      expect(result.refs.size).toBe(3);
      expect(result.refs.has("e1")).toBe(true);
      expect(result.refs.has("e2")).toBe(true);
      expect(result.refs.has("e3")).toBe(true);
    });

    it("should map e1 to the link element", () => {
      const entry = result.refs.get("e1");
      expect(entry).toBeDefined();
      expect(entry!.role).toBe("link");
      expect(entry!.name).toBe("Home");
    });

    it("should map e2 to the button element", () => {
      const entry = result.refs.get("e2");
      expect(entry).toBeDefined();
      expect(entry!.role).toBe("button");
      expect(entry!.name).toBe("Submit");
    });

    it("should map e3 to the textbox element", () => {
      const entry = result.refs.get("e3");
      expect(entry).toBeDefined();
      expect(entry!.role).toBe("textbox");
      expect(entry!.name).toBe("Search");
    });

    it("should render the link with its ref in the output text", () => {
      expect(result.text).toContain('e1: [link] "Home"');
    });

    it("should render the button with its ref in the output text", () => {
      expect(result.text).toContain('e2: [button] "Submit"');
    });

    it("should render the textbox value annotation", () => {
      expect(result.text).toContain('(value: "hello")');
    });
  });

  describe("non-interactive elements have no refs", () => {
    const snapshot: AccessibilityNode = {
      role: "WebArea",
      name: "Page",
      children: [
        { role: "heading", name: "Welcome" },
        { role: "paragraph", name: "Some text" },
        { role: "button", name: "Click" },
      ],
    };

    let result: { text: string; refs: Map<string, RefEntry> };

    beforeEach(() => {
      result = formatAccessibilityTree(snapshot);
    });

    it("should only assign a ref to the button", () => {
      expect(result.refs.size).toBe(1);
      expect(result.refs.has("e1")).toBe(true);
      expect(result.refs.get("e1")!.role).toBe("button");
      expect(result.refs.get("e1")!.name).toBe("Click");
    });

    it("should include the heading text in the output without a ref prefix", () => {
      expect(result.text).toContain('[heading] "Welcome"');
      // Verify it does NOT have a ref prefix like "e1:" before it
      const headingLine = result.text
        .split("\n")
        .find((line) => line.includes('[heading] "Welcome"'));
      expect(headingLine).toBeDefined();
      expect(headingLine).not.toMatch(/e\d+:/);
    });

    it("should include the paragraph text in the output without a ref prefix", () => {
      expect(result.text).toContain('[paragraph] "Some text"');
      const paragraphLine = result.text
        .split("\n")
        .find((line) => line.includes('[paragraph] "Some text"'));
      expect(paragraphLine).toBeDefined();
      expect(paragraphLine).not.toMatch(/e\d+:/);
    });
  });

  describe("nested elements", () => {
    const snapshot: AccessibilityNode = {
      role: "WebArea",
      name: "Nested Page",
      children: [
        {
          role: "navigation",
          name: "Main Nav",
          children: [
            { role: "link", name: "About" },
            {
              role: "list",
              name: "Menu",
              children: [{ role: "button", name: "Action" }],
            },
          ],
        },
      ],
    };

    it("should increase indentation for child elements", () => {
      const result = formatAccessibilityTree(snapshot);
      const lines = result.text.split("\n");

      // Root (depth 0): no indentation
      const rootLine = lines.find((l) => l.includes("[Page] Title:"));
      expect(rootLine).toBeDefined();
      expect(rootLine!.startsWith("[Page]")).toBe(true);

      // Navigation (depth 1): 2 spaces
      const navLine = lines.find((l) => l.includes('[navigation] "Main Nav"'));
      expect(navLine).toBeDefined();
      expect(navLine!.startsWith("  ")).toBe(true);
      expect(navLine!.startsWith("    ")).toBe(false);

      // Link (depth 2): 4 spaces
      const linkLine = lines.find((l) => l.includes('[link] "About"'));
      expect(linkLine).toBeDefined();
      expect(linkLine!.startsWith("    ")).toBe(true);
      expect(linkLine!.startsWith("      ")).toBe(false);

      // List (depth 2): 4 spaces
      const listLine = lines.find((l) => l.includes('[list] "Menu"'));
      expect(listLine).toBeDefined();
      expect(listLine!.startsWith("    ")).toBe(true);

      // Button (depth 3): 6 spaces
      const buttonLine = lines.find((l) => l.includes('[button] "Action"'));
      expect(buttonLine).toBeDefined();
      expect(buttonLine!.startsWith("      ")).toBe(true);
      expect(buttonLine!.startsWith("        ")).toBe(false);
    });
  });

  describe("noise filtering", () => {
    it("should skip elements with empty name and no children", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "generic", name: "" },
          { role: "button", name: "OK" },
          { role: "separator", name: "  " },
        ],
      };

      const result = formatAccessibilityTree(snapshot);

      // The empty-name "generic" and whitespace-only "separator" should be skipped
      expect(result.text).not.toContain("[generic]");
      expect(result.text).not.toContain("[separator]");
      // The button should still be present
      expect(result.text).toContain('[button] "OK"');
      expect(result.refs.size).toBe(1);
    });

    it("should keep elements with empty name but that have children", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "generic",
            name: "",
            children: [{ role: "link", name: "Inner Link" }],
          },
        ],
      };

      const result = formatAccessibilityTree(snapshot);

      // The generic element has children so it should be kept
      expect(result.text).toContain("[generic]");
      expect(result.text).toContain('[link] "Inner Link"');
    });
  });

  describe("checkbox state annotation", () => {
    it("should annotate a checked checkbox with (checked)", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Form",
        children: [
          { role: "checkbox", name: "Accept Terms", checked: true },
        ],
      };

      const result = formatAccessibilityTree(snapshot);

      expect(result.text).toContain('e1: [checkbox] "Accept Terms" (checked)');
      expect(result.refs.get("e1")!.role).toBe("checkbox");
    });

    it("should annotate a mixed checkbox with (mixed)", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Form",
        children: [
          { role: "checkbox", name: "Select All", checked: "mixed" },
        ],
      };

      const result = formatAccessibilityTree(snapshot);

      expect(result.text).toContain('e1: [checkbox] "Select All" (mixed)');
    });

    it("should not annotate an unchecked checkbox with checked", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Form",
        children: [
          { role: "checkbox", name: "Newsletter", checked: false },
        ],
      };

      const result = formatAccessibilityTree(snapshot);

      expect(result.text).not.toContain("(checked)");
      expect(result.text).not.toContain("(mixed)");
    });

    it("should combine multiple state annotations", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Form",
        children: [
          {
            role: "textbox",
            name: "Email",
            value: "user@test.com",
            required: true,
            disabled: true,
          },
        ],
      };

      const result = formatAccessibilityTree(snapshot);

      const textboxLine = result.text
        .split("\n")
        .find((l) => l.includes('[textbox] "Email"'));
      expect(textboxLine).toBeDefined();
      expect(textboxLine).toContain('value: "user@test.com"');
      expect(textboxLine).toContain("disabled");
      expect(textboxLine).toContain("required");
    });
  });

  describe("truncation", () => {
    it("should truncate output exceeding 50,000 characters and append truncation marker", () => {
      // Build a snapshot with enough children to exceed 50,000 chars.
      // Each child line looks like: "  eN: [button] "Button NNNNN...""
      // With a long enough name, each line is ~80+ chars.
      const children: AccessibilityNode[] = [];
      for (let i = 0; i < 1500; i++) {
        children.push({
          role: "button",
          name: `Button ${i} ${"x".repeat(50)}`,
        });
      }

      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Large Page",
        children,
      };

      const result = formatAccessibilityTree(snapshot);

      expect(result.text).toContain("[Snapshot truncated]");
      // Not all 1500 buttons should have refs since truncation stops the walk
      expect(result.refs.size).toBeLessThan(1500);
      // But some refs should still exist
      expect(result.refs.size).toBeGreaterThan(0);
    });

    it("should not include truncation marker when output fits within the limit", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Small Page",
        children: [
          { role: "button", name: "One" },
          { role: "button", name: "Two" },
        ],
      };

      const result = formatAccessibilityTree(snapshot);

      expect(result.text).not.toContain("[Snapshot truncated]");
    });
  });

  describe("additional state annotations", () => {
    it("should annotate expanded elements", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "button", name: "Menu", expanded: true },
        ],
      };

      const result = formatAccessibilityTree(snapshot);
      expect(result.text).toContain("(expanded)");
    });

    it("should annotate collapsed elements", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "button", name: "Menu", expanded: false },
        ],
      };

      const result = formatAccessibilityTree(snapshot);
      expect(result.text).toContain("(collapsed)");
    });

    it("should annotate selected elements", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "tab", name: "Tab 1", selected: true },
        ],
      };

      const result = formatAccessibilityTree(snapshot);
      expect(result.text).toContain("(selected)");
    });

    it("should annotate readonly elements", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "textbox", name: "ReadOnly Field", readonly: true },
        ],
      };

      const result = formatAccessibilityTree(snapshot);
      expect(result.text).toContain("(readonly)");
    });

    it("should annotate pressed toggle buttons", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "button", name: "Bold", pressed: true },
        ],
      };

      const result = formatAccessibilityTree(snapshot);
      expect(result.text).toContain("(pressed)");
    });

    it("should use valuetext when value is absent", () => {
      const snapshot: AccessibilityNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "slider", name: "Volume", valuetext: "50%" },
        ],
      };

      const result = formatAccessibilityTree(snapshot);
      expect(result.text).toContain('(value: "50%")');
    });
  });

  describe("all interactive roles receive refs", () => {
    const interactiveRoles = [
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
    ];

    it.each(interactiveRoles)(
      "should assign a ref to a %s element",
      (role) => {
        const snapshot: AccessibilityNode = {
          role: "WebArea",
          name: "Page",
          children: [{ role, name: `Test ${role}` }],
        };

        const result = formatAccessibilityTree(snapshot);

        expect(result.refs.size).toBe(1);
        expect(result.refs.get("e1")!.role).toBe(role);
      }
    );
  });

  describe("RootWebArea variant", () => {
    it("should treat RootWebArea the same as WebArea at depth 0", () => {
      const snapshot: AccessibilityNode = {
        role: "RootWebArea",
        name: "My Page",
        children: [{ role: "link", name: "Click" }],
      };

      const result = formatAccessibilityTree(snapshot);

      expect(result.text).toContain("[Page] Title: My Page");
      expect(result.refs.size).toBe(1);
    });
  });
});
