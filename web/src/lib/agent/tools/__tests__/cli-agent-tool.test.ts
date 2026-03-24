/**
 * Unit tests for the CliAgentTool and formatCliCompletionMessage
 */

import { CliAgentTool, formatCliCompletionMessage } from "../cli-agent-tool";

describe("CliAgentTool", () => {
  let tool: CliAgentTool;
  const mockWorkspace = "/test/workspace";

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new CliAgentTool(mockWorkspace);
  });

  describe("initialization", () => {
    it("should have correct name and description", () => {
      expect(tool.name).toBe("cli_agent");
      expect(tool.description).toContain("Codex agent");
      expect(tool.description).toContain("autonomous");
    });

    it("should have all required parameters", () => {
      const paramNames = tool.parameters.map((p) => p.name);
      expect(paramNames).toContain("prompt");
      expect(paramNames).toContain("working_directory");
      expect(paramNames).toContain("sandbox");
      expect(paramNames).toContain("skip_git_check");
      expect(paramNames).toContain("ephemeral");
    });

    it("should require prompt parameter", () => {
      const promptParam = tool.parameters.find((p) => p.name === "prompt");
      expect(promptParam?.required).toBe(true);
    });

    it("should have sandbox enum with three options", () => {
      const sandboxParam = tool.parameters.find((p) => p.name === "sandbox");
      expect(sandboxParam?.enum).toEqual([
        "read-only",
        "workspace-write",
        "danger-full-access",
      ]);
    });

    it("should require approval", () => {
      expect(tool.requiresApproval).toBe(true);
    });
  });

  describe("parameters validation", () => {
    it("prompt should be required and of type string", () => {
      const promptParam = tool.parameters.find((p) => p.name === "prompt");
      expect(promptParam?.required).toBe(true);
      expect(promptParam?.type).toBe("string");
    });

    it("working_directory should be optional and of type string", () => {
      const param = tool.parameters.find((p) => p.name === "working_directory");
      expect(param?.required).toBe(false);
      expect(param?.type).toBe("string");
    });

    it("sandbox should be optional with enum values", () => {
      const param = tool.parameters.find((p) => p.name === "sandbox");
      expect(param?.required).toBe(false);
      expect(param?.type).toBe("string");
      expect(param?.enum).toEqual([
        "read-only",
        "workspace-write",
        "danger-full-access",
      ]);
    });

    it("skip_git_check should be optional and of type boolean", () => {
      const param = tool.parameters.find((p) => p.name === "skip_git_check");
      expect(param?.required).toBe(false);
      expect(param?.type).toBe("boolean");
    });

    it("ephemeral should be optional and of type boolean", () => {
      const param = tool.parameters.find((p) => p.name === "ephemeral");
      expect(param?.required).toBe(false);
      expect(param?.type).toBe("boolean");
    });
  });

  describe("shell escaping", () => {
    it("escapeShellArg should wrap in single quotes", () => {
      const escaped = (tool as any).escapeShellArg("test");
      expect(escaped).toBe("'test'");
    });

    it("escapeShellArg should escape single quotes", () => {
      const escaped = (tool as any).escapeShellArg("test'quoted'");
      expect(escaped).toContain("\\'");
    });

    it("escapeShellArg handles multiple single quotes", () => {
      const escaped = (tool as any).escapeShellArg("a'b'c'd'");
      // Each single quote should be escaped
      const quoteCount = (escaped.match(/\\'/g) || []).length;
      expect(quoteCount).toBe(4);
    });

    it("escapeShellArg handles empty string", () => {
      const escaped = (tool as any).escapeShellArg("");
      expect(escaped).toBe("''");
    });
  });

  describe("constructor", () => {
    it("should store workspace path", () => {
      expect((tool as any).workspacePath).toBe(mockWorkspace);
    });
  });

  describe("description and metadata", () => {
    it("description should mention sandbox levels", () => {
      expect(tool.description).toContain("sandbox");
    });

    it("description should mention autonomous execution", () => {
      expect(tool.description).toContain("autonomous");
    });
  });
});

describe("formatCliCompletionMessage", () => {
  it("should format successful exit (code 0)", () => {
    const msg = formatCliCompletionMessage("done", 0);
    expect(msg).toContain("completed successfully");
    expect(msg).toContain("done");
  });

  it("should format failed exit (non-zero code)", () => {
    const msg = formatCliCompletionMessage("error output", 1);
    expect(msg).toContain("failed with exit code 1");
    expect(msg).toContain("error output");
  });

  it("should format terminated exit (code 137)", () => {
    const msg = formatCliCompletionMessage("killed", 137);
    expect(msg).toContain("was terminated");
  });

  it("should format terminated exit (code 143)", () => {
    const msg = formatCliCompletionMessage("killed", 143);
    expect(msg).toContain("was terminated");
  });

  it("should format unknown exit (null code)", () => {
    const msg = formatCliCompletionMessage("output", null);
    expect(msg).toContain("completed (exit status unknown)");
  });

  it("should include full output in message", () => {
    const output = "line 1\nline 2\nline 3";
    const msg = formatCliCompletionMessage(output, 0);
    expect(msg).toContain(output);
  });

  it("should ask for summary", () => {
    const msg = formatCliCompletionMessage("", 0);
    expect(msg).toContain("summarize what was accomplished");
  });
});
