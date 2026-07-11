import { defineConfig, devices } from "@playwright/test";

const baseURL = requireHttpsUrl("PRODUCTION_WEB_URL");

export default defineConfig({
  testDir: "./e2e-production",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});

function requireHttpsUrl(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for production Playwright.`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  return url.origin;
}
