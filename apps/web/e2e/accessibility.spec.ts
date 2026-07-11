import AxeBuilder from "@axe-core/playwright";
import { expect, request as createRequest, test, type Page } from "@playwright/test";

const apiBaseUrl = "http://localhost:4000";
const demoHeaders = {
  "x-nimbus-dev-user": "nimbus-demo",
  "x-nimbus-dev-email": "demo.owner@example.test",
  "x-nimbus-dev-name": "Nimbus Demo",
};

test.describe("M10 accessibility", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(demoHeaders);
  });

  test("major authenticated surfaces have no serious or critical axe violations", async ({
    page,
  }) => {
    for (const path of ["/files", "/search?q=Launch", "/jobs", "/trash"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expectAccessible(page);
    }

    await page.goto("/files?folder=demo_folder_shared&file=demo_file_launch_checklist");
    await expect(page.getByRole("heading", { name: "Launch checklist.txt" })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("tab", { name: "Sharing" }).click();
    await expect(page.getByText("demo.viewer@example.test")).toBeVisible();
    await expectAccessible(page);
  });

  test("public file page and mobile navigation pass the same threshold", async ({ page }) => {
    const api = await createRequest.newContext({
      baseURL: apiBaseUrl,
      extraHTTPHeaders: demoHeaders,
    });
    const created = await api.post("/api/v1/share-links", {
      data: { resourceType: "file", resourceId: "demo_file_launch_checklist" },
    });
    expect(created.ok()).toBe(true);
    const token = String((await created.json()).data.token);
    await api.dispose();

    await page.goto(`/public/${encodeURIComponent(token)}`);
    await expect(page.getByRole("heading", { name: "Launch checklist.txt" })).toBeVisible();
    await expectAccessible(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/files");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expectAccessible(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

async function expectAccessible(page: Page) {
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}
