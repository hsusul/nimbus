import { expect, request as createRequest, test } from "@playwright/test";

const apiBaseUrl = "http://localhost:4000";

test.describe("cross-browser console smoke", () => {
  test("authenticates and completes the core storage navigation flow", async ({
    browserName,
    context,
    page,
  }) => {
    const runId = `${browserName}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const identity = {
      user: `smoke-${runId}`,
      email: `smoke-${runId}@example.test`,
      name: `${browserName} Smoke`,
    };
    const headers = authHeaders(identity);
    await provision(headers);
    await context.setExtraHTTPHeaders(headers);

    await page.goto("/files");
    await expect(page.getByRole("heading", { name: "Root" })).toBeVisible();
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Name").fill(`${browserName} uploads`);
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: new RegExp(`${browserName} uploads`) }).click();
    await expect(page.getByRole("heading", { name: `${browserName} uploads` })).toBeVisible();

    const fileName = `${browserName}-smoke.txt`;
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`${browserName} direct-to-storage smoke\n`),
    });
    await expect(page.getByText(fileName).first()).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: new RegExp(fileName) }).click();
    await expect(page.getByRole("heading", { name: fileName })).toBeVisible();
    await page.getByRole("button", { name: "Close file details" }).click();

    await page.getByLabel(`Actions for ${fileName}`).click();
    await page.getByRole("button", { name: "Move to trash", exact: true }).click();
    await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
    await page.getByRole("link", { name: "Trash" }).click();
    const trashRow = page.locator(".trash-row").filter({ hasText: fileName });
    await expect(trashRow).toBeVisible();
    await trashRow.getByRole("button", { name: "Restore" }).click();
    await page
      .getByRole("dialog", { name: "Restore resource?" })
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await expect(trashRow).not.toBeVisible();

    await page.getByRole("link", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search files and folders" }).fill(fileName);
    await expect(page.getByRole("button", { name: new RegExp(fileName) })).toBeVisible();
    await page.getByRole("link", { name: "Jobs" }).click();
    await expect(page.locator(".job-row").filter({ hasText: "Finalizing upload" })).toBeVisible();
    await page.getByRole("link", { name: "Trash" }).click();
    await expect(page.getByRole("heading", { name: "Trash", exact: true })).toBeVisible();
  });

  test("keeps mobile navigation inside the viewport", async ({ context, page, browserName }) => {
    const identity = {
      user: `mobile-${browserName}-${Date.now()}`,
      email: `mobile-${browserName}-${Date.now()}@example.test`,
      name: `${browserName} Mobile`,
    };
    const headers = authHeaders(identity);
    await provision(headers);
    await context.setExtraHTTPHeaders(headers);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/files");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

async function provision(headers: Record<string, string>) {
  const api = await createRequest.newContext({ baseURL: apiBaseUrl, extraHTTPHeaders: headers });
  await expect.poll(async () => (await api.get("/health")).ok()).toBe(true);
  expect((await api.get("/api/v1/me")).ok()).toBe(true);
  await api.dispose();
}

function authHeaders(identity: { user: string; email: string; name: string }) {
  return {
    "x-nimbus-dev-user": identity.user,
    "x-nimbus-dev-email": identity.email,
    "x-nimbus-dev-name": identity.name,
  };
}
