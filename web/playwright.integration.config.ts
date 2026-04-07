/**
 * Playwright config for running integration tests against a remote deployment.
 *
 * Skips global-setup (which requires localhost:3000) and uses env vars:
 *   E2E_BASE_URL      — deployment URL (default: http://localhost:3000)
 *   E2E_USER_EMAIL    — login email
 *   E2E_USER_PASSWORD — login password
 */
import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config({ path: ".vscode/.env" });

export default defineConfig({
  // No globalSetup — the integration test handles its own auth
  timeout: 180000, // 3 minutes per test (sub-sessions need time)
  expect: {
    timeout: 15000,
  },
  retries: 0,
  reporter: [["list"]],
  testMatch: /.*sub-session-integration\.spec\.ts/,
  projects: [
    {
      name: "integration",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        // No storageState — tests log in themselves
      },
    },
  ],
});
