import { stripAnsi } from "../strip-ansi";

describe("stripAnsi", () => {
  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("strips CSI color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("strips bold/underline sequences", () => {
    expect(stripAnsi("\x1b[1mbold\x1b[22m \x1b[4munderline\x1b[24m")).toBe(
      "bold underline"
    );
  });

  it("strips cursor movement sequences", () => {
    expect(stripAnsi("\x1b[2Jcleared\x1b[H")).toBe("cleared");
  });

  it("strips OSC sequences (terminal title etc)", () => {
    expect(stripAnsi("\x1b]0;my title\x07content")).toBe("content");
  });

  it("strips private mode sequences like [?2026h", () => {
    // These are the exact sequences seen from the Claude installer
    expect(
      stripAnsi("[?2026h Installing...[?2026l")
    ).toBe("[?2026h Installing...[?2026l");
    // The ESC prefix is needed for them to be ANSI sequences
    expect(
      stripAnsi("\x1b[?2026h Installing...\x1b[?2026l")
    ).toBe(" Installing...");
  });

  it("strips control characters except newline and carriage return", () => {
    // \x00 (NUL) and \x01 (SOH) stripped; \x0a (LF) and \x0d (CR) preserved
    expect(stripAnsi("a\x00b\x01c\x0ad\x0de")).toBe("abc\x0ad\x0de");
  });

  it("preserves newlines", () => {
    expect(stripAnsi("line1\nline2\n")).toBe("line1\nline2\n");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("handles string with only ANSI codes", () => {
    expect(stripAnsi("\x1b[31m\x1b[0m")).toBe("");
  });

  it("handles mixed content with multiple ANSI sequences", () => {
    const input =
      "\x1b[32m✓\x1b[0m Tests passed \x1b[1m(5/5)\x1b[22m\n\x1b[33mWarning:\x1b[0m slow";
    expect(stripAnsi(input)).toBe("✓ Tests passed (5/5)\nWarning: slow");
  });
});
