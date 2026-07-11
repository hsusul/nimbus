import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const output = resolve(process.cwd(), "../../docs/assets");
const demoHeaders = {
  "x-nimbus-dev-user": "nimbus-demo",
  "x-nimbus-dev-email": "demo.owner@example.test",
  "x-nimbus-dev-name": "Nimbus Demo",
};

test.skip(process.env.CAPTURE_SCREENSHOTS !== "true", "Portfolio capture runs only on demand.");

test("captures the launch portfolio surfaces with synthetic data", async ({ context, page }) => {
  test.setTimeout(120_000);
  await context.setExtraHTTPHeaders(demoHeaders);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "Root" })).toBeVisible();
  await expect(page.getByText("Design Assets")).toBeVisible();
  await shot(page, "files-desktop.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
  await shot(page, "files-mobile.png");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/files?folder=demo_folder_design");
  await page.route("http://localhost:9000/**", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1800));
    await route.continue();
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "launch-demo-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(1024 * 512, "Nimbus launch demo\n"),
  });
  await expect(page.locator(".upload-tray")).toBeVisible();
  await shot(page, "upload-progress.png");
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByText("launch-demo-notes.txt").first()).toBeVisible({ timeout: 45_000 });

  await page.goto("/files?folder=demo_folder_shared&file=demo_file_launch_checklist");
  await expect(page.getByRole("heading", { name: "Launch checklist.txt" })).toBeVisible();
  await shot(page, "file-details.png");
  await page.getByRole("tab", { name: "Sharing" }).click();
  await expect(page.getByText("demo.viewer@example.test")).toBeVisible();
  await shot(page, "sharing.png");

  await page.goto("/search?q=Launch");
  await expect(page.getByRole("button", { name: /Launch checklist\.txt/ })).toBeVisible();
  await shot(page, "search.png");

  await page.goto("/jobs");
  await expect(page.locator(".job-row").first()).toBeVisible();
  await shot(page, "jobs.png");

  await page.goto("/trash");
  await expect(page.getByText("Archived migration notes.txt")).toBeVisible();
  await shot(page, "trash.png");
});

async function shot(page: import("@playwright/test").Page, name: string) {
  await page.screenshot({ path: resolve(output, name), fullPage: false });
}
