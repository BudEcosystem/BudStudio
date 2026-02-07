/**
 * E2E tests for BudAgent backend-orchestrated execution.
 *
 * These tests verify the chat UI connects to the backend agent orchestrator
 * and handles the streaming response correctly. Most tests use API-level
 * assertions (via the Playwright `request` fixture) to validate backend
 * endpoints without requiring an LLM. One UI test verifies the
 * BudAgentScreen renders properly.
 *
 * Note: These tests require desktop mode to be simulated since the BudAgent
 * feature is desktop-only.
 */

import { test, expect } from "@chromatic-com/playwright";
import {
  enableDesktopMode,
  switchToAgentMode,
  waitForAgentScreen,
  setupAgentTest,
  waitForPageReady,
} from "./fixtures";

// Test credentials (using existing test user)
const TEST_CREDENTIALS = {
  email: "admin_user@test.com",
  password: "TestPassword123!",
};

// ---------------------------------------------------------------------------
// UI Tests
// ---------------------------------------------------------------------------

test.describe("BudAgent Backend Execution - UI", () => {
  test.beforeEach(async ({ page }) => {
    // Clear cookies for fresh session
    await page.context().clearCookies();

    // Setup agent test environment (login + desktop mode)
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should display the BudAgent screen with intro and suggestions", async ({
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

    // Verify the agent title is present
    await expect(page.locator("h2:has-text('Bud Agent')")).toBeVisible();

    // Verify suggestion buttons are present (at least one)
    const suggestions = page.locator('[data-testid="agent-intro"] button');
    const count = await suggestions.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify chat input is available
    const textarea = page.locator("#onyx-chat-input-textarea");
    await expect(textarea).toBeVisible();
  });

  test("should show mode switcher with agent and chat options", async ({
    page,
  }) => {
    // Setup desktop mode in chat mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "chat");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verify mode switcher is visible
    const modeSwitcher = page.getByTestId("mode-switcher");
    await expect(modeSwitcher).toBeVisible({ timeout: 10000 });

    // Verify agent switch button is present
    const agentButton = page.getByTestId("mode-switch-agent");
    await expect(agentButton).toBeVisible();

    // Verify chat switch button is present
    const chatButton = page.getByTestId("mode-switch-chat");
    await expect(chatButton).toBeVisible();

    // Switch to agent mode
    await agentButton.click();

    // Verify agent screen appears
    await expect(page.getByTestId("bud-agent-screen")).toBeVisible({
      timeout: 10000,
    });

    // Switch back to chat mode
    await chatButton.click();

    // Verify agent screen is gone
    await expect(page.getByTestId("bud-agent-screen")).not.toBeVisible({
      timeout: 10000,
    });
  });
});

// ---------------------------------------------------------------------------
// API Tests - Session Management
// ---------------------------------------------------------------------------

test.describe("BudAgent Backend Execution - Session API", () => {
  test.beforeEach(async ({ page }) => {
    // Clear cookies and login to establish an authenticated session.
    // The page context shares cookies with the `request` fixture.
    await page.context().clearCookies();
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should create an agent session via API", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      {
        data: { title: "E2E Backend Test Session" },
      }
    );
    expect(createResponse.ok()).toBeTruthy();

    const sessionData = await createResponse.json();
    expect(sessionData.session_id).toBeTruthy();

    // Fetch the session and verify
    const getResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionData.session_id}`
    );
    expect(getResponse.ok()).toBeTruthy();

    const session = await getResponse.json();
    expect(session.title).toBe("E2E Backend Test Session");
    expect(session.status).toBe("active");
    expect(session.total_tokens_used).toBe(0);
    expect(session.total_tool_calls).toBe(0);

    // Clean up
    const deleteResponse = await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionData.session_id}`
    );
    expect(deleteResponse.ok()).toBeTruthy();
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.status).toBe("deleted");
  });

  test("should list agent sessions via API", async ({ request }) => {
    // Create two sessions
    const res1 = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "List Test Session 1" } }
    );
    const { session_id: sessionId1 } = await res1.json();

    const res2 = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "List Test Session 2" } }
    );
    const { session_id: sessionId2 } = await res2.json();

    // List sessions
    const listResponse = await request.get(
      "http://localhost:3000/api/agent/sessions"
    );
    expect(listResponse.ok()).toBeTruthy();

    const listBody = await listResponse.json();
    expect(listBody.sessions).toBeDefined();
    expect(Array.isArray(listBody.sessions)).toBe(true);

    // Our sessions should be in the list
    const sessionIds = listBody.sessions.map(
      (s: { id: string }) => s.id
    );
    expect(sessionIds).toContain(sessionId1);
    expect(sessionIds).toContain(sessionId2);

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId1}`
    );
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId2}`
    );
  });

  test("should return 404 for non-existent session", async ({ request }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const getResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${fakeId}`
    );
    expect(getResponse.status()).toBe(404);
  });

  test("should delete a session and confirm it is gone", async ({
    request,
  }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Session To Delete" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Delete it
    const deleteResponse = await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    expect(deleteResponse.ok()).toBeTruthy();

    // Verify it is gone
    const getResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    expect(getResponse.status()).toBe(404);
  });

  test("should update session title via API", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Original Title" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Update title
    const patchResponse = await request.patch(
      `http://localhost:3000/api/agent/sessions/${sessionId}/title`,
      { data: { title: "Updated Title" } }
    );
    expect(patchResponse.ok()).toBeTruthy();

    const patchBody = await patchResponse.json();
    expect(patchBody.title).toBe("Updated Title");

    // Verify via GET
    const getResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    const session = await getResponse.json();
    expect(session.title).toBe("Updated Title");

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });

  test("should update session status via API", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Status Test Session" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Update status to completed
    const patchResponse = await request.patch(
      `http://localhost:3000/api/agent/sessions/${sessionId}/status`,
      { data: { status: "completed" } }
    );
    expect(patchResponse.ok()).toBeTruthy();

    const patchBody = await patchResponse.json();
    expect(patchBody.status).toBe("completed");

    // Verify via GET
    const getResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    const session = await getResponse.json();
    expect(session.status).toBe("completed");

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });
});

// ---------------------------------------------------------------------------
// API Tests - Messages and History
// ---------------------------------------------------------------------------

test.describe("BudAgent Backend Execution - Message API", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should add messages and retrieve history via API", async ({
    request,
  }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Message Test Session" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Add a user message
    const msgResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
      { data: { role: "user", content: "Hello from E2E test!" } }
    );
    expect(msgResponse.ok()).toBeTruthy();
    const msgBody = await msgResponse.json();
    expect(msgBody.message_id).toBeTruthy();

    // Add an assistant message
    const assistantResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
      { data: { role: "assistant", content: "I am the agent, hello!" } }
    );
    expect(assistantResponse.ok()).toBeTruthy();

    // Retrieve the history
    const historyResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}/history`
    );
    expect(historyResponse.ok()).toBeTruthy();

    const history = await historyResponse.json();
    expect(history.messages).toBeDefined();
    expect(history.messages.length).toBe(2);

    // First message should be the user message
    expect(history.messages[0].role).toBe("user");
    expect(history.messages[0].content).toBe("Hello from E2E test!");

    // Second message should be the assistant message
    expect(history.messages[1].role).toBe("assistant");
    expect(history.messages[1].content).toBe("I am the agent, hello!");

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });

  test("should add a tool message with tool metadata", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Tool Message Test" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Add a tool message
    const toolResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
      {
        data: {
          role: "tool",
          tool_name: "read_file",
          tool_input: { path: "/test/file.txt" },
          tool_output: { content: "File contents here" },
        },
      }
    );
    expect(toolResponse.ok()).toBeTruthy();

    // Verify the message in history
    const historyResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}/history`
    );
    const history = await historyResponse.json();
    expect(history.messages.length).toBe(1);

    const toolMsg = history.messages[0];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_name).toBe("read_file");
    expect(toolMsg.tool_input).toEqual({ path: "/test/file.txt" });
    expect(toolMsg.tool_output).toEqual({ content: "File contents here" });

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });

  test("should reject invalid role in message", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Invalid Role Test" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Try adding a message with an invalid role
    const badResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
      { data: { role: "invalid_role", content: "This should fail" } }
    );
    expect(badResponse.status()).toBe(400);

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });

  test("should paginate history with limit and offset", async ({
    request,
  }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Pagination Test" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Add 5 messages
    for (let i = 0; i < 5; i++) {
      await request.post(
        `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
        { data: { role: "user", content: `Message ${i}` } }
      );
    }

    // Get first 2 messages
    const page1 = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}/history?limit=2&offset=0`
    );
    expect(page1.ok()).toBeTruthy();
    const page1Body = await page1.json();
    expect(page1Body.messages.length).toBe(2);
    expect(page1Body.messages[0].content).toBe("Message 0");

    // Get next 2 messages
    const page2 = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}/history?limit=2&offset=2`
    );
    expect(page2.ok()).toBeTruthy();
    const page2Body = await page2.json();
    expect(page2Body.messages.length).toBe(2);
    expect(page2Body.messages[0].content).toBe("Message 2");

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });
});

// ---------------------------------------------------------------------------
// API Tests - Memory Management
// ---------------------------------------------------------------------------

test.describe("BudAgent Backend Execution - Memory API", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should create and list memories via API", async ({ request }) => {
    // Create a memory
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/memories",
      { data: { content: "E2E test memory - user prefers dark mode" } }
    );
    expect(createResponse.ok()).toBeTruthy();

    const memory = await createResponse.json();
    expect(memory.id).toBeTruthy();
    expect(memory.content).toBe("E2E test memory - user prefers dark mode");
    expect(memory.source).toBe("user_input");

    // List memories and verify ours is present
    const listResponse = await request.get(
      "http://localhost:3000/api/agent/memories"
    );
    expect(listResponse.ok()).toBeTruthy();

    const listBody = await listResponse.json();
    expect(listBody.memories).toBeDefined();
    expect(Array.isArray(listBody.memories)).toBe(true);
    expect(listBody.memories.length).toBeGreaterThan(0);

    const found = listBody.memories.find(
      (m: { id: string }) => m.id === memory.id
    );
    expect(found).toBeDefined();
    expect(found.content).toBe("E2E test memory - user prefers dark mode");

    // Clean up
    const deleteResponse = await request.delete(
      `http://localhost:3000/api/agent/memories/${memory.id}`
    );
    expect(deleteResponse.ok()).toBeTruthy();
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.status).toBe("deleted");
  });

  test("should reject empty memory content", async ({ request }) => {
    const badResponse = await request.post(
      "http://localhost:3000/api/agent/memories",
      { data: { content: "" } }
    );
    expect(badResponse.status()).toBe(400);
  });

  test("should return 404 when deleting non-existent memory", async ({
    request,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const deleteResponse = await request.delete(
      `http://localhost:3000/api/agent/memories/${fakeId}`
    );
    expect(deleteResponse.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// API Tests - Tool Result and Approval
// ---------------------------------------------------------------------------

test.describe("BudAgent Backend Execution - Tool Interaction API", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should submit tool result via API", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Tool Result Test Session" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Submit a tool result (the Redis key will be set even without an
    // active orchestrator; this verifies the endpoint works)
    const toolResultResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/tool-result`,
      {
        data: {
          tool_call_id: "test-tool-call-1",
          output: "test file contents",
        },
      }
    );
    expect(toolResultResponse.ok()).toBeTruthy();
    const toolBody = await toolResultResponse.json();
    expect(toolBody.status).toBe("submitted");

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });

  test("should submit approval via API", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Approval Test Session" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Submit an approval
    const approvalResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/approval`,
      {
        data: {
          tool_call_id: "test-tool-call-2",
          approved: true,
        },
      }
    );
    expect(approvalResponse.ok()).toBeTruthy();
    const approvalBody = await approvalResponse.json();
    expect(approvalBody.status).toBe("submitted");

    // Submit a denial
    const denialResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/approval`,
      {
        data: {
          tool_call_id: "test-tool-call-3",
          approved: false,
        },
      }
    );
    expect(denialResponse.ok()).toBeTruthy();

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });

  test("should stop agent execution via API", async ({ request }) => {
    // Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      { data: { title: "Stop Test Session" } }
    );
    const { session_id: sessionId } = await createResponse.json();

    // Stop the agent (sets a Redis key the orchestrator checks)
    const stopResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/stop`
    );
    expect(stopResponse.ok()).toBeTruthy();
    const stopBody = await stopResponse.json();
    expect(stopBody.status).toBe("stopping");

    // Clean up
    await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
  });

  test("should return 404 for tool result on non-existent session", async ({
    request,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request.post(
      `http://localhost:3000/api/agent/sessions/${fakeId}/tool-result`,
      {
        data: {
          tool_call_id: "fake-call",
          output: "test",
        },
      }
    );
    expect(response.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// API Tests - Full Session Lifecycle
// ---------------------------------------------------------------------------

test.describe("BudAgent Backend Execution - Session Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should complete a full session lifecycle via API", async ({
    request,
  }) => {
    // Step 1: Create a session
    const createResponse = await request.post(
      "http://localhost:3000/api/agent/sessions",
      {
        data: {
          title: "Full Lifecycle Test",
          workspace_path: "/tmp/e2e-test",
        },
      }
    );
    expect(createResponse.ok()).toBeTruthy();
    const { session_id: sessionId } = await createResponse.json();

    // Step 2: Verify session is active
    const getResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    const session = await getResponse.json();
    expect(session.status).toBe("active");
    expect(session.workspace_path).toBe("/tmp/e2e-test");

    // Step 3: Add a user message
    const userMsgResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
      { data: { role: "user", content: "Please read my file" } }
    );
    expect(userMsgResponse.ok()).toBeTruthy();

    // Step 4: Add an assistant response
    const assistantMsgResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
      { data: { role: "assistant", content: "I will read your file now." } }
    );
    expect(assistantMsgResponse.ok()).toBeTruthy();

    // Step 5: Add a tool execution record
    const toolMsgResponse = await request.post(
      `http://localhost:3000/api/agent/sessions/${sessionId}/messages`,
      {
        data: {
          role: "tool",
          tool_name: "read_file",
          tool_input: { path: "/tmp/e2e-test/example.txt" },
          tool_output: { content: "Hello World" },
        },
      }
    );
    expect(toolMsgResponse.ok()).toBeTruthy();

    // Step 6: Verify the history
    const historyResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}/history`
    );
    const history = await historyResponse.json();
    expect(history.messages.length).toBe(3);
    expect(history.messages[0].role).toBe("user");
    expect(history.messages[1].role).toBe("assistant");
    expect(history.messages[2].role).toBe("tool");

    // Step 7: Update session status to completed
    const statusResponse = await request.patch(
      `http://localhost:3000/api/agent/sessions/${sessionId}/status`,
      { data: { status: "completed" } }
    );
    expect(statusResponse.ok()).toBeTruthy();

    // Step 8: Verify session is completed
    const finalGetResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    const finalSession = await finalGetResponse.json();
    expect(finalSession.status).toBe("completed");

    // Step 9: Delete the session
    const deleteResponse = await request.delete(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    expect(deleteResponse.ok()).toBeTruthy();

    // Step 10: Verify deletion
    const deletedGetResponse = await request.get(
      `http://localhost:3000/api/agent/sessions/${sessionId}`
    );
    expect(deletedGetResponse.status()).toBe(404);
  });
});
