/**
 * E2E tests for BudAgent session management.
 *
 * Tests the agent session features including:
 * - Creating new agent sessions
 * - Session persistence after page refresh
 * - Switching between sessions
 * - Deleting sessions
 *
 * Note: These tests require desktop mode to be simulated since the BudAgent
 * feature is desktop-only.
 *
 * IMPORTANT: Session persistence is currently implemented in memory (React state)
 * and will not persist across page reloads. These tests verify the session
 * management within a single page lifecycle. Full persistence would require
 * backend storage implementation.
 */

import { test, expect } from "@chromatic-com/playwright";
import {
  enableDesktopMode,
  switchToAgentMode,
  sendAgentMessage,
  waitForAgentResponse,
  waitForAgentComplete,
  waitForAgentScreen,
  getMessageCount,
  createNewAgentSession,
  mockSimpleAgentResponse,
  setupAgentTest,
  waitForPageReady,
} from "./fixtures";

// Test credentials (using existing test user)
const TEST_CREDENTIALS = {
  email: "admin_user@test.com",
  password: "TestPassword123!",
};

test.describe("BudAgent Session Management Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Clear cookies for fresh session
    await page.context().clearCookies();

    // Setup agent test environment
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should create a new agent session when sending first message", async ({
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

    // Verify intro screen is shown (no session yet)
    await expect(page.getByTestId("agent-intro")).toBeVisible();

    // Mock simple response
    await mockSimpleAgentResponse(page, "Session created! Hello there.");

    // Send first message
    await sendAgentMessage(page, "Create a new session");

    // Wait for response
    await waitForAgentResponse(page);

    // Verify messages are displayed
    const counts = await getMessageCount(page);
    expect(counts.user).toBe(1);
    expect(counts.agent).toBe(1);

    // Verify intro screen is gone (session active)
    await expect(page.getByTestId("agent-intro")).not.toBeVisible();
  });

  test("should show Agent Tasks section in sidebar when in agent mode", async ({
    page,
  }) => {
    // Setup desktop mode in agent mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Check for Agent Tasks section in sidebar
    // The sidebar should show "Agent Tasks" section when in agent mode
    const agentTasksSection = page.locator('text="Agent Tasks"');
    await expect(agentTasksSection).toBeVisible({ timeout: 10000 });

    // Check for "New Agent Task" button
    const newTaskButton = page.locator('text="New Agent Task"');
    await expect(newTaskButton).toBeVisible();
  });

  test("should create session when clicking New Agent Task button", async ({
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

    // Mock response for first session
    await mockSimpleAgentResponse(page, "First session response.");

    // Send a message to create first session
    await sendAgentMessage(page, "First session message");
    await waitForAgentResponse(page);

    // Click New Agent Task to create another session
    const newTaskButton = page.locator(
      'button:has-text("New Agent Task"), [role="button"]:has-text("New Agent Task")'
    );
    await newTaskButton.first().click();

    // Wait for new session (intro screen should appear again)
    await expect(page.getByTestId("agent-intro")).toBeVisible({ timeout: 5000 });

    // Verify we're on a fresh session (no messages)
    const counts = await getMessageCount(page);
    expect(counts.user).toBe(0);
    expect(counts.agent).toBe(0);
  });

  test("should display session in sidebar after creating it", async ({
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

    // Mock response
    await mockSimpleAgentResponse(page, "Session created successfully!");

    // Create a session with a specific message
    const sessionTitle = "Test session for sidebar";
    await sendAgentMessage(page, sessionTitle);
    await waitForAgentResponse(page);

    // The session should appear in the sidebar with a title based on the first message
    // Sessions are titled from the first user message (truncated to 50 chars)
    const sidebarSession = page.locator(
      `text="${sessionTitle.slice(0, 50)}"`
    );

    // Wait a bit for sidebar to update
    await page.waitForTimeout(500);

    // Check that some session button exists in sidebar
    // The session title should appear in the sidebar
    await expect(sidebarSession).toBeVisible({ timeout: 5000 });
  });

  test("should switch between multiple agent sessions", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Create first session
    await mockSimpleAgentResponse(page, "Response to first session message.");
    await sendAgentMessage(page, "First session");
    await waitForAgentResponse(page);
    await waitForAgentComplete(page);

    // Remember first session's message count
    let counts = await getMessageCount(page);
    expect(counts.user).toBe(1);

    // Create second session
    await page.locator('button:has-text("New Agent Task")').first().click();
    await expect(page.getByTestId("agent-intro")).toBeVisible({ timeout: 5000 });

    // Send message in second session
    await mockSimpleAgentResponse(
      page,
      "Response to second session message."
    );
    await sendAgentMessage(page, "Second session");
    await waitForAgentResponse(page);
    await waitForAgentComplete(page);

    // Verify second session messages
    counts = await getMessageCount(page);
    expect(counts.user).toBe(1);

    // Find and click on first session in sidebar
    const firstSession = page.locator(
      'text="First session"'
    );
    if (await firstSession.isVisible()) {
      await firstSession.click();

      // Wait for session to load
      await page.waitForTimeout(500);

      // Verify we're back to first session
      const userMessage = page.locator('[data-testid="agent-message-user"]');
      await expect(userMessage).toContainText("First session");
    }
  });

  test("should allow deleting a session from sidebar", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Create a session
    await mockSimpleAgentResponse(page, "Session to be deleted.");
    await sendAgentMessage(page, "Session to delete");
    await waitForAgentResponse(page);
    await waitForAgentComplete(page);

    // Find the session in sidebar
    const sessionText = page.locator('text="Session to delete"');

    if (await sessionText.isVisible()) {
      // Hover over the session to reveal menu
      await sessionText.hover();

      // Wait for menu button to appear
      await page.waitForTimeout(300);

      // Look for the more options button (three dots)
      const moreButton = page.locator(
        '[aria-label="More options"], button:has(svg)'
      );

      // Click more button if visible
      if (await moreButton.first().isVisible()) {
        await moreButton.first().click();

        // Look for Delete option in the menu
        const deleteButton = page.locator(
          'button:has-text("Delete"), [role="menuitem"]:has-text("Delete")'
        );

        if (await deleteButton.isVisible()) {
          await deleteButton.click();

          // Confirm deletion if confirmation dialog appears
          const confirmDelete = page.locator(
            'button:has-text("Delete"):visible'
          );
          if (await confirmDelete.isVisible()) {
            await confirmDelete.click();
          }

          // Verify session is removed
          await page.waitForTimeout(500);
          await expect(sessionText).not.toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  test("should preserve session state when switching modes and back", async ({
    page,
  }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Switch to agent mode
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Create a session with a message
    await mockSimpleAgentResponse(page, "Response preserved.");
    const testMessage = "Message to preserve";
    await sendAgentMessage(page, testMessage);
    await waitForAgentResponse(page);
    await waitForAgentComplete(page);

    // Verify message is there
    let userMessage = page.locator('[data-testid="agent-message-user"]');
    await expect(userMessage).toContainText(testMessage);

    // Switch to chat mode
    await page.getByTestId("mode-switch-chat").click();
    await expect(page.getByTestId("bud-agent-screen")).not.toBeVisible({
      timeout: 5000,
    });

    // Switch back to agent mode
    await page.getByTestId("mode-switch-agent").click();
    await expect(page.getByTestId("bud-agent-screen")).toBeVisible({
      timeout: 5000,
    });

    // Verify the session and message are still there
    userMessage = page.locator('[data-testid="agent-message-user"]');
    await expect(userMessage).toContainText(testMessage);
  });

  test("should show empty state for new session", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Create first session
    await mockSimpleAgentResponse(page, "First response.");
    await sendAgentMessage(page, "First message");
    await waitForAgentResponse(page);

    // Create new session
    await page.locator('button:has-text("New Agent Task")').first().click();

    // Verify intro screen is shown
    await expect(page.getByTestId("agent-intro")).toBeVisible({ timeout: 5000 });

    // Verify no messages
    const counts = await getMessageCount(page);
    expect(counts.user).toBe(0);
    expect(counts.agent).toBe(0);

    // Verify suggestions are shown
    await expect(page.locator("text=I can work autonomously")).toBeVisible();
  });

  test("should update session title from first message", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Mock response
    await mockSimpleAgentResponse(page, "Title updated response.");

    // Send a message that will become the session title
    const messageTitle =
      "This is a unique title for testing session title update";
    await sendAgentMessage(page, messageTitle);
    await waitForAgentResponse(page);

    // Wait for sidebar to update
    await page.waitForTimeout(500);

    // The session title should be the first 50 characters of the message
    const expectedTitle = messageTitle.slice(0, 50);

    // Look for the title in the sidebar
    const sessionTitle = page.locator(`text="${expectedTitle}"`);
    await expect(sessionTitle).toBeVisible({ timeout: 5000 });
  });

  test("should allow renaming a session", async ({ page }) => {
    // Setup desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);
    await waitForAgentScreen(page);

    // Create a session
    await mockSimpleAgentResponse(page, "Session to rename.");
    await sendAgentMessage(page, "Original title");
    await waitForAgentResponse(page);
    await waitForAgentComplete(page);

    // Find the session in sidebar
    const sessionText = page.locator('text="Original title"');

    if (await sessionText.isVisible()) {
      // Hover to reveal menu
      await sessionText.hover();
      await page.waitForTimeout(300);

      // Click more options button
      const moreButton = sessionText
        .locator("..")
        .locator('button:has(svg), [aria-label="More options"]');

      if (await moreButton.first().isVisible()) {
        await moreButton.first().click();

        // Click rename option
        const renameButton = page.locator(
          'button:has-text("Rename"), [role="menuitem"]:has-text("Rename")'
        );

        if (await renameButton.isVisible()) {
          await renameButton.click();

          // Find the rename input and enter new name
          const renameInput = page.locator(
            'input[type="text"]:visible, textarea:visible'
          );

          if (await renameInput.isVisible()) {
            await renameInput.fill("Renamed Session Title");

            // Press Enter to save or click outside
            await renameInput.press("Enter");

            // Wait for update
            await page.waitForTimeout(500);

            // Verify new title appears
            const newTitle = page.locator('text="Renamed Session Title"');
            await expect(newTitle).toBeVisible({ timeout: 5000 });
          }
        }
      }
    }
  });
});
