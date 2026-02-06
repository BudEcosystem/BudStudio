/**
 * E2E tests for BudAgent chat functionality.
 *
 * Tests the core agent chat features including:
 * - Sending messages to the agent
 * - Receiving agent responses
 * - Tool execution display
 * - Tool approval dialog
 * - Stop button functionality
 *
 * Note: These tests require desktop mode to be simulated since the BudAgent
 * feature is desktop-only.
 */

import { test, expect } from "@chromatic-com/playwright";
import {
  enableDesktopMode,
  switchToAgentMode,
  sendAgentMessage,
  waitForAgentResponse,
  waitForAgentComplete,
  waitForAgentScreen,
  stopAgent,
  waitForToolApprovalDialog,
  approveToolExecution,
  denyToolExecution,
  waitForToolCall,
  getLatestAgentMessageContent,
  getMessageCount,
  mockSimpleAgentResponse,
  mockAgentResponseWithTool,
  mockAgentResponseWithApproval,
  setupAgentTest,
} from "./fixtures";

// Test credentials (using existing test user)
const TEST_CREDENTIALS = {
  email: "admin_user@test.com",
  password: "TestPassword123!",
};

test.describe("BudAgent Chat Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Clear cookies for fresh session
    await page.context().clearCookies();

    // Setup agent test environment
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should display agent screen when switching to agent mode", async ({
    page,
  }) => {
    // The mode switcher should be visible after desktop mode is enabled
    const modeSwitcher = page.getByTestId("mode-switcher");

    // If mode switcher is not visible, we're not in desktop mode
    // This can happen if the localStorage wasn't applied before page load
    if (!(await modeSwitcher.isVisible())) {
      // Re-enable desktop mode and reload
      await page.evaluate(() => {
        localStorage.setItem("bud-is-desktop", "true");
        localStorage.setItem("bud-desktop-mode", "agent");
      });
      await page.reload();
      await page.waitForLoadState("networkidle");
    }

    // Wait for mode switcher
    await expect(modeSwitcher).toBeVisible({ timeout: 10000 });

    // Switch to agent mode
    await switchToAgentMode(page);

    // Verify agent screen is visible
    await waitForAgentScreen(page);

    // Verify intro screen is shown (no messages yet)
    await expect(page.getByTestId("agent-intro")).toBeVisible();

    // Verify the title
    await expect(page.locator("h2:has-text('Bud Agent')")).toBeVisible();
  });

  test("should send message to agent and display user message", async ({
    page,
  }) => {
    // Switch to agent mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock a simple response from the agent
    await mockSimpleAgentResponse(
      page,
      "Hello! I understand you want to test the agent. How can I help you?"
    );

    // Send a test message
    const testMessage = "Hello, this is a test message";
    await sendAgentMessage(page, testMessage);

    // Verify user message is displayed
    const userMessage = page.locator('[data-testid="agent-message-user"]');
    await expect(userMessage).toBeVisible({ timeout: 5000 });
    await expect(userMessage).toContainText(testMessage);

    // Verify message count
    const counts = await getMessageCount(page);
    expect(counts.user).toBe(1);
  });

  test("should display agent response after sending message", async ({
    page,
  }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock the agent response
    const expectedResponse =
      "I received your test message and am responding now.";
    await mockSimpleAgentResponse(page, expectedResponse);

    // Send a message
    await sendAgentMessage(page, "Test message for agent response");

    // Wait for agent response
    await waitForAgentResponse(page);

    // Wait for completion
    await waitForAgentComplete(page);

    // Verify agent message is displayed
    const agentMessage = page.locator('[data-testid="agent-message-agent"]');
    await expect(agentMessage).toBeVisible({ timeout: 10000 });

    // Verify message content
    const content = await getLatestAgentMessageContent(page);
    expect(content).toContain(expectedResponse);

    // Verify message count
    const counts = await getMessageCount(page);
    expect(counts.user).toBe(1);
    expect(counts.agent).toBe(1);
  });

  test("should show tool execution in UI when agent uses a tool", async ({
    page,
  }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock an agent response that uses a tool
    await mockAgentResponseWithTool(page, {
      toolName: "read_file",
      toolInput: { path: "/test/file.txt" },
      toolOutput: "File content here",
      finalResponse: "I read the file and found the content you were looking for.",
    });

    // Send a message that would trigger tool usage
    await sendAgentMessage(page, "Read the test file");

    // Wait for the tool call to appear
    await waitForToolCall(page, "read_file");

    // Verify the tool call is displayed
    const toolCall = page.locator('[data-testid="tool-call-read_file"]');
    await expect(toolCall).toBeVisible({ timeout: 10000 });

    // Wait for completion
    await waitForAgentComplete(page);

    // Verify tool calls section is shown in the agent message
    const toolCallsSection = page.getByTestId("agent-tool-calls");
    await expect(toolCallsSection).toBeVisible();
  });

  test("should show tool approval dialog for dangerous tools", async ({
    page,
  }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock an agent response that requires approval
    await mockAgentResponseWithApproval(page, {
      toolName: "bash",
      toolInput: { command: "echo 'test'" },
    });

    // Send a message that would trigger a dangerous tool
    await sendAgentMessage(page, "Run echo test in the terminal");

    // Wait for the approval dialog to appear
    await waitForToolApprovalDialog(page);

    // Verify the dialog content
    const dialog = page.getByTestId("tool-approval-dialog");
    await expect(dialog).toBeVisible();

    // Verify tool name is shown
    await expect(dialog.locator("code")).toContainText("bash");

    // Verify approve and deny buttons are present
    await expect(page.getByTestId("tool-approval-approve")).toBeVisible();
    await expect(page.getByTestId("tool-approval-deny")).toBeVisible();
  });

  test("should allow approving tool execution", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock the approval response
    await mockAgentResponseWithApproval(page, {
      toolName: "write_file",
      toolInput: { path: "/test/output.txt", content: "test content" },
    });

    // Mock the approve endpoint
    await page.route("**/api/local-agent/approve", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    // Send message
    await sendAgentMessage(page, "Write to the test file");

    // Wait for approval dialog
    await waitForToolApprovalDialog(page);

    // Approve the tool
    await approveToolExecution(page);

    // Verify dialog is closed
    await expect(page.getByTestId("tool-approval-dialog")).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("should allow denying tool execution", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock the approval response
    await mockAgentResponseWithApproval(page, {
      toolName: "bash",
      toolInput: { command: "rm -rf /important" },
    });

    // Mock the deny endpoint
    await page.route("**/api/local-agent/approve", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    // Send message
    await sendAgentMessage(page, "Delete the important folder");

    // Wait for approval dialog
    await waitForToolApprovalDialog(page);

    // Deny the tool
    await denyToolExecution(page);

    // Verify dialog is closed
    await expect(page.getByTestId("tool-approval-dialog")).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("should show stop button during agent processing", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock a slow response (just thinking, no completion)
    await page.route("**/api/local-agent/execute", async (route) => {
      // Send just the thinking event and keep the connection open
      const sseData = 'data: {"type":"thinking"}\n\n';

      // Create a delayed response that doesn't complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
        body: sseData,
      });
    });

    // Send message
    await sendAgentMessage(page, "Do something that takes time");

    // Wait for stop button to appear
    const stopButton = page.getByTestId("agent-stop-button");
    await expect(stopButton).toBeVisible({ timeout: 5000 });

    // Verify button text
    await expect(stopButton).toContainText("Stop Agent");
  });

  test("should stop agent execution when stop button is clicked", async ({
    page,
  }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Track if abort was called
    let abortCalled = false;

    // Mock a slow response
    await page.route("**/api/local-agent/execute", async (route, request) => {
      // Check if request was aborted
      request.frame().page().on("request", (req) => {
        if (req.isNavigationRequest()) {
          abortCalled = true;
        }
      });

      // Send thinking event and delay completion
      const sseData =
        'data: {"type":"thinking"}\n\ndata: {"type":"text","content":"Processing..."}\n\n';

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
        body: sseData,
      });
    });

    // Send message
    await sendAgentMessage(page, "Start a long task");

    // Wait for stop button
    const stopButton = page.getByTestId("agent-stop-button");
    await expect(stopButton).toBeVisible({ timeout: 5000 });

    // Click stop
    await stopAgent(page);

    // Verify stop button disappears (processing stopped)
    await expect(stopButton).not.toBeVisible({ timeout: 10000 });
  });

  test("should switch between chat and agent modes", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "chat");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verify mode switcher is visible
    const modeSwitcher = page.getByTestId("mode-switcher");
    await expect(modeSwitcher).toBeVisible({ timeout: 10000 });

    // Switch to agent mode
    await page.getByTestId("mode-switch-agent").click();

    // Verify agent screen appears
    await expect(page.getByTestId("bud-agent-screen")).toBeVisible({
      timeout: 10000,
    });

    // Switch back to chat mode
    await page.getByTestId("mode-switch-chat").click();

    // Verify agent screen is gone
    await expect(page.getByTestId("bud-agent-screen")).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("should display suggestion buttons on empty agent screen", async ({
    page,
  }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Verify the intro screen is shown
    await expect(page.getByTestId("agent-intro")).toBeVisible();

    // Verify suggestion buttons are present
    const suggestions = page.locator(
      '[data-testid="agent-intro"] button:has-text("Research")'
    );
    await expect(suggestions.first()).toBeVisible();

    // Click a suggestion and verify it fills the input
    await suggestions.first().click();

    // Verify the textarea was filled
    const textarea = page.locator("#onyx-chat-input-textarea");
    const value = await textarea.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });
});
