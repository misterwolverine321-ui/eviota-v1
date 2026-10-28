import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeLongEpub, makeLongTxt } from "./fixtures";

/**
 * The reading surface's taps, end to end. The rules (tap-gesture.ts) are unit-tested; these check
 * that the shell applies them in a text document (in the page) and an e-book (in a frame), with a
 * mouse on a desktop and with touch on a phone:
 *  - a tap in the outer thirds turns the page; the middle third shows or hides the bars,
 *  - a mouse click in the middle does nothing, and a double tap toggles nothing,
 *  - a mouse resting on the top or bottom strip shows its bar; a tap on the strip does the same.
 */

const BARS_HIDDEN = { name: "Show reading menu" };
const BOTTOM_STRIP = { name: "Show page controls" };

async function openBook(page: Page, file: string, name: RegExp) {
  await page.goto("/");
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', file);
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.getByRole("button", { name: "Next page" })).toBeAttached();
}

/** The reader's progress label (page count or percentage), read whether or not the bar is shown. */
function progressLabel(page: Page) {
  return page.locator('span[aria-hidden="true"].w-24');
}

/** The progress label once it has stopped changing: an e-book settles its position after it opens. */
async function settledProgress(page: Page): Promise<string | null> {
  const label = progressLabel(page);
  let last = await label.textContent();
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(400);
        const now = await label.textContent();
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return last;
}

async function centre(page: Page) {
  const box = await page.locator("main").boundingBox();
  if (!box) throw new Error("the reading surface has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function barsHidden(page: Page): Promise<boolean> {
  return (await page.getByRole("button", BARS_HIDDEN).count()) > 0;
}

test.describe("desktop: a mouse", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a click or double click in the middle does not show the bars", async ({ page }) => {
    await openBook(page, makeLongTxt(), /long document/i);
    await page.keyboard.press("Escape"); // hide the bars
    await expect(page.getByRole("button", BARS_HIDDEN)).toBeVisible();

    const { x, y } = await centre(page);
    await page.mouse.click(x, y);
    await page.waitForTimeout(450);
    expect(await barsHidden(page)).toBe(true);

    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(450);
    expect(await barsHidden(page)).toBe(true);
  });

  test("moving the mouse onto the top strip shows the top bar", async ({ page }) => {
    await openBook(page, makeLongTxt(), /long document/i);
    await page.keyboard.press("Escape");
    const strip = page.getByRole("button", BARS_HIDDEN);
    await expect(strip).toBeVisible();
    await strip.hover();
    await expect(page.getByRole("button", BARS_HIDDEN)).toHaveCount(0);
  });

  test("moving the mouse onto the bottom strip shows the bottom bar", async ({ page }) => {
    await openBook(page, makeLongTxt(), /long document/i);
    await page.keyboard.press("Escape");
    const strip = page.getByRole("button", BOTTOM_STRIP);
    await expect(strip).toBeVisible();
    await strip.hover();
    await expect(page.getByRole("button", BOTTOM_STRIP)).toHaveCount(0);
  });

  test("a click on the right third turns the page in a text document", async ({ page }) => {
    await openBook(page, makeLongTxt(), /long document/i);
    const label = progressLabel(page);
    const before = await label.textContent();
    const { box, y } = await centre(page);
    await page.mouse.click(box.x + box.width * 0.9, y);
    await expect.poll(async () => label.textContent()).not.toBe(before);
  });

  test("a click on the right third turns the page in an e-book", async ({ page }) => {
    await openBook(page, makeLongEpub(), /long/i);
    const label = progressLabel(page);
    const before = await settledProgress(page);
    const { box, y } = await centre(page);
    await page.mouse.click(box.x + box.width * 0.9, y);
    await expect.poll(async () => label.textContent()).not.toBe(before);
  });
});

test.describe("phone: touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("a single tap in the middle hides, then shows, the bars", async ({ page }) => {
    await openBook(page, makeLongTxt(), /long document/i);
    expect(await barsHidden(page)).toBe(false);

    const { x, y } = await centre(page);
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole("button", BARS_HIDDEN)).toBeVisible({ timeout: 3000 });

    await page.touchscreen.tap(x, y);
    await expect(page.getByRole("button", BARS_HIDDEN)).toHaveCount(0, { timeout: 3000 });
  });

  test("two quick taps in the middle toggle nothing", async ({ page }) => {
    await openBook(page, makeLongTxt(), /long document/i);
    const { x, y } = await centre(page);
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(900);
    expect(await barsHidden(page)).toBe(false);
  });

  test("a tap on the bottom strip shows the bottom bar", async ({ page }) => {
    await openBook(page, makeLongTxt(), /long document/i);
    const { x, y } = await centre(page);
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole("button", BARS_HIDDEN)).toBeVisible({ timeout: 3000 });

    const strip = page.getByRole("button", BOTTOM_STRIP);
    const box = await strip.boundingBox();
    if (!box) throw new Error("the bottom strip has no box");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("button", BOTTOM_STRIP)).toHaveCount(0, { timeout: 3000 });
  });

  test("a tap on the right third of an e-book turns the page, and the middle does not", async ({
    page,
  }) => {
    await openBook(page, makeLongEpub(), /long/i);
    const label = progressLabel(page);
    const { box, y } = await centre(page);
    const before = await settledProgress(page);

    await page.touchscreen.tap(box.x + box.width * 0.5, y);
    await page.waitForTimeout(450);
    expect(await label.textContent()).toBe(before);

    await page.touchscreen.tap(box.x + box.width * 0.9, y);
    await expect.poll(async () => label.textContent()).not.toBe(before);
  });
});
