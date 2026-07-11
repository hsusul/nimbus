import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("production sign-in entry is reachable and accessible", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(page.getByRole("button", { name: /github/i })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(serious).toEqual([]);
});

test("protected console does not admit an unauthenticated browser", async ({ page }) => {
  await page.goto("/files");
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
});
