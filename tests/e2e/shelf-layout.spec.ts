import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeTocEpub } from "./fixtures";

/**
 * Above the shelf's books sit the hero (or "Your shelf"), the stats, the search and sort row, and the
 * index line. They appear only once the books and sessions have loaded from IndexedDB. Before the
 * app reserved that space, the books below them jumped down when they appeared: layout shift 0.26 on
 * an empty first visit and 0.57 on a phone. The app now draws an empty box of the height that region
 * had on this device the last time (src/lib/shelf-top-height.ts), so the shelf should not move at all.
 *
 * The main check is on the position itself: the shelf's column must sit at one height on every frame
 * from first paint on. That is deterministic, where a layout-shift score can read zero by timing.
 * The layout-shift score is checked as well, since it is what Chrome reports to users.
 *
 * Chromium only. WebKit has not been run in the sandbox this was written in.
 */

/** Runs before the page's scripts: the top of the shelf's column on every frame, and the layout shift. */
function recordShelfMovement() {
  const w = window as unknown as { __shelfTops: number[]; __layoutShift: number };
  w.__shelfTops = [];
  w.__layoutShift = 0;
  const tick = () => {
    const column = document.querySelector('main > div[class*="md:flex-row"]');
    if (column) w.__shelfTops.push(Math.round(column.getBoundingClientRect().top));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (!shift.hadRecentInput) w.__layoutShift += shift.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
}

async function shelfMovement(page: Page): Promise<{ tops: number[]; shift: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __shelfTops: number[]; __layoutShift: number };
    return { tops: w.__shelfTops, shift: w.__layoutShift };
  });
}

function expectStill({ tops }: { tops: number[] }) {
  const distinct = [...new Set(tops)];
  expect(distinct, "the shelf's top edge moved while it loaded").toHaveLength(1);
}

const VIEWPORTS = [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const;

for (const [name, viewport] of VIEWPORTS) {
  test.describe(`${name}: the shelf does not jump while it loads`, () => {
    test.use({ viewport, isMobile: name === "phone", hasTouch: name === "phone" });

    test("an empty first visit", async ({ page }) => {
      await page.addInitScript(recordShelfMovement);
      await page.goto("/");
      await waitForApp(page);
      await expect(page.getByRole("heading", { name: /Every book you own/ })).toBeVisible();
      // Chrome delivers the last layout-shift entries a little after the paint that caused them.
      await page.waitForTimeout(300);
      const movement = await shelfMovement(page);
      expect(movement.tops.length, "the shelf was never drawn").toBeGreaterThan(0);
      expectStill(movement);
      expect(movement.shift).toBeLessThan(0.01);
    });

    test("a returning visit with a book on the shelf", async ({ page }) => {
      await page.goto("/");
      await waitForApp(page);
      await page.setInputFiles('input[type="file"]', [makeTocEpub()]);
      await expect(page.getByRole("link", { name: /contents probe/i })).toBeVisible({
        timeout: 30_000,
      });
      // The height is recorded once the region has been drawn, so wait for the record before reloading.
      await expect
        .poll(() => page.evaluate(() => window.localStorage.getItem("eviota-shelf-top-height")))
        .not.toBeNull();

      await page.addInitScript(recordShelfMovement);
      await page.reload();
      await waitForApp(page);
      await expect(page.getByRole("heading", { name: "Your shelf" })).toBeVisible();
      await page.waitForTimeout(300);
      const movement = await shelfMovement(page);
      expect(movement.tops.length, "the shelf was never drawn").toBeGreaterThan(0);
      expectStill(movement);
      expect(movement.shift).toBeLessThan(0.01);
    });
  });
}
