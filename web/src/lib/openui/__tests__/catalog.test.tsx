/**
 * Unit tests for the OpenUI component catalog.
 *
 * Covers:
 * - budStudioLibrary structure and component count
 * - prompt() output containing all component names
 * - Individual component Zod schema validation (valid + invalid data)
 */

import { z } from "zod";
import { budStudioLibrary } from "../catalog";

const COMPONENT_NAMES = [
  "EmailDraft",
  "DataTable",
  "Chart",
  "CodeBlock",
  "AnalysisReport",
  "Card",
  "TextContent",
  "ActionButtons",
] as const;

describe("budStudioLibrary", () => {
  it("should be defined", () => {
    expect(budStudioLibrary).toBeDefined();
  });

  it("should contain exactly 8 components", () => {
    const componentKeys = Object.keys(budStudioLibrary.components);
    expect(componentKeys).toHaveLength(8);
  });

  it("should contain all expected component names", () => {
    const componentKeys = Object.keys(budStudioLibrary.components);
    for (const name of COMPONENT_NAMES) {
      expect(componentKeys).toContain(name);
    }
  });

  describe("prompt()", () => {
    it("should return a non-empty string", () => {
      const prompt = budStudioLibrary.prompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should mention every component name", () => {
      const prompt = budStudioLibrary.prompt();
      for (const name of COMPONENT_NAMES) {
        expect(prompt).toContain(name);
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Per-component schema validation                                    */
/* ------------------------------------------------------------------ */

describe("EmailDraft schema", () => {
  const schema = budStudioLibrary.components["EmailDraft"]!.props;

  it("should accept valid data with required fields", () => {
    const result = schema.safeParse({
      to: ["alice@example.com"],
      subject: "Hello",
      body: "World",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with optional cc", () => {
    const result = schema.safeParse({
      to: ["alice@example.com"],
      cc: ["bob@example.com"],
      subject: "Hello",
      body: "World",
    });
    expect(result.success).toBe(true);
  });

  it("should reject when 'to' is missing", () => {
    const result = schema.safeParse({
      subject: "Hello",
      body: "World",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when 'subject' is missing", () => {
    const result = schema.safeParse({
      to: ["alice@example.com"],
      body: "World",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when 'to' is not an array", () => {
    const result = schema.safeParse({
      to: "alice@example.com",
      subject: "Hello",
      body: "World",
    });
    expect(result.success).toBe(false);
  });
});

describe("DataTable schema", () => {
  const schema = budStudioLibrary.components["DataTable"]!.props;

  it("should accept valid data", () => {
    const result = schema.safeParse({
      columns: [{ key: "name", label: "Name", type: "string" }],
      rows: [{ name: "Alice" }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with optional title", () => {
    const result = schema.safeParse({
      title: "People",
      columns: [{ key: "name", label: "Name", type: "string" }],
      rows: [{ name: "Alice" }],
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid column type", () => {
    const result = schema.safeParse({
      columns: [{ key: "name", label: "Name", type: "boolean" }],
      rows: [{ name: "Alice" }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject when columns is missing", () => {
    const result = schema.safeParse({
      rows: [{ name: "Alice" }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject when rows is missing", () => {
    const result = schema.safeParse({
      columns: [{ key: "name", label: "Name", type: "string" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("Chart schema", () => {
  const schema = budStudioLibrary.components["Chart"]!.props;

  it("should accept valid bar chart data", () => {
    const result = schema.safeParse({
      type: "bar",
      data: [{ month: "Jan", revenue: 100 }],
      xKey: "month",
      yKey: "revenue",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid line chart with optional title", () => {
    const result = schema.safeParse({
      type: "line",
      title: "Revenue over time",
      data: [{ month: "Jan", revenue: 100 }],
      xKey: "month",
      yKey: "revenue",
    });
    expect(result.success).toBe(true);
  });

  it("should accept pie chart type", () => {
    const result = schema.safeParse({
      type: "pie",
      data: [{ category: "A", value: 30 }],
      xKey: "category",
      yKey: "value",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid chart type", () => {
    const result = schema.safeParse({
      type: "scatter",
      data: [{ x: 1, y: 2 }],
      xKey: "x",
      yKey: "y",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when xKey is missing", () => {
    const result = schema.safeParse({
      type: "bar",
      data: [{ month: "Jan", revenue: 100 }],
      yKey: "revenue",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when yKey is missing", () => {
    const result = schema.safeParse({
      type: "bar",
      data: [{ month: "Jan", revenue: 100 }],
      xKey: "month",
    });
    expect(result.success).toBe(false);
  });
});

describe("CodeBlock schema", () => {
  const schema = budStudioLibrary.components["CodeBlock"]!.props;

  it("should accept valid data with required fields", () => {
    const result = schema.safeParse({
      language: "typescript",
      code: "const x = 1;",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with optional filename", () => {
    const result = schema.safeParse({
      language: "python",
      code: "print('hello')",
      filename: "main.py",
    });
    expect(result.success).toBe(true);
  });

  it("should reject when language is missing", () => {
    const result = schema.safeParse({
      code: "const x = 1;",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when code is missing", () => {
    const result = schema.safeParse({
      language: "typescript",
    });
    expect(result.success).toBe(false);
  });
});

describe("AnalysisReport schema", () => {
  const schema = budStudioLibrary.components["AnalysisReport"]!.props;

  it("should accept valid data", () => {
    const result = schema.safeParse({
      title: "Q4 Analysis",
      summary: "Revenue grew 15%",
      sections: [{ title: "Revenue", content: "Details here..." }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty sections array", () => {
    const result = schema.safeParse({
      title: "Report",
      summary: "Summary text",
      sections: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject when title is missing", () => {
    const result = schema.safeParse({
      summary: "Summary",
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it("should reject when summary is missing", () => {
    const result = schema.safeParse({
      title: "Report",
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it("should reject section without title", () => {
    const result = schema.safeParse({
      title: "Report",
      summary: "Summary",
      sections: [{ content: "Details" }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject section without content", () => {
    const result = schema.safeParse({
      title: "Report",
      summary: "Summary",
      sections: [{ title: "Section" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("Card schema", () => {
  const schema = budStudioLibrary.components["Card"]!.props;

  it("should accept valid data with required title", () => {
    const result = schema.safeParse({
      title: "My Card",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with optional subtitle", () => {
    const result = schema.safeParse({
      title: "My Card",
      subtitle: "A description",
    });
    expect(result.success).toBe(true);
  });

  it("should reject when title is missing", () => {
    const result = schema.safeParse({
      subtitle: "A description",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when title is not a string", () => {
    const result = schema.safeParse({
      title: 123,
    });
    expect(result.success).toBe(false);
  });
});

describe("TextContent schema", () => {
  const schema = budStudioLibrary.components["TextContent"]!.props;

  it("should accept valid data with text only", () => {
    const result = schema.safeParse({
      text: "Hello world",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with small size", () => {
    const result = schema.safeParse({
      text: "Hello world",
      size: "small",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with default size", () => {
    const result = schema.safeParse({
      text: "Hello world",
      size: "default",
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with large size", () => {
    const result = schema.safeParse({
      text: "Hello world",
      size: "large",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid size value", () => {
    const result = schema.safeParse({
      text: "Hello world",
      size: "xlarge",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when text is missing", () => {
    const result = schema.safeParse({
      size: "default",
    });
    expect(result.success).toBe(false);
  });
});

describe("ActionButtons schema", () => {
  const schema = budStudioLibrary.components["ActionButtons"]!.props;

  it("should accept valid data with minimal button", () => {
    const result = schema.safeParse({
      buttons: [{ label: "Click me", action: "do_something" }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid data with variant", () => {
    const result = schema.safeParse({
      buttons: [
        { label: "Save", action: "save", variant: "primary" },
        { label: "Cancel", action: "cancel", variant: "secondary" },
        { label: "Delete", action: "delete", variant: "danger" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty buttons array", () => {
    const result = schema.safeParse({
      buttons: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid variant", () => {
    const result = schema.safeParse({
      buttons: [{ label: "Click", action: "do", variant: "warning" }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject button without label", () => {
    const result = schema.safeParse({
      buttons: [{ action: "do_something" }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject button without action", () => {
    const result = schema.safeParse({
      buttons: [{ label: "Click me" }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject when buttons is missing", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });
});
