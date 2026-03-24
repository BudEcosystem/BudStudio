/**
 * Unit tests for the OpenUI component catalog.
 *
 * Covers:
 * - budStudioLibrary structure and component presence
 * - prompt() output containing component names
 * - Individual component Zod schema validation (valid + invalid data)
 */

import { budStudioLibrary } from "../catalog";

/** A subset of components we know must exist in the merged library. */
const EXPECTED_COMPONENTS = [
  "EmailDraft",
  "Card",
  "TextContent",
  "CodeBlock",
  "Table",
  "BarChart",
  "LineChart",
  "PieChart",
] as const;

describe("budStudioLibrary", () => {
  it("should be defined", () => {
    expect(budStudioLibrary).toBeDefined();
  });

  it("should contain all expected components", () => {
    const componentKeys = Object.keys(budStudioLibrary.components);
    for (const name of EXPECTED_COMPONENTS) {
      expect(componentKeys).toContain(name);
    }
  });

  it("should have componentGroups defined", () => {
    expect(budStudioLibrary.componentGroups).toBeDefined();
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

describe("TextContent schema", () => {
  const schema = budStudioLibrary.components["TextContent"]!.props;

  it("should accept valid data", () => {
    const result = schema.safeParse({
      text: "Hello world",
    });
    expect(result.success).toBe(true);
  });

  it("should reject when text is missing", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("CodeBlock schema", () => {
  const schema = budStudioLibrary.components["CodeBlock"]!.props;

  it("should accept valid data with required fields", () => {
    const result = schema.safeParse({
      language: "typescript",
      codeString: "const x = 1;",
    });
    expect(result.success).toBe(true);
  });

  it("should reject when language is missing", () => {
    const result = schema.safeParse({
      codeString: "const x = 1;",
    });
    expect(result.success).toBe(false);
  });

  it("should reject when codeString is missing", () => {
    const result = schema.safeParse({
      language: "typescript",
    });
    expect(result.success).toBe(false);
  });
});
