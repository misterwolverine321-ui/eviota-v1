import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeSamplePdf } from "./fixtures";

/**
 * A PDF page's text layer covers the whole page above the highlight overlay,
 * so a mouse click or a tap never reached a highlight to edit or delete it
 * (found by driving the build in Chromium). These specs click with the real
 * pointer, so what is on top decides.
 */

async function openPdf(page: Page) {
  await page.goto("/");
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', await makeSamplePdf());
  const card = page.locator('a[href*="#/read/"]').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });
}

/** Drag across the first page's big word with the mouse. */
async function dragAcrossWord(page: Page, word: string) {
  const span = page.locator(".textLayer span", { hasText: word }).first();
  await expect(span).toBeVisible();
  const box = (await span.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
  await page.mouse.up();
}

const mark = (page: Page) => page.getByRole("button", { name: "highlight annotation" });

test.describe("PDF highlights", () => {
  test("a click on a highlight opens it for editing, and Delete removes it", async ({ page }) => {
    await openPdf(page);
    await dragAcrossWord(page, "ALPHA");
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    await expect(mark(page)).toBeAttached({ timeout: 10_000 });

    const box = (await mark(page).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(mark(page)).toHaveCount(0);
  });

  test("a drag over a highlighted word still selects text instead of opening the highlight", async ({
    page,
  }) => {
    await openPdf(page);
    await dragAcrossWord(page, "ALPHA");
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    await expect(mark(page)).toBeAttached({ timeout: 10_000 });

    // Pressing on text that is still selected starts a drag-and-drop of that
    // text, not a new selection (browser behaviour), so clear it first.
    await page.mouse.click(5, 450);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await dragAcrossWord(page, "ALPHA");
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("ALPHA");
    await expect(page.getByRole("button", { name: "Highlight", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });
});
