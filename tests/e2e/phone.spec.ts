import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { CBZ_PAGES, makeSampleCbz, makeTocEpub } from "./fixtures";

/**
 * A walk through the app at the size and with the input of a phone: a narrow viewport, touch,
 * no hover. It checks what a layout or an event-handling mistake would break first:
 *  - nothing makes the page scroll sideways;
 *  - the reader's bars are big enough to hit with a thumb, and a tap does what a click does;
 *  - the drawer is a bottom sheet that fits the screen, and closing it gives focus back;
 *  - a tap on the comic page turns it.
 *
 * What this is NOT: a test on an iPhone. In the default project this runs in Chromium with a
 * phone viewport and touch turned on, which says nothing about Safari's engine, its keyboard,
 * its address-bar resizing, safe-area insets or what iOS does to a web app that was added to the
 * home screen. The same file runs in WebKit under `npm run test:e2e:webkit`, which has not been
 * run in the sandbox this was written in (no WebKit build there).
 */

test.use({
  viewport: { width: 390, height: 664 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});

async function ready(page: Page) {
  await waitForApp(page);
}

/** The targets under `min` CSS px, as "label: WxH", so one assertion prints every one of them. */
async function smallTargets(targets: Locator[], min = 44): Promise<string[]> {
  const small: string[] = [];
  for (const target of targets) {
    const box = await target.boundingBox();
    if (!box) continue; // not shown
    if (box.width < min - 0.5 || box.height < min - 0.5) {
      const label = await target.evaluate(
        (el) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName,
      );
      small.push(`${label}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }
  return small;
}

/** How far the page extends past the screen sideways, in CSS pixels. */
const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Taps an element the way a finger would: it is scrolled into view, and the point that is hit
 * must be the element or something inside it. Playwright's own `tap()` would wait for whatever
 * covers the element to go away, which is the opposite of what these specs want to find out.
 */
async function tap(page: Page, target: ReturnType<Page["locator"]>) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to tap: the element has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const covered = await target.evaluate(
    (el, at) => {
      const top = document.elementFromPoint(at.x, at.y);
      return top && top !== el && !el.contains(top) ? top.outerHTML.slice(0, 140) : null;
    },
    { x, y },
  );
  if (covered) throw new Error(`the tap point is covered by: ${covered}`);
  await page.touchscreen.tap(x, y);
}

/** Opens a book from the shelf. A shelf card can sit under a toast for a moment, so wait it out. */
async function openFromShelf(link: ReturnType<Page["locator"]>) {
  await link.tap();
}

test.describe("on a phone", () => {
  for (const width of [390, 320]) {
    test(`the shelf, with and without books, does not scroll sideways at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 664 });
      await page.goto("/");
      await ready(page);
      expect(await overflowX(page), "empty shelf").toBeLessThanOrEqual(0);

      await page.setInputFiles('input[type="file"]', [makeTocEpub(), makeSampleCbz()]);
      await expect(page.getByRole("link", { name: /contents probe/i })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("link", { name: /eviota\s*comic/i })).toBeVisible();
      expect(await overflowX(page), "shelf with books").toBeLessThanOrEqual(0);

      await page.goto("/#/settings");
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      expect(await overflowX(page), "Settings").toBeLessThanOrEqual(0);
    });
  }

  test("the collections list is folded away until it is asked for", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', [makeTocEpub()]);
    await expect(page.getByRole("link", { name: /contents probe/i })).toBeVisible({
      timeout: 30_000,
    });
    const toggle = page.locator('button[aria-controls="collections-panel"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#collections-panel")).toBeHidden();
    await tap(page, toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#collections-panel")).toBeVisible();
  });

  test("the drawer's tabs and controls are thumb-sized", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', [makeTocEpub()]);
    const link = page.getByRole("link", { name: /contents probe/i });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await openFromShelf(link);
    await expect(page.getByRole("navigation", { name: "Reading controls" })).toBeVisible({
      timeout: 30_000,
    });
    const bar = page.getByRole("banner");
    const small: string[] = [];
    for (const name of ["Contents", "Notes", "Search", "Display"]) {
      await bar.getByRole("button", { name, exact: true }).tap();
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      const targets = [
        ...(await drawer.getByRole("tab").all()),
        ...(await drawer.getByRole("button").all()),
        ...(await drawer.getByRole("slider").all()),
      ];
      small.push(...(await smallTargets(targets)).map((s) => `${name} drawer, ${s}`));
      await drawer.getByRole("button", { name: "Close drawer" }).tap();
      await expect(drawer).toBeHidden();
    }
    expect(small, "drawer controls smaller than 44 x 44 CSS px").toEqual([]);
  });

  test("the reader's bars are thumb-sized and a tap turns the page", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', [makeTocEpub()]);
    const link = page.getByRole("link", { name: /contents probe/i });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await openFromShelf(link);
    await expect(page).toHaveURL(/\/read\//);
    const controls = page.getByRole("navigation", { name: "Reading controls" });
    await expect(controls).toBeVisible({ timeout: 30_000 });

    // On a touch screen the reader's buttons and sliders are 44 px, the comfortable target size
    // (WCAG 2.2, 2.5.5). The AA minimum is 24 px (2.5.8); a mouse keeps 32 px and is not tested here.
    const targets = [
      ...(await controls.getByRole("button").all()),
      ...(await controls.getByRole("slider").all()),
      ...(await page.getByRole("banner").getByRole("button").all()),
      page.getByRole("banner").getByRole("link", { name: "Back to library" }),
    ];
    expect(await smallTargets(targets), "reader controls smaller than 44 x 44 CSS px").toEqual([]);

    const slider = controls.getByRole("slider", { name: "Reading position" });
    const before = await slider.getAttribute("aria-valuetext");
    await tap(page, controls.getByRole("button", { name: "Next page" }));
    await expect.poll(() => slider.getAttribute("aria-valuetext")).not.toBe(before);
  });

  test("a toast from the shelf does not sit over the reader's bottom bar", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', [makeTocEpub()]);
    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible({ timeout: 30_000 });
    // Open the book without a tap: a tap would wait for the toast to clear the card, and the
    // point here is the toast that is still showing once the reader is open.
    await page
      .getByRole("link", { name: /contents probe/i })
      .evaluate((a) => (a as HTMLAnchorElement).click());
    const controls = page.getByRole("navigation", { name: "Reading controls" });
    await expect(controls).toBeVisible({ timeout: 30_000 });
    // "Added 1 book" is still on screen, now over the reader. It must clear the bar.
    await expect(toast).toBeVisible();
    const bar = (await controls.boundingBox())!;
    const note = (await toast.boundingBox())!;
    expect(
      note.y + note.height,
      "the toast's bottom edge is above the bar's top edge",
    ).toBeLessThanOrEqual(bar.y + 0.5);
  });

  test("the drawer is a bottom sheet that fits the screen, and closing it returns focus", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', [makeTocEpub()]);
    const link = page.getByRole("link", { name: /contents probe/i });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await openFromShelf(link);
    await expect(page.getByRole("navigation", { name: "Reading controls" })).toBeVisible({
      timeout: 30_000,
    });

    const opener = page.getByRole("banner").getByRole("button", { name: "Display", exact: true });
    await tap(page, opener);
    const sheet = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("tablist", { name: "Reader panels" }) });
    await expect(sheet).toBeVisible();
    const view = page.viewportSize()!;
    // The sheet rises into place; measure it once it has stopped moving.
    await expect
      .poll(
        async () => {
          const b = (await sheet.boundingBox())!;
          return Math.round(b.y + b.height);
        },
        { message: "the sheet sits on the bottom edge" },
      )
      .toBe(view.height);
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.x), "flush with the left edge").toBe(0);
    expect(Math.round(box.width), "as wide as the screen").toBe(view.width);
    expect(box.height, "no taller than 72% of the screen").toBeLessThanOrEqual(
      view.height * 0.72 + 1,
    );
    expect(await overflowX(page)).toBeLessThanOrEqual(0);

    await tap(page, sheet.getByRole("button", { name: "Close drawer" }));
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("a tap on the right of a comic page turns it", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', [makeSampleCbz()]);
    const link = page.getByRole("link", { name: /eviota\s*comic/i });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await openFromShelf(link);
    const surface = page.locator("[data-comic-fit]");
    await expect(surface.locator("img").first()).toBeVisible({ timeout: 60_000 });
    const position = page.getByLabel("Go to page");
    await expect(position).toHaveValue("1");
    await expect(page.getByLabel("Page position")).toHaveAttribute("max", String(CBZ_PAGES));

    const box = (await surface.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2);
    await expect(position).toHaveValue("2");
    await page.touchscreen.tap(box.x + box.width * 0.15, box.y + box.height / 2);
    await expect(position).toHaveValue("1");
  });

  test("a DjVu page is drawn to fit the phone, and a tap on its outer thirds turns it", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', {
      name: "booklet-1905.djvu",
      mimeType: "image/vnd.djvu",
      buffer: readFileSync(
        fileURLToPath(new URL("./data/cyrillic_simonovich_co2.djvu", import.meta.url)),
      ),
    });
    const link = page.getByRole("link", { name: /booklet/i });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await openFromShelf(link);
    const first = page.getByRole("img", { name: "Scanned image of page 1" });
    await expect(first).toBeVisible({ timeout: 60_000 });

    const view = page.viewportSize()!;
    const picture = (await first.boundingBox())!;
    expect(picture.x, "inside the screen on the left").toBeGreaterThanOrEqual(0);
    expect(picture.x + picture.width, "inside the screen on the right").toBeLessThanOrEqual(
      view.width,
    );
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    // Drawn at the screen's own pixel density, not blown up from a small image.
    const drawnWidth = await first.evaluate((el) => (el as HTMLCanvasElement).width);
    expect(drawnWidth).toBeGreaterThanOrEqual(Math.round(picture.width * 3) - 64);

    const slider = page.getByRole("slider", { name: "Page position" });
    const surface = page.locator("[data-djvu-surface]");
    const box = (await surface.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2);
    await expect(slider).toHaveAttribute("aria-valuetext", "Page 2 of 12");
    await page.touchscreen.tap(box.x + box.width * 0.15, box.y + box.height / 2);
    await expect(slider).toHaveAttribute("aria-valuetext", "Page 1 of 12");
  });
});
