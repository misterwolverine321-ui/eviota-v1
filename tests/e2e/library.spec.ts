import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeSamplePdf } from "./fixtures";

/**
 * The end-to-end safety net for the core loop: import a book, open it, and come
 * back to the shelf. (This file once also covered syncing through a demo
 * provider; sync was removed when Eviota became a static, client-only app.)
 */

async function waitForHydration(page: Page) {
  await waitForApp(page);
}

async function importPdf(page: Page) {
  const file = await makeSamplePdf(["ALPHA", "BRAVO"]);
  await page.goto("/");
  await waitForHydration(page);
  await page.setInputFiles('input[type="file"]', file);
  const card = page.getByRole("link", { name: /eviota\s*test/i }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

test.describe("library core loop", () => {
  test("imports a book, opens it and returns to the shelf", async ({ page }) => {
    const card = await importPdf(page);
    await card.click();
    await expect(page).toHaveURL(/\/read\//);
    await page.goBack();
    await expect(page.getByRole("link", { name: /eviota\s*test/i }).first()).toBeVisible();
  });

  test("the shelf's file picker has no extension list, so iPhone does not grey out CBZ or CBR", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHydration(page);
    // iPhone Safari greys out any file it cannot match to an extension in an accept list. A CBZ or
    // CBR that another app can open would then be unselectable. Import checks names and bytes instead.
    await expect(page.locator('input[type="file"]')).not.toHaveAttribute("accept", /.+/);
  });
});
