import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeSamplePdf } from "./fixtures";

/**
 * Covers the PDF page-management surface end to end: thumbnail rail rendering,
 * rotate, drag-free reorder (Alt + arrow) and Pages-drawer keyboard nav.
 */

async function importPdf(page: Page) {
  const file = await makeSamplePdf();
  await page.goto("/");
  // The import input is server-rendered, so setting files before hydration
  // silently drops the change event. data-app-ready on <html> is set by the
  // root route on mount, which makes it a reliable "React is live" marker.
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', file);
  const card = page.getByRole("link", { name: /eviota\s*test/i }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/\/read\//);
}

async function openPagesTab(page: Page) {
  await page.keyboard.press("g");
  const rail = page.getByRole("list", { name: "Pages" });
  if (!(await rail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Pages", exact: true }).click();
  }
  await expect(rail).toBeVisible({ timeout: 30_000 });
  return rail;
}

test.describe("PDF pages drawer", () => {
  test("renders a thumbnail rail for every page", async ({ page }) => {
    await importPdf(page);
    const rail = await openPagesTab(page);
    await expect(rail.getByRole("listitem")).toHaveCount(4);
    await expect(rail.getByRole("img", { name: "Page 1" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("keyboard nav walks the grid and Home/End jump to the ends", async ({ page }) => {
    await importPdf(page);
    const rail = await openPagesTab(page);
    await rail.getByRole("button", { name: "Go to page 1" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(rail.getByRole("button", { name: "Go to page 2" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rail.getByRole("button", { name: "Go to page 4" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rail.getByRole("button", { name: "Go to page 1" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(rail.getByRole("button", { name: "Go to page 4" })).toBeFocused();
  });

  test("rotate rewrites the page and keeps the rail intact", async ({ page }) => {
    await importPdf(page);
    const rail = await openPagesTab(page);
    const thumb = rail.getByRole("img", { name: "Page 1" });
    await expect(thumb).toBeVisible({ timeout: 30_000 });
    const before = await thumb.evaluate(
      (el) => (el as HTMLImageElement).naturalWidth / (el as HTMLImageElement).naturalHeight,
    );
    await rail.getByRole("listitem").first().hover();
    await rail.getByRole("button", { name: "Rotate page 1" }).click();
    await expect
      .poll(
        async () =>
          thumb.evaluate(
            (el) => (el as HTMLImageElement).naturalWidth / (el as HTMLImageElement).naturalHeight,
          ),
        { timeout: 45_000 },
      )
      .not.toBeCloseTo(before, 2);
    await expect(rail.getByRole("listitem")).toHaveCount(4);
  });

  test("Alt + arrow reorders a page and announces the move", async ({ page }) => {
    await importPdf(page);
    const rail = await openPagesTab(page);
    await rail.getByRole("button", { name: "Go to page 1" }).focus();
    await page.keyboard.press("Alt+ArrowRight");
    // The reader also has a polite status span (the progress percentage), so
    // select the announcement by its screen-reader-only class.
    await expect(page.locator("span.sr-only[aria-live=polite]")).toContainText(
      "Moved page 1 to position 2",
      { timeout: 30_000 },
    );
    await expect(rail.getByRole("listitem")).toHaveCount(4);
  });
});
