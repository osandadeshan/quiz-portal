import { defineConfig, devices } from "@playwright/test";
import path from "path";

// One id per run: the quiz title gets it so every run's data is unique.
// Set before importing env.ts; workers inherit it from this process.
process.env.E2E_RUN_ID ||= new Date().toISOString().slice(0, 19).replace("T", " ");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { APP_URL, PORTS, ADMIN, MAIL_FROM, OUTPUT_DIR } = require("./e2e/support/env") as typeof import("./e2e/support/env");

export default defineConfig({
  testDir: path.join(__dirname, "e2e", "specs"),
  outputDir: path.join(OUTPUT_DIR, "test-results"),
  // The lifecycle tests share one quiz and run in order.
  fullyParallel: false,
  workers: 1,
  // A serial flow can't be retried halfway; fix flakiness instead of hiding it.
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 3 * 60_000,
  expect: { timeout: 10_000 },
  // Cleanup: global setup records a baseline of the database and inbox; global
  // teardown (always runs, pass or fail) deletes every quiz, invitation, answer,
  // session and email the run created and verifies the baseline is restored.
  // Playwright starts the webServer before setup and stops it after teardown.
  // start-stack.cjs then also removes the throwaway containers.
  globalSetup: path.join(__dirname, "e2e", "support", "global-setup.ts"),
  globalTeardown: path.join(__dirname, "e2e", "support", "global-teardown.ts"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(OUTPUT_DIR, "playwright-report"), open: "never" }],
    [path.join(__dirname, "e2e", "support", "allure-reporter.ts"), { resultsDir: path.join(OUTPUT_DIR, "allure-results"), detail: false, suiteTitle: true, environmentInfo: { app: APP_URL, node: process.version } }],
    [path.join(__dirname, "e2e", "support", "scenario-reporter.ts")],
  ],
  use: {
    baseURL: APP_URL,
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // HTTP-only tests (no browser): auth, CSRF, validation, privacy, roles, scoring, CSV.
    { name: "api", testMatch: /specs[\\/]api[\\/].*\.spec\.ts$/ },
    // Browser end-to-end tests: the full quiz lifecycle in Chromium.
    { name: "chromium", testMatch: /specs[\\/]ui[\\/].*\.spec\.ts$/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `node ${JSON.stringify(path.join(__dirname, "e2e", "support", "start-stack.cjs"))}`,
    url: `${APP_URL}/healthz`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    env: {
      E2E_APP_PORT: String(PORTS.app),
      E2E_PG_PORT: String(PORTS.postgres),
      E2E_SMTP_PORT: String(PORTS.smtp),
      E2E_MAIL_UI_PORT: String(PORTS.mailUi),
      E2E_ADMIN_NAME: ADMIN.name,
      E2E_ADMIN_EMAIL: ADMIN.email,
      E2E_ADMIN_PASSWORD: ADMIN.password,
      E2E_MAIL_FROM: `"${MAIL_FROM.name}" <${MAIL_FROM.address}>`,
    },
  },
});
