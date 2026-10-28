import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import {
  LONG_DOC,
  MIXED_PDF,
  makeLongEpub,
  makeLongFb2,
  makeLongHtml,
  makeLongMd,
  makeLongRtf,
  makeLongTxt,
  makeMixedSizePdf,
} from "./fixtures";

/**
 * A search hit has to bring the reader to the match, not to the start of whatever holds it. The
 * files here are long and have one thing to find at the very end:
 *  - a book with a single section (an EPUB, FictionBook) has nothing but an offset to go by;
 *  - plain text, RTF, Markdown and HTML have no sections at all and are searched from the shelf
 *    through an index cut into units of text;
 *  - a PDF whose pages differ in size is laid out one page under the other, and the height of a
 *    page is known only once it has been measured;
 *  - a screen that is wide and short has no room for the drawer as a sheet.
 *
 * These run in Chromium. A phone-sized viewport and touch are not an iPhone: nothing here says how
 * Safari lays any of this out.
 */

async function gotoShelf(page: Page) {
  await page.goto("/");
  await waitForApp(page);
}

/** The spoken index line (the visible copy is hidden from assistive technology). */
const indexLine = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

const shelfSearch = (page: Page) => page.getByRole("searchbox", { name: "Search shelf" });

/** Puts a file on the shelf and waits until the shelf has indexed it in the background. */
async function importAndIndex(page: Page, file: string) {
  await gotoShelf(page);
  await page.setInputFiles('input[type="file"]', file);
  await expect(indexLine(page, "1 of 1 book or document indexed")).toBeAttached({
    timeout: 120_000,
  });
}

async function openLongBook(page: Page) {
  await page
    .getByRole("link", { name: /long document/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/read\//);
}

interface Placed {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * Where the word is on the screen, in page coordinates, whichever frame holds it (a book's text is
 * in an iframe). Text inside the drawer, which lists the hit, is skipped.
 */
async function wordOnScreen(page: Page, word: string): Promise<Placed | null> {
  for (const frame of page.frames()) {
    const inFrame = await frame
      .evaluate((needle) => {
        const body = document.body;
        if (!body) return null;
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement?.closest('[role="tabpanel"], [role="dialog"]')) continue;
          const at = (node as Text).data.toLowerCase().indexOf(needle.toLowerCase());
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          const box = range.getBoundingClientRect();
          return { l: box.left, t: box.top, r: box.right, b: box.bottom };
        }
        return null;
      }, word)
      .catch(() => null);
    if (!inFrame) continue;
    let dx = 0;
    let dy = 0;
    if (frame !== page.mainFrame()) {
      const owner = await frame.frameElement().catch(() => null);
      const box = await owner?.boundingBox();
      dx = box?.x ?? 0;
      dy = box?.y ?? 0;
    }
    return { l: inFrame.l + dx, t: inFrame.t + dy, r: inFrame.r + dx, b: inFrame.b + dy };
  }
  return null;
}

/** True when the word is inside the window, at least `top` pixels below its upper edge. */
async function isWordVisible(page: Page, word: string, top = 0): Promise<boolean> {
  const at = await wordOnScreen(page, word);
  const view = page.viewportSize();
  if (!at || !view) return false;
  return at.l >= 0 && at.r <= view.width && at.t >= top && at.b <= view.height;
}

/**
 * After a click on a hit on the shelf: the reader is up, with the drawer the deep link opens and
 * the result at the match selected. (The shelf page lists the word too, so a check for the word
 * must not start before this.)
 */
async function expectReaderAtHit(page: Page) {
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.getByRole("textbox", { name: "Search in book" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("tabpanel").locator('[aria-current="true"]')).toHaveCount(1, {
    timeout: 30_000,
  });
}

/** Opens the search drawer in the reader, looks the word up and clicks the first result. */
async function searchAndClickFirst(page: Page, word: string) {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("textbox", { name: "Search in book" }).fill(word);
  const result = page.getByRole("tabpanel").locator("ul li button").first();
  await expect(result).toBeVisible({ timeout: 30_000 });
  await result.click();
  return result;
}

const FORMATS: { name: string; make: () => string; stretch: boolean }[] = [
  { name: "EPUB with a single section", make: makeLongEpub, stretch: false },
  { name: "FictionBook with a single section", make: makeLongFb2, stretch: false },
  // A document with no pages or chapters says what stretch of it a hit's unit covers.
  { name: "plain text", make: makeLongTxt, stretch: true },
  { name: "RTF", make: makeLongRtf, stretch: true },
  { name: "Markdown", make: makeLongMd, stretch: true },
  { name: "HTML", make: makeLongHtml, stretch: true },
];

test.describe("a result in a long document brings the reader to the match (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { name, make } of FORMATS) {
    test(`${name}: the last word of the book is on the screen after the click`, async ({
      page,
    }) => {
      await importAndIndex(page, make());
      await openLongBook(page);
      await searchAndClickFirst(page, LONG_DOC.word);
      await expect
        .poll(() => isWordVisible(page, LONG_DOC.word), { timeout: 20_000, intervals: [250] })
        .toBe(true);
    });
  }

  test("the mark and the active result stay while the drawer stays open", async ({ page }) => {
    await importAndIndex(page, makeLongTxt());
    await openLongBook(page);
    const result = await searchAndClickFirst(page, LONG_DOC.word);
    await expect
      .poll(() => isWordVisible(page, LONG_DOC.word), { timeout: 20_000, intervals: [250] })
      .toBe(true);
    // The search used to run again whenever the reader re-rendered (the position moves, the index
    // finishes): the list was rebuilt, the active result lost, and the mark on the page cleared.
    await page.waitForTimeout(3_500);
    await expect(page.getByRole("tabpanel").locator('[aria-current="true"]')).toHaveCount(1);
    await expect(result).toBeVisible();
    expect(await isWordVisible(page, LONG_DOC.word)).toBe(true);
  });

  test("an EPUB hit names the contents entry its section falls under, not a page number", async ({
    page,
  }) => {
    await importAndIndex(page, makeLongEpub());
    await shelfSearch(page).fill(LONG_DOC.word);
    const hit = page.getByRole("link").filter({ hasText: LONG_DOC.word }).first();
    await expect(hit).toBeVisible({ timeout: 30_000 });
    await expect(hit).toContainText(LONG_DOC.chapter);
    await expect(hit).not.toContainText("Page 1");
  });
});

test.describe("the reader writes the chapter names into the index of an EPUB", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** The hit-list labels of the stored index (by unit), read from the app's own database. */
  const storedLabels = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<Record<string, string> | null>((resolve, reject) => {
          const open = indexedDB.open("folio-library");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const all = db.transaction("searchIndex").objectStore("searchIndex").getAll();
            all.onsuccess = () => {
              db.close();
              const record = (all.result as { labels?: Record<string, string> }[])[0];
              resolve(record?.labels ?? null);
            };
            all.onerror = () => reject(all.error);
          };
        }),
    );

  test("labels taken away are put back by opening the book", async ({ page }) => {
    await importAndIndex(page, makeLongEpub());
    expect(await storedLabels(page)).toEqual({ "1": LONG_DOC.chapter });
    // Take the labels away, as an index built before the reader supplied them would have none.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("folio-library");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("searchIndex", "readwrite");
            const store = tx.objectStore("searchIndex");
            const all = store.getAll();
            all.onsuccess = () => {
              for (const record of all.result) {
                delete record.labels;
                store.put(record);
              }
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    expect(await storedLabels(page)).toBeNull();
    await openLongBook(page);
    // The reader's own pass asks foliate which contents entry each section falls under.
    await expect
      .poll(() => storedLabels(page), { timeout: 30_000, intervals: [250] })
      .toEqual({ "1": LONG_DOC.chapter });
  });
});

test.describe("a result in a long document brings the reader to the match (phone)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const { name, make } of [FORMATS[0]!, FORMATS[2]!, FORMATS[5]!]) {
    test(`${name}: the last word of the book is on the screen after the tap`, async ({ page }) => {
      await importAndIndex(page, make());
      await openLongBook(page);
      await searchAndClickFirst(page, LONG_DOC.word);
      await expect
        .poll(() => isWordVisible(page, LONG_DOC.word), { timeout: 20_000, intervals: [250] })
        .toBe(true);
      // The sheet covers the page, so it steps aside once the jump is made.
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }
});

test.describe("shelf search finds books and documents that were never opened", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { name, make, stretch } of FORMATS) {
    test(`${name}: the hit opens the reader at the match`, async ({ page }) => {
      await importAndIndex(page, make());
      await shelfSearch(page).fill(LONG_DOC.word);
      const hit = page.getByRole("link").filter({ hasText: LONG_DOC.word }).first();
      await expect(hit).toBeVisible({ timeout: 30_000 });
      if (stretch) await expect(hit).toContainText(/\d+–\d+%/);
      await hit.click();
      await expectReaderAtHit(page);
      await expect
        .poll(() => isWordVisible(page, LONG_DOC.word), { timeout: 30_000, intervals: [250] })
        .toBe(true);
      // And it stays: nothing moves the reader back to its saved position afterwards.
      await page.waitForTimeout(3_000);
      expect(await isWordVisible(page, LONG_DOC.word)).toBe(true);
    });
  }

  test("a text file that had been read before still opens at the hit, not at its saved place", async ({
    page,
  }) => {
    await importAndIndex(page, makeLongTxt());
    await openLongBook(page);
    // Open it so it has a saved reading position (the start), and come back.
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await page.waitForTimeout(2_500);
    await page.goBack();
    await gotoShelf(page);
    await shelfSearch(page).fill(LONG_DOC.word);
    const hit = page.getByRole("link").filter({ hasText: LONG_DOC.word }).first();
    await expect(hit).toBeVisible({ timeout: 30_000 });
    await hit.click();
    await expectReaderAtHit(page);
    await expect
      .poll(() => isWordVisible(page, LONG_DOC.word), { timeout: 30_000, intervals: [250] })
      .toBe(true);
    await page.waitForTimeout(3_000);
    expect(await isWordVisible(page, LONG_DOC.word)).toBe(true);
  });

  test("an HTML file opened straight after import is searched in the reader and lands on the match", async ({
    page,
  }) => {
    // Opened before the shelf has finished with it, so the reader may answer from its own pass
    // instead of the stored index; both have to put the reader on the match.
    await gotoShelf(page);
    await page.setInputFiles('input[type="file"]', makeLongHtml());
    await openLongBook(page);
    await searchAndClickFirst(page, LONG_DOC.word);
    await expect
      .poll(() => isWordVisible(page, LONG_DOC.word), { timeout: 30_000, intervals: [250] })
      .toBe(true);
  });
});

test.describe("a long PDF whose pages differ in size", () => {
  const { target, last, pageCount } = MIXED_PDF;
  const label = (page: number) => `Page ${page} of ${pageCount}`;
  const position = (page: Page) => page.getByRole("slider", { name: "Page position" });

  async function openMixedPdf(page: Page) {
    await gotoShelf(page);
    await page.setInputFiles('input[type="file"]', await makeMixedSizePdf());
    await page
      .getByRole("link", { name: /mixed size/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/read\//);
  }

  test.describe("desktop", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("a hit from the shelf opens the page the index counted and shows its word", async ({
      page,
    }) => {
      await gotoShelf(page);
      await page.setInputFiles('input[type="file"]', await makeMixedSizePdf());
      await expect(indexLine(page, "1 of 1 book or document indexed")).toBeAttached({
        timeout: 120_000,
      });
      await shelfSearch(page).fill(target.word);
      const hit = page.getByRole("link").filter({ hasText: target.word }).first();
      await expect(hit).toBeVisible({ timeout: 30_000 });
      await expect(hit).toContainText(`Page ${target.page}`);
      await hit.click();
      await expectReaderAtHit(page);
      await expect(position(page)).toHaveAttribute("aria-valuetext", label(target.page), {
        timeout: 60_000,
      });
      await expect
        .poll(() => isWordVisible(page, target.word, 40), { timeout: 30_000, intervals: [250] })
        .toBe(true);
      // It stays on that page while the other pages finish measuring.
      await page.waitForTimeout(3_000);
      await expect(position(page)).toHaveAttribute("aria-valuetext", label(target.page));
      expect(await isWordVisible(page, target.word, 40)).toBe(true);
    });

    test("a result for a late page of the open PDF lands on its page and its word", async ({
      page,
    }) => {
      await openMixedPdf(page);
      await searchAndClickFirst(page, target.word);
      await expect(position(page)).toHaveAttribute("aria-valuetext", label(target.page), {
        timeout: 60_000,
      });
      await expect
        .poll(() => isWordVisible(page, target.word, 40), { timeout: 30_000, intervals: [250] })
        .toBe(true);
    });

    test("the last page, a short one, can be brought to the top and is the page named", async ({
      page,
    }) => {
      await openMixedPdf(page);
      await searchAndClickFirst(page, last.word);
      await expect(position(page)).toHaveAttribute("aria-valuetext", label(last.page), {
        timeout: 60_000,
      });
      await expect
        .poll(() => isWordVisible(page, last.word, 40), { timeout: 30_000, intervals: [250] })
        .toBe(true);
      await page.waitForTimeout(2_000);
      await expect(position(page)).toHaveAttribute("aria-valuetext", label(last.page));
    });
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    for (const { name, spot } of [
      { name: "a late page", spot: target },
      { name: "the short last page", spot: last },
    ]) {
      test(`a result for ${name} lands on it, with its word below the top bar`, async ({
        page,
      }) => {
        await openMixedPdf(page);
        await searchAndClickFirst(page, spot.word);
        await expect(position(page)).toHaveAttribute("aria-valuetext", label(spot.page), {
          timeout: 60_000,
        });
        await expect
          .poll(() => isWordVisible(page, spot.word, 40), { timeout: 30_000, intervals: [250] })
          .toBe(true);
      });
    }
  });
});

test.describe("a screen that is wide and short", () => {
  for (const size of [
    { width: 568, height: 320 },
    { width: 667, height: 375 },
  ]) {
    test.describe(`${size.width}×${size.height}`, () => {
      test.use({ viewport: size, hasTouch: true, isMobile: true });

      test("the search drawer is a rail beside the text and the first result can be seen", async ({
        page,
      }) => {
        await importAndIndex(page, makeLongTxt());
        await openLongBook(page);
        await page.getByRole("button", { name: "Search", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const box = (await dialog.boundingBox())!;
        // A sheet that took most of this height would leave a strip of text to read; a rail leaves
        // the whole height to the text and takes a side.
        expect(box.height).toBeGreaterThanOrEqual(size.height * 0.9);
        expect(box.x).toBeGreaterThan(size.width * 0.3);
        await page.getByRole("textbox", { name: "Search in book" }).fill(LONG_DOC.word);
        const first = page.getByRole("tabpanel").locator("ul li button").first();
        await expect(first).toBeVisible({ timeout: 30_000 });
        const row = (await first.boundingBox())!;
        expect(row.y).toBeGreaterThanOrEqual(0);
        expect(row.y + row.height).toBeLessThanOrEqual(size.height);
      });
    });
  }
});
