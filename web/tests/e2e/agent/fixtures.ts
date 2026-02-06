/**
 * Playwright E2E test fixtures for BudAgent feature.
 *
 * These fixtures provide common test helpers for agent tests,
 * including setup for desktop mode, message sending, and response waiting.
 *
 * Note: Since this is a desktop app feature, tests need to enable desktop mode
 * by setting localStorage to simulate the Tauri environment.
 */

import { Page, expect } from "@playwright/test";

/**
 * Enable desktop mode by setting the localStorage flag.
 * This simulates running in a Tauri desktop environment.
 */
export async function enableDesktopMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("bud-is-desktop", "true");
    localStorage.setItem("bud-desktop-mode", "agent");
  });
}

/**
 * Switch to agent mode using the mode switcher.
 * Requires desktop mode to be enabled.
 */
export async function switchToAgentMode(page: Page): Promise<void> {
  const modeSwitcher = page.getByTestId("mode-switcher");
  await expect(modeSwitcher).toBeVisible({ timeout: 10000 });

  const agentButton = page.getByTestId("mode-switch-agent");
  await agentButton.click();

  // Wait for the BudAgentScreen to appear
  await expect(page.getByTestId("bud-agent-screen")).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Switch to chat mode using the mode switcher.
 * Requires desktop mode to be enabled.
 */
export async function switchToChatMode(page: Page): Promise<void> {
  const modeSwitcher = page.getByTestId("mode-switcher");
  await expect(modeSwitcher).toBeVisible({ timeout: 10000 });

  const chatButton = page.getByTestId("mode-switch-chat");
  await chatButton.click();

  // Wait for chat interface to appear
  await expect(page.getByTestId("bud-agent-screen")).not.toBeVisible({
    timeout: 10000,
  });
}

/**
 * Wait for the agent screen to be fully loaded.
 */
export async function waitForAgentScreen(page: Page): Promise<void> {
  await expect(page.getByTestId("bud-agent-screen")).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Send a message to the agent.
 * Uses the same ChatInputBar component as regular chat.
 */
export async function sendAgentMessage(
  page: Page,
  message: string
): Promise<void> {
  // The agent uses the same input component as chat
  const textarea = page.locator("#onyx-chat-input-textarea");
  await textarea.click();
  await textarea.fill(message);

  // Submit the message
  const sendButton = page.locator("#onyx-chat-input-send-button");
  await sendButton.click();
}

/**
 * Wait for an agent response to start streaming.
 * Returns when the first agent message appears.
 */
export async function waitForAgentResponse(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="agent-message-agent"]', {
    timeout: 30000,
  });
}

/**
 * Wait for the agent to complete processing.
 * Returns when the agent is no longer in thinking/streaming state.
 */
export async function waitForAgentComplete(
  page: Page,
  timeout: number = 60000
): Promise<void> {
  // Wait for the stop button to disappear, indicating processing is complete
  await page.waitForSelector('[data-testid="agent-stop-button"]', {
    state: "detached",
    timeout,
  });
}

/**
 * Wait for the agent to show a specific status.
 */
export async function waitForAgentStatus(
  page: Page,
  status: "thinking" | "streaming" | "complete" | "error" | "stopped"
): Promise<void> {
  if (status === "complete") {
    // Complete status means no status indicator is shown
    await page.waitForSelector('[data-testid="agent-message-status"]', {
      state: "detached",
      timeout: 30000,
    });
  } else {
    await page.waitForSelector('[data-testid="agent-message-status"]', {
      timeout: 30000,
    });
    const statusText = status === "thinking" ? "thinking..." : `${status}...`;
    await expect(page.getByTestId("agent-message-status")).toContainText(
      statusText
    );
  }
}

/**
 * Stop the agent execution by clicking the stop button.
 */
export async function stopAgent(page: Page): Promise<void> {
  const stopButton = page.getByTestId("agent-stop-button");
  await expect(stopButton).toBeVisible({ timeout: 5000 });
  await stopButton.click();
}

/**
 * Wait for the tool approval dialog to appear.
 */
export async function waitForToolApprovalDialog(page: Page): Promise<void> {
  await expect(page.getByTestId("tool-approval-dialog")).toBeVisible({
    timeout: 30000,
  });
}

/**
 * Approve a tool execution in the approval dialog.
 */
export async function approveToolExecution(page: Page): Promise<void> {
  const approveButton = page.getByTestId("tool-approval-approve");
  await expect(approveButton).toBeVisible({ timeout: 5000 });
  await approveButton.click();
}

/**
 * Deny a tool execution in the approval dialog.
 */
export async function denyToolExecution(page: Page): Promise<void> {
  const denyButton = page.getByTestId("tool-approval-deny");
  await expect(denyButton).toBeVisible({ timeout: 5000 });
  await denyButton.click();
}

/**
 * Wait for a specific tool call to appear in the UI.
 */
export async function waitForToolCall(
  page: Page,
  toolName: string
): Promise<void> {
  await page.waitForSelector(`[data-testid="tool-call-${toolName}"]`, {
    timeout: 30000,
  });
}

/**
 * Wait for a tool call to complete.
 */
export async function waitForToolComplete(
  page: Page,
  toolName: string
): Promise<void> {
  await page.waitForSelector(
    `[data-testid="tool-call-${toolName}"] [data-testid="tool-call-status-complete"]`,
    { timeout: 30000 }
  );
}

/**
 * Get the content of the latest agent message.
 */
export async function getLatestAgentMessageContent(
  page: Page
): Promise<string> {
  const messages = page.locator('[data-testid="agent-message-agent"]');
  const lastMessage = messages.last();
  return (await lastMessage.textContent()) || "";
}

/**
 * Get the count of messages in the agent chat.
 */
export async function getMessageCount(page: Page): Promise<{
  user: number;
  agent: number;
}> {
  const userMessages = await page
    .locator('[data-testid="agent-message-user"]')
    .count();
  const agentMessages = await page
    .locator('[data-testid="agent-message-agent"]')
    .count();
  return { user: userMessages, agent: agentMessages };
}

/**
 * Create a new agent session from the sidebar.
 */
export async function createNewAgentSession(page: Page): Promise<void> {
  // Click on the "New Agent Task" button in the sidebar
  const newTaskButton = page.locator(
    'button:has-text("New Agent Task"), [data-testid="AppSidebar/new-session"]'
  );
  await newTaskButton.click();

  // Wait for the intro screen to appear (empty session)
  await expect(page.getByTestId("agent-intro")).toBeVisible({ timeout: 5000 });
}

/**
 * Get the list of agent sessions from the sidebar.
 */
export async function getAgentSessionCount(page: Page): Promise<number> {
  // Agent sessions appear in the sidebar under "Agent Tasks" section
  const sessions = page.locator('[data-testid^="agent-session-"]');
  return await sessions.count();
}

/**
 * Mock the agent API response with custom SSE events.
 * This is useful for testing specific scenarios without actual LLM calls.
 */
export async function mockAgentResponse(
  page: Page,
  events: Array<{
    type: string;
    content?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolCallId?: string;
    toolOutput?: string;
    toolError?: string;
    error?: string;
  }>
): Promise<void> {
  await page.route("**/api/local-agent/execute", async (route) => {
    // Build SSE response from events
    const sseData = events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
      body: sseData,
    });
  });
}

/**
 * Mock a simple text response from the agent.
 */
export async function mockSimpleAgentResponse(
  page: Page,
  responseText: string
): Promise<void> {
  await mockAgentResponse(page, [
    { type: "thinking" },
    { type: "text", content: responseText },
    { type: "complete", content: responseText },
    { type: "done" },
  ]);
}

/**
 * Mock an agent response that uses a tool.
 */
export async function mockAgentResponseWithTool(
  page: Page,
  options: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolOutput: string;
    finalResponse: string;
  }
): Promise<void> {
  const toolCallId = `test-tool-call-${Date.now()}`;

  await mockAgentResponse(page, [
    { type: "thinking" },
    {
      type: "tool_start",
      toolName: options.toolName,
      toolInput: options.toolInput,
      toolCallId,
    },
    {
      type: "tool_result",
      toolName: options.toolName,
      toolOutput: options.toolOutput,
      toolCallId,
    },
    { type: "text", content: options.finalResponse },
    { type: "complete", content: options.finalResponse },
    { type: "done" },
  ]);
}

/**
 * Mock an agent response that requires tool approval.
 */
export async function mockAgentResponseWithApproval(
  page: Page,
  options: {
    toolName: string;
    toolInput: Record<string, unknown>;
  }
): Promise<void> {
  const toolCallId = `test-tool-call-${Date.now()}`;

  await mockAgentResponse(page, [
    { type: "thinking" },
    {
      type: "approval_required",
      toolName: options.toolName,
      toolInput: options.toolInput,
      toolCallId,
    },
  ]);
}

/**
 * Mock the tool approval endpoint.
 */
export async function mockToolApproval(
  page: Page,
  toolOutput: string,
  finalResponse: string
): Promise<void> {
  // First, mock the approval endpoint
  await page.route("**/api/local-agent/approve", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  // The agent will resume and send more events - these would need to be
  // handled in a more sophisticated way in real tests, but for now we can
  // at least test that the approval dialog works
}

/**
 * Wait for page to be ready after navigation.
 */
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForLoadState("domcontentloaded");
}

/**
 * Login and navigate to agent mode.
 * Complete setup for agent tests.
 */
export async function setupAgentTest(
  page: Page,
  credentials: { email: string; password: string }
): Promise<void> {
  // Enable desktop mode before navigation
  await enableDesktopMode(page);

  // Navigate to login
  await page.goto("http://localhost:3000/auth/login");

  // Fill login form
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);

  // Submit login
  await page.click('button[type="submit"]');

  // Wait for redirect to chat
  try {
    await page.waitForURL("http://localhost:3000/chat", { timeout: 10000 });
  } catch {
    // Try signup if login failed
    await page.goto("http://localhost:3000/auth/signup");
    await page.fill("#email", credentials.email);
    await page.fill("#password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await page.waitForURL(/localhost:3000\/chat/, { timeout: 10000 });
  }

  await waitForPageReady(page);

  // The mode switcher should now be visible (desktop mode enabled)
  // Wait a bit for the desktop mode to initialize
  await page.waitForTimeout(500);
}
