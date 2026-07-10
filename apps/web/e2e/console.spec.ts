import {
  expect,
  request as createRequest,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const apiBaseUrl = "http://localhost:4000";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const owner = identity(`owner-${runId}`);
const viewer = identity(`viewer-${runId}`);
const editor = identity(`editor-${runId}`);
const folderName = `M9 Project ${runId}`;
const textFileName = `m9-report-${runId}.txt`;
const imageFileName = `m9-image-${runId}.png`;
const dragFolderName = `Drag destination ${runId}`;
const dragFileName = `drag-me-${runId}.txt`;
const secondDragFileName = `drag-me-too-${runId}.txt`;

test.describe.serial("Nimbus M9 console", () => {
  let ownerContext: BrowserContext;
  let ownerPage: Page;

  test.beforeAll(async ({ browser }) => {
    await Promise.all([provision(viewer), provision(editor)]);
    ownerContext = await contextFor(browser, owner);
    ownerPage = await ownerContext.newPage();
  });

  test.afterAll(async () => {
    await ownerContext.close();
  });

  test("owner completes files, upload, search, version, sharing, jobs, public, and trash workflows", async () => {
    test.setTimeout(180_000);
    const measurements: Record<string, number> = {};
    let started = performance.now();
    await ownerPage.goto("/files");
    await expect(ownerPage.getByRole("heading", { name: "Root" })).toBeVisible();
    measurements.initialFilesPageMs = round(performance.now() - started);
    await expect(ownerPage.getByText(owner.email)).toBeVisible();
    await ownerContext.setExtraHTTPHeaders({});

    await ownerPage.getByRole("button", { name: "New folder" }).click();
    const folderNameInput = ownerPage.getByLabel("Name");
    await folderNameInput.pressSequentially(folderName);
    await expect(folderNameInput).toHaveValue(folderName);
    await ownerPage.getByRole("button", { name: "Save" }).click();
    const folderRow = ownerPage.getByRole("button", { name: new RegExp(folderName) });
    await expect(folderRow).toBeVisible();
    started = performance.now();
    await folderRow.click();
    await expect(ownerPage.getByRole("heading", { name: folderName })).toBeVisible();
    measurements.folderNavigationMs = round(performance.now() - started);

    const textChooser = ownerPage.waitForEvent("filechooser");
    await ownerPage.getByRole("button", { name: "Upload", exact: true }).click();
    await (
      await textChooser
    ).setFiles({
      name: textFileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Nimbus M9 browser upload\n"),
    });
    started = performance.now();
    await expect(ownerPage.getByText(textFileName).first()).toBeVisible({ timeout: 45_000 });
    measurements.uploadCompletionTransitionMs = round(performance.now() - started);

    await downloadFromRow(ownerPage, textFileName);

    await ownerPage.getByRole("link", { name: "Search" }).click();
    started = performance.now();
    await ownerPage.getByRole("searchbox", { name: "Search files and folders" }).fill(textFileName);
    await expect(ownerPage.getByRole("button", { name: new RegExp(textFileName) })).toBeVisible();
    measurements.searchDisplayMs = round(performance.now() - started);

    await ownerPage.getByRole("link", { name: "Files" }).click();
    await ownerPage.getByRole("button", { name: new RegExp(folderName) }).click();
    await openAction(ownerPage, textFileName, "Versions");
    await expect(ownerPage.getByRole("heading", { name: textFileName })).toBeVisible();
    const versionChooser = ownerPage.waitForEvent("filechooser");
    await ownerPage.getByRole("button", { name: "New version" }).click();
    await (
      await versionChooser
    ).setFiles({
      name: textFileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Nimbus M9 second version\n"),
    });
    await expect(ownerPage.getByText("Version 2")).toBeVisible({ timeout: 45_000 });
    await ownerPage.getByRole("button", { name: "Restore" }).last().click();
    await ownerPage.getByRole("button", { name: "Restore version" }).click();
    await expect(ownerPage.getByText("Version 1 restored.")).toBeVisible();

    await ownerPage.getByRole("tab", { name: "Sharing" }).click();
    await ownerPage.getByLabel("Email").fill(viewer.email);
    await ownerPage.getByLabel("Role").selectOption("viewer");
    await ownerPage.getByRole("button", { name: "Share", exact: true }).click();
    await expect(ownerPage.getByText(viewer.email)).toBeVisible();
    await ownerPage.getByLabel("Email").fill(editor.email);
    await ownerPage.getByLabel("Role").selectOption("editor");
    await ownerPage.getByRole("button", { name: "Share", exact: true }).click();
    await expect(ownerPage.getByText(editor.email)).toBeVisible();

    await ownerPage.getByRole("button", { name: "Create link" }).click();
    const publicUrl = await ownerPage.getByLabel("One-time public link").inputValue();
    const token = publicUrl.split("/").at(-1)!;
    expect(token).toHaveLength(43);
    const storedSecrets = await ownerPage.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
    }));
    expect(storedSecrets.local).not.toContain(token);
    expect(storedSecrets.session).not.toContain(token);
    const publicMetadata = await ownerPage.request.get(
      `${apiBaseUrl}/api/v1/public/${encodeURIComponent(token)}`,
    );
    expect(publicMetadata.ok()).toBe(true);
    const fileId = String((await publicMetadata.json()).data.resource.resourceId);
    const publicPage = await ownerContext.newPage();
    await publicPage.goto(publicUrl);
    await expect(publicPage.getByRole("heading", { name: textFileName })).toBeVisible();
    await expect(publicPage.getByRole("button", { name: "Download" })).toBeVisible();
    await publicPage.close();
    await ownerPage.getByRole("button", { name: "Revoke", exact: true }).last().click();
    const revokedPublicPage = await ownerContext.newPage();
    await revokedPublicPage.goto(publicUrl);
    await expect(revokedPublicPage.locator(".error-notice")).toBeVisible();
    await expect(revokedPublicPage.getByRole("button", { name: "Download" })).toHaveCount(0);
    await revokedPublicPage.close();
    await ownerPage.getByRole("button", { name: "Close file details" }).click();
    expect(await ownerPage.locator("body").innerHTML()).not.toContain(token);

    await verifyRoleAccess(ownerPage.context().browser()!, viewer, textFileName, "viewer");
    await verifyRoleAccess(ownerPage.context().browser()!, editor, textFileName, "editor");

    await openAction(ownerPage, textFileName, "Share");
    const viewerShare = ownerPage.locator(".share-list > div").filter({ hasText: viewer.email });
    await viewerShare.getByRole("button", { name: "Revoke" }).click();
    await ownerPage.getByRole("button", { name: "Revoke access" }).click();
    await ownerPage.getByRole("button", { name: "Close file details" }).click();
    await verifyRevokedAccess(ownerPage.context().browser()!, viewer, textFileName, fileId);

    const imageChooser = ownerPage.waitForEvent("filechooser");
    await ownerPage.getByRole("button", { name: "Upload", exact: true }).click();
    await (
      await imageChooser
    ).setFiles({
      name: imageFileName,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAMElEQVR4nGPQqDhBU8QwakHFaBCdGE1FGqMZ7cRoUaExWppWjFY4GqNVZsXgblUAAOi7OD26arz5AAAAAElFTkSuQmCC",
        "base64",
      ),
    });
    started = performance.now();
    const thumbnail = ownerPage.getByAltText(`Thumbnail for ${imageFileName}`).first();
    await expect(thumbnail).toBeVisible({ timeout: 45_000 });
    measurements.thumbnailDisplayMs = round(performance.now() - started);

    await ownerPage.getByRole("link", { name: "Jobs" }).click();
    started = performance.now();
    await expect(
      ownerPage.locator(".job-row").filter({ hasText: "Finalizing upload" }).first(),
    ).toBeVisible();
    measurements.jobsDisplayMs = round(performance.now() - started);
    await expect(ownerPage.locator("body")).not.toContainText(/objectKey|bucket|stack trace/i);

    await ownerPage.getByRole("link", { name: "Files" }).click();
    await ownerPage.getByRole("button", { name: new RegExp(folderName) }).click();
    await openAction(ownerPage, imageFileName, "Move to trash");
    await ownerPage.getByRole("button", { name: "Move to Trash", exact: true }).click();
    await ownerPage.getByRole("link", { name: "Trash" }).click();
    const trashRow = ownerPage.locator(".trash-row").filter({ hasText: imageFileName });
    await expect(trashRow).toBeVisible();
    await trashRow.getByRole("button", { name: "Restore" }).click();
    await ownerPage
      .getByRole("dialog", { name: "Restore resource?" })
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await expect(trashRow).not.toBeVisible();
    await ownerPage.screenshot({
      path: test.info().outputPath("desktop-console.png"),
      fullPage: true,
    });

    test.info().annotations.push({
      type: "functional-measurements",
      description: JSON.stringify(measurements),
    });
    console.log(`M9_BROWSER_MEASUREMENTS ${JSON.stringify(measurements)}`);
  });

  test("moves a file by drag and by folder picker without exposing destination IDs", async () => {
    await ownerPage.goto("/files");
    await expect(ownerPage.getByRole("heading", { name: "Root" })).toBeVisible();

    await ownerPage.getByRole("button", { name: "New folder" }).click();
    await ownerPage.getByLabel("Name").fill(dragFolderName);
    await ownerPage.getByRole("button", { name: "Save" }).click();
    await expect(ownerPage.getByRole("button", { name: new RegExp(dragFolderName) })).toBeVisible();

    const chooser = ownerPage.waitForEvent("filechooser");
    await ownerPage.getByRole("button", { name: "Upload", exact: true }).click();
    await (
      await chooser
    ).setFiles([
      {
        name: dragFileName,
        mimeType: "text/plain",
        buffer: Buffer.from("Move this file with drag and drop.\n"),
      },
      {
        name: secondDragFileName,
        mimeType: "text/plain",
        buffer: Buffer.from("Move this selected file too.\n"),
      },
    ]);
    const fileRow = ownerPage.locator(".resource-row").filter({ hasText: dragFileName });
    const secondFileRow = ownerPage
      .locator(".resource-row")
      .filter({ hasText: secondDragFileName });
    const destinationRow = ownerPage.locator(".resource-row").filter({ hasText: dragFolderName });
    await expect(fileRow).toBeVisible({ timeout: 45_000 });
    await expect(secondFileRow).toBeVisible({ timeout: 45_000 });
    await fileRow.locator(".resource-row__name").click({ modifiers: ["Meta"] });
    await secondFileRow.locator(".resource-row__name").click({ modifiers: ["Meta"] });
    await expect(
      ownerPage.locator(".resource-table__name-header").getByText("2 selected"),
    ).toBeVisible();
    await fileRow.dragTo(destinationRow);
    await expect(ownerPage.getByText(`2 items moved to ${dragFolderName}.`)).toBeVisible();
    await expect(fileRow).not.toBeVisible();
    await expect(secondFileRow).not.toBeVisible();

    await ownerPage.getByRole("button", { name: new RegExp(dragFolderName) }).click();
    await expect(ownerPage.getByRole("heading", { name: dragFolderName })).toBeVisible();
    await expect(ownerPage.getByText(dragFileName).first()).toBeVisible();
    await expect(ownerPage.getByText(secondDragFileName).first()).toBeVisible();
    await openAction(ownerPage, dragFileName, "Move");
    let moveDialog = ownerPage.getByRole("dialog", { name: "Move file" });
    await expect(moveDialog.getByText("Destination folder ID")).toHaveCount(0);
    await expect(moveDialog.getByRole("button", { name: "Browse all folders" })).toBeVisible();
    await moveDialog.getByRole("button", { name: "Browse all folders" }).click();
    await expect(
      moveDialog.getByRole("navigation", { name: "Folder picker breadcrumb" }),
    ).toBeVisible();
    await moveDialog.getByRole("button", { name: "Choose this folder" }).click();
    await moveDialog.getByRole("button", { name: "Save" }).click();
    await expect(ownerPage.getByText(`${dragFileName} moved to Root.`)).toBeVisible();

    await ownerPage
      .getByRole("navigation", { name: "Folder breadcrumb" })
      .getByRole("button", { name: "Root" })
      .click();
    await expect(ownerPage.getByText(dragFileName).first()).toBeVisible();
    await openAction(ownerPage, dragFileName, "Move");
    moveDialog = ownerPage.getByRole("dialog", { name: "Move file" });
    await moveDialog.getByRole("button", { name: dragFolderName, exact: true }).click();
    await moveDialog.getByRole("button", { name: "Save" }).click();
    await expect(ownerPage.getByText(`${dragFileName} moved to ${dragFolderName}.`)).toBeVisible();
  });

  test("mobile shell keeps navigation and content within the viewport", async ({ browser }) => {
    const context = await contextFor(browser, owner, true);
    const page = await context.newPage();
    await page.goto("/files");
    await expect(page.getByRole("heading", { name: "Root" })).toBeVisible();
    await context.setExtraHTTPHeaders({});
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
    await page.getByRole("link", { name: "Search" }).click();
    await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
    await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar--open/);
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath("mobile-console.png"), fullPage: true });
    await context.close();
  });
});

async function contextFor(browser: Browser, value: ReturnType<typeof identity>, mobile = false) {
  return browser.newContext({
    ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
    extraHTTPHeaders: {
      "x-nimbus-dev-user": value.user,
      "x-nimbus-dev-email": value.email,
      "x-nimbus-dev-name": value.name,
    },
  });
}

async function provision(value: ReturnType<typeof identity>) {
  const api = await createRequest.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: {
      "x-nimbus-dev-user": value.user,
      "x-nimbus-dev-email": value.email,
      "x-nimbus-dev-name": value.name,
    },
  });
  await expect.poll(async () => (await api.get("/health")).ok()).toBe(true);
  expect((await api.get("/api/v1/me")).ok()).toBe(true);
  await api.dispose();
}

async function verifyRoleAccess(
  browser: Browser,
  value: ReturnType<typeof identity>,
  fileName: string,
  role: "viewer" | "editor",
) {
  const context = await contextFor(browser, value);
  const page = await context.newPage();
  await page.goto(`/search?q=${encodeURIComponent(fileName)}`);
  await expect(page.getByRole("button", { name: new RegExp(fileName) })).toBeVisible();
  await context.setExtraHTTPHeaders({});
  await page.getByRole("button", { name: new RegExp(fileName) }).click();
  await expect(
    page
      .getByLabel("File details", { exact: true })
      .getByText(role[0]!.toUpperCase() + role.slice(1), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sharing" })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  await (await download).cancel();
  await page.getByRole("tab", { name: "Versions" }).click();
  if (role === "viewer") {
    await expect(page.getByRole("button", { name: "New version" })).toHaveCount(0);
  } else {
    const versionRows = page.locator(".version-row");
    const previousCount = await versionRows.count();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "New version" }).click();
    await (
      await chooser
    ).setFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Nimbus M9 editor version\n"),
    });
    await expect(versionRows).toHaveCount(previousCount + 1, { timeout: 45_000 });
  }
  await context.close();
}

async function verifyRevokedAccess(
  browser: Browser,
  value: ReturnType<typeof identity>,
  fileName: string,
  fileId: string,
) {
  const api = await createRequest.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: authHeaders(value),
  });
  expect((await api.get(`/api/v1/files/${fileId}/download`)).status()).toBe(404);
  expect((await api.get(`/api/v1/files/${fileId}/thumbnail`)).status()).toBe(404);
  await api.dispose();

  const context = await contextFor(browser, value);
  const page = await context.newPage();
  await page.goto(`/files?file=${encodeURIComponent(fileId)}`);
  await expect(page.locator(".error-notice")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sharing" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New version" })).toHaveCount(0);
  await context.setExtraHTTPHeaders({});
  await page.goto(`/search?q=${encodeURIComponent(fileName)}`);
  await expect(page.getByRole("button", { name: new RegExp(fileName) })).toHaveCount(0);
  await context.close();
}

async function openAction(page: Page, fileName: string, action: string) {
  await page.getByLabel(`Actions for ${fileName}`).click();
  await page.getByRole("button", { name: action, exact: true }).click();
}

async function downloadFromRow(page: Page, fileName: string) {
  await page.getByLabel(`Actions for ${fileName}`).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await (await download).cancel();
}

function identity(user: string) {
  return { user, email: `${user}@nimbus.local`, name: user.replaceAll("-", " ") };
}

function authHeaders(value: ReturnType<typeof identity>) {
  return {
    "x-nimbus-dev-user": value.user,
    "x-nimbus-dev-email": value.email,
    "x-nimbus-dev-name": value.name,
  };
}

function round(value: number) {
  return Number(value.toFixed(1));
}
