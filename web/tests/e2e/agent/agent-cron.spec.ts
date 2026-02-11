/**
 * E2E tests for BudAgent cron/scheduled tasks UI.
 *
 * Tests:
 * - Navigating to the Scheduled Tasks view via sidebar
 * - Notification bell visibility
 * - Creating a scheduled task via the create dialog
 * - Verifying the job appears in the list
 * - Opening and closing the notification panel
 * - Deleting a job
 *
 * These tests require desktop mode to be simulated since the cron UI
 * is a desktop-only (Tauri) feature.
 *
 * Manually verified via Playwright MCP browser on https://chat.pnap.bud.studio:
 * - All data-testid attributes correctly placed
 * - Full create/delete/notification flow works end-to-end
 * - Screenshots saved: cron-jobs-view.png, cron-notification-panel.png
 */

import { test, expect } from "@chromatic-com/playwright";
import {
  switchToAgentMode,
  setupAgentTest,
} from "./fixtures";

const TEST_CREDENTIALS = {
  email: "admin_user@test.com",
  password: "TestPassword123!",
};

test.describe("BudAgent Cron/Scheduled Tasks", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await setupAgentTest(page, TEST_CREDENTIALS);
  });

  test("should navigate to cron view and create a scheduled task", async ({
    page,
  }) => {
    // Ensure desktop mode and switch to agent
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);

    // Navigate to cron view via sidebar
    const cronTab = page.getByTestId("sidebar-cron-tab");
    await expect(cronTab).toBeVisible({ timeout: 10000 });
    await cronTab.click();

    // Verify cron jobs view is visible
    const cronView = page.getByTestId("cron-jobs-view");
    await expect(cronView).toBeVisible({ timeout: 10000 });

    // Verify "Scheduled Tasks" heading is present
    await expect(page.getByText("Scheduled Tasks").first()).toBeVisible();

    // Click "New Task" — use JS click to avoid fixed header overlap
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="cron-new-job-button"]'
      ) as HTMLElement;
      el?.click();
    });

    // Verify create dialog is open
    const createDialog = page.getByTestId("cron-form-dialog");
    await expect(createDialog).toBeVisible({ timeout: 5000 });

    // Fill in the form
    await page.getByTestId("cron-form-name").fill("E2E Test Task");
    await page
      .getByTestId("cron-form-prompt")
      .fill("Check HEARTBEAT.md for any pending tasks");

    // Submit the form
    const submitButton = page.getByTestId("cron-form-submit");
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for dialog to close and job to appear
    await expect(createDialog).not.toBeVisible({ timeout: 10000 });

    // Verify the new job appears in the table
    await expect(page.getByText("E2E Test Task")).toBeVisible({
      timeout: 10000,
    });

    // Cleanup: delete the test job
    // Accept the confirmation dialog that appears on delete
    page.on("dialog", (dialog) => dialog.accept());
    const jobRow = page.locator("[data-testid^='cron-job-row-']").first();
    const deleteButton = jobRow.locator("button:has-text('Delete')");
    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      await expect(page.getByText("E2E Test Task")).not.toBeVisible({
        timeout: 10000,
      });
    }
  });

  test("should open and close notification panel", async ({ page }) => {
    // Ensure desktop mode
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);

    // Click notification bell (sidebar notification button)
    const bell = page.getByText("Notifications").first();
    await expect(bell).toBeVisible({ timeout: 10000 });
    await bell.click();

    // Verify notification panel opens
    const panel = page.getByTestId("cron-notification-panel");
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Verify panel has the "Notifications" heading
    await expect(
      panel.getByText("Notifications").first()
    ).toBeVisible();

    // Close the panel by clicking the close button (X button, top-right)
    const closeButton = panel.locator("button").first();
    await closeButton.click();

    // Verify panel is closed
    await expect(panel).not.toBeVisible({ timeout: 5000 });
  });

  test("should delete a cron job", async ({ page }) => {
    // Ensure desktop mode and navigate to cron view
    await page.evaluate(() => {
      localStorage.setItem("bud-is-desktop", "true");
      localStorage.setItem("bud-desktop-mode", "agent");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await switchToAgentMode(page);

    // Navigate to cron view
    const cronTab = page.getByTestId("sidebar-cron-tab");
    await expect(cronTab).toBeVisible({ timeout: 10000 });
    await cronTab.click();

    const cronView = page.getByTestId("cron-jobs-view");
    await expect(cronView).toBeVisible({ timeout: 10000 });

    // Create a job to delete
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="cron-new-job-button"]'
      ) as HTMLElement;
      el?.click();
    });

    const createDialog = page.getByTestId("cron-form-dialog");
    await expect(createDialog).toBeVisible({ timeout: 5000 });

    await page.getByTestId("cron-form-name").fill("Job To Delete");
    await page
      .getByTestId("cron-form-prompt")
      .fill("Test prompt for deletion");
    await page.getByTestId("cron-form-submit").click();

    // Wait for dialog to close
    await expect(createDialog).not.toBeVisible({ timeout: 10000 });

    // Verify job appears
    await expect(page.getByText("Job To Delete")).toBeVisible({
      timeout: 10000,
    });

    // Accept the confirmation dialog that appears on delete
    page.on("dialog", (dialog) => dialog.accept());

    // Find and click Delete on the newest job row
    const jobRows = page.locator("[data-testid^='cron-job-row-']");
    const firstRow = jobRows.first();
    const deleteBtn = firstRow.locator("button:has-text('Delete')");
    await deleteBtn.click();

    // Verify the job is removed
    await expect(page.getByText("Job To Delete")).not.toBeVisible({
      timeout: 10000,
    });
  });
});
