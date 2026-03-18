import { ProcessTool } from "../process-tool";

describe("ProcessTool", () => {
  const tool = new ProcessTool();

  it("has correct metadata", () => {
    expect(tool.name).toBe("process");
    expect(tool.requiresApproval).toBe(false);
  });

  it("returns error when action is missing", async () => {
    const result = await tool.execute({});
    expect(result).toContain("Error: action parameter is required");
  });

  it("returns error for unknown action", async () => {
    const result = await tool.execute({ action: "invalid" });
    expect(result).toContain("unknown action 'invalid'");
  });

  it("list returns empty message when no sessions", async () => {
    const result = await tool.execute({ action: "list" });
    expect(result).toBe("No active or recent process sessions.");
  });

  it("poll returns error when session_id is missing", async () => {
    const result = await tool.execute({ action: "poll" });
    expect(result).toContain("session_id is required");
  });

  it("poll returns error for nonexistent session", async () => {
    const result = await tool.execute({
      action: "poll",
      session_id: "ps_nonexistent",
    });
    expect(result).toContain("Error: Session not found");
  });

  it("log returns error when session_id is missing", async () => {
    const result = await tool.execute({ action: "log" });
    expect(result).toContain("session_id is required");
  });

  it("write returns error when input is missing", async () => {
    const result = await tool.execute({
      action: "write",
      session_id: "ps_1",
    });
    expect(result).toContain("input parameter is required");
  });

  it("send_keys returns error when keys is missing", async () => {
    const result = await tool.execute({
      action: "send_keys",
      session_id: "ps_1",
    });
    expect(result).toContain("keys parameter is required");
  });

  it("kill returns error for nonexistent session", async () => {
    const result = await tool.execute({
      action: "kill",
      session_id: "ps_nonexistent",
    });
    expect(result).toContain("Error: Session not found");
  });

  it("remove returns error for nonexistent session", async () => {
    const result = await tool.execute({
      action: "remove",
      session_id: "ps_nonexistent",
    });
    expect(result).toContain("Error: Session not found");
  });
});
