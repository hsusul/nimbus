import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      testIgnore: [/console\.spec\.ts/, /accessibility\.spec\.ts/],
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: [/console\.spec\.ts/, /accessibility\.spec\.ts/],
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command:
      "WEB_PORT=3100 CORS_ORIGIN=http://localhost:3100 WEB_DEV_AUTH_USER=e2e-owner WEB_DEV_AUTH_EMAIL=e2e-owner@nimbus.local WEB_DEV_AUTH_NAME='E2E Owner' pnpm --dir ../.. --parallel --filter @nimbus/api --filter @nimbus/worker --filter @nimbus/web dev",
    url: "http://localhost:3100/files",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
