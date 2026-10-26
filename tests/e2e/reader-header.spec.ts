import { expect, test } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeHostileEpub } from "./hostile";

/**
 * On a phone the reader's top bar holds a back button, the title and four icon buttons (one of
 * them the safe-reading shield, once something has been blocked). At 360 px the title had 76 px
 * and at 280 px none; the gaps between the buttons took the room. The widths below are what the
 * tighter bar gives on the same book (106 px at 360, 66 px at 320), with a little slack.
 */
for (const [width, least] of [
  [390, 125],
  [360, 95],
  [320, 55],
] as const) {
  test(`the title keeps room beside the buttons at ${width} px wide`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 700 } });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await waitForApp(page);
      await page.setInputFiles('input[type="file"]', makeHostileEpub());
      const card = page.locator('a[href*="#/read/"]').first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.click();
      // The shield only appears once the book has had something blocked: measure with it there.
      await expect(page.getByRole("button", { name: /^Safe reading/ })).toBeVisible({
        timeout: 30_000,
      });
      const title = await page.locator("header p").first().boundingBox();
      expect(title!.width).toBeGreaterThanOrEqual(least);
    } finally {
      await context.close();
    }
  });
}
