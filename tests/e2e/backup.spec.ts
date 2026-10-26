import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { unzipSync, zipSync } from "fflate";
import { makeHostileEpub, makeProseEpub } from "./hostile";
import { makeSamplePdf } from "./fixtures";

/**
 * The shelf-wide features, driven in a real browser: the notes export from
 * Settings in every format, and the backup -> restore round trip into a brand
 * new browser profile (what moving to another device amounts to).
 */

const EPUB_MARK = "Real text that the reader should see.";

async function ready(page: Page, path = "/") {
  await page.goto(path);
  await waitForApp(page);
}

async function importBook(page: Page, file: string, title: RegExp) {
  await page.goto("/#/");
  await page.setInputFiles('input[type="file"]', file);
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible({ timeout: 30_000 });
}

/** The reader's iframe whose document holds `text`. */
async function frameWith(page: Page, text: RegExp) {
  let found;
  await expect
    .poll(
      async () => {
        for (const f of page.frames()) {
          if (f === page.mainFrame()) continue;
          const body = await f.evaluate(() => document.body?.innerText ?? "").catch(() => "");
          if (text.test(body)) {
            found = f;
            return true;
          }
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return found!;
}

async function highlightEpub(page: Page) {
  await page
    .getByRole("link", { name: /hostile epub/i })
    .first()
    .click();
  const frame = await frameWith(page, /Chapter One/);
  await frame.locator("p", { hasText: "Real text that" }).click({ clickCount: 3 });
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.getByRole("button", { name: "Highlight", exact: true })).toHaveCount(0);
}

async function highlightPdf(page: Page) {
  await page
    .getByRole("link", { name: /eviota\s*test/i })
    .first()
    .click();
  const span = page.locator(".textLayer span", { hasText: "ALPHA" }).first();
  await expect(span).toBeVisible({ timeout: 30_000 });
  const box = (await span.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.getByRole("button", { name: "highlight annotation" })).toBeAttached();
}

/** Two books, one highlight in each. */
async function buildShelf(page: Page) {
  await ready(page);
  await importBook(page, makeHostileEpub(), /hostile epub/i);
  await highlightEpub(page);
  await importBook(page, await makeSamplePdf(), /eviota\s*test/i);
  await highlightPdf(page);
}

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

async function freshProfile(browser: Browser, origin: string) {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  await ready(page);
  return { context, page };
}

test.describe("whole-shelf notes export", () => {
  test("every format carries the marks from every book", async ({ page }) => {
    await buildShelf(page);
    await page.goto("/#/settings");
    await expect(page.getByText("Export notes")).toBeVisible({ timeout: 30_000 });

    const text = async (label: string) =>
      (await download(page, () => page.getByRole("button", { name: label, exact: true }).click()))
        .bytes;

    const md = (await text("Markdown")).toString("utf8");
    expect(md).toContain("Hostile Epub");
    expect(md).toContain("Eviota Test");
    expect(md).toContain(EPUB_MARK);
    expect(md).toContain("ALPHA");

    const html = (await text("HTML")).toString("utf8");
    expect(html).toContain("Hostile Epub");
    expect(html).toContain("ALPHA");

    const json = JSON.parse((await text("JSON")).toString("utf8"));
    expect(JSON.stringify(json)).toContain(EPUB_MARK);
    expect(JSON.stringify(json)).toContain("ALPHA");

    const csv = (await text("CSV")).toString("utf8");
    expect(csv).toContain(EPUB_MARK);
    expect(csv).toContain("ALPHA");
  });
});

test.describe("backup and restore", () => {
  test("a full backup restores books and marks in a brand new profile, and restoring twice adds nothing", async ({
    page,
    browser,
  }) => {
    await buildShelf(page);
    await page.goto("/#/settings");
    const backup = await download(page, () =>
      page.getByRole("button", { name: "Export everything" }).click(),
    );
    expect(backup.name).toMatch(/\.eviota\.zip$/);
    const entries = unzipSync(new Uint8Array(backup.bytes));
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
    expect(manifest.counts.books).toBe(2);
    expect(manifest.counts.annotations).toBe(2);
    expect(Object.keys(entries).filter((k) => k.startsWith("blobs/"))).toHaveLength(2);

    const origin = new URL(page.url()).origin;
    const { context, page: other } = await freshProfile(browser, origin);
    try {
      // Nothing there yet.
      await other.goto("/#/");
      await expect(other.getByRole("link", { name: /hostile epub/i })).toHaveCount(0);

      await other.goto("/#/settings");
      const restore = async () => {
        await other.setInputFiles('input[type="file"]', {
          name: backup.name,
          mimeType: "application/zip",
          buffer: backup.bytes,
        });
      };
      await restore();
      await expect(other.getByText("Restored 2 new and 0 existing books")).toBeVisible({
        timeout: 30_000,
      });

      await other.goto("/#/");
      await expect(other.getByRole("link", { name: /hostile epub/i }).first()).toBeVisible();
      await expect(other.getByRole("link", { name: /eviota\s*test/i }).first()).toBeVisible();

      // The marks came with the books: open the PDF and find its highlight.
      await other
        .getByRole("link", { name: /eviota\s*test/i })
        .first()
        .click();
      await expect(other.getByRole("button", { name: "highlight annotation" })).toBeAttached({
        timeout: 30_000,
      });

      // And the EPUB's, through the notes tab.
      await other.goto("/#/");
      await other
        .getByRole("link", { name: /hostile epub/i })
        .first()
        .click();
      await frameWith(other, /Chapter One/);
      await other.getByRole("button", { name: "Notes" }).first().click();
      await expect(other.getByText(EPUB_MARK).first()).toBeVisible({ timeout: 30_000 });

      // Restoring the same file again merges: no new books.
      await other.goto("/#/settings");
      await restore();
      await expect(other.getByText("Restored 0 new and 2 existing books")).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await context.close();
    }
  });

  test("a zip that is not an Eviota backup is turned down in a sentence, and adds nothing", async ({
    page,
  }) => {
    await ready(page, "/#/settings");
    const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    // A manifest of some other app, with a book next to it that must not reach the shelf.
    const other = zipSync({
      "manifest.json": text({
        app: "somethingelse",
        schemaVersion: 1,
        createdAt: 1,
        includesBlobs: false,
        counts: { books: 1, annotations: 0, sessions: 0, collections: 0 },
      }),
      "books.json": text([
        {
          id: "not-ours-1",
          title: "Walden Pond Guide",
          author: "Someone",
          format: "epub",
          fileName: "walden.epub",
          size: 5,
          addedAt: 1,
          hasCover: false,
        },
      ]),
    });
    await page.setInputFiles('input[type="file"]', {
      name: "other.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(other),
    });
    await expect(page.getByText("That file isn't an Eviota backup.")).toBeVisible({
      timeout: 30_000,
    });
    // The toast is a sentence, not the validator's list of issues.
    await expect(page.getByText(/invalid_|"code"|"path"/)).toHaveCount(0);

    await page.goto("/#/");
    await expect(page.getByRole("link", { name: /walden pond guide/i })).toHaveCount(0);
  });
});

/** How many rows a store of the app's IndexedDB holds, read straight from the page. */
async function rows(page: Page, store: string) {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("folio-library");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const count = db.transaction(name).objectStore(name).count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      }),
    store,
  );
}

test.describe("metadata-only backup", () => {
  /**
   * Device A: imports the book, marks it, exports "Metadata only". Built in a context of its own
   * and kept for the tests below, which each play a second device.
   */
  let made: { name: string; bytes: Buffer; epub: string } | undefined;
  async function backupFromDeviceA(browser: Browser, origin: string) {
    if (made) return made;
    const { context, page } = await freshProfile(browser, origin);
    try {
      // One file, carried between the "devices" like a real EPUB. (The fixture builder stamps
      // the current time into the archive, so building it twice gives two different files.)
      const epub = makeHostileEpub();
      await importBook(page, epub, /hostile epub/i);
      await highlightEpub(page);
      await page.goto("/#/settings");
      const backup = await download(page, () =>
        page.getByRole("button", { name: "Metadata only" }).click(),
      );
      made = { ...backup, epub };
    } finally {
      await context.close();
    }
    return made;
  }

  test("carries no book file, and names the file it came from", async ({ browser, baseURL }) => {
    const backup = await backupFromDeviceA(browser, baseURL!);
    expect(backup.name).toMatch(/\.eviota\.zip$/);
    const entries = unzipSync(new Uint8Array(backup.bytes));
    expect(Object.keys(entries).filter((k) => k.startsWith("blobs/"))).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode(entries["manifest.json"])).includesBlobs).toBe(
      false,
    );
    const books = JSON.parse(new TextDecoder().decode(entries["books.json"]));
    expect(books).toHaveLength(1);
    expect(books[0].fingerprint).toMatch(/^[0-9a-f]{28}$/);
  });

  test("on a device that already has the same file, the notes attach to that copy", async ({
    browser,
    baseURL,
  }) => {
    const backup = await backupFromDeviceA(browser, baseURL!);
    // Device B imported the same file on its own, so it holds it under a different id.
    const { context, page } = await freshProfile(browser, baseURL!);
    try {
      await importBook(page, backup.epub, /hostile epub/i);
      expect(await rows(page, "books")).toBe(1);
      expect(await rows(page, "annotations")).toBe(0);

      await page.goto("/#/settings");
      await page.setInputFiles('input[type="file"]', {
        name: backup.name,
        mimeType: "application/zip",
        buffer: backup.bytes,
      });
      await expect(page.getByText("Restored 0 new and 1 existing books")).toBeVisible({
        timeout: 30_000,
      });
      expect(await rows(page, "books")).toBe(1); // no second, fileless copy
      expect(await rows(page, "annotations")).toBe(1);

      await page.goto("/#/");
      await page
        .getByRole("link", { name: /hostile epub/i })
        .first()
        .click();
      await frameWith(page, /Chapter One/); // it opens: the device's own file is there
      await page.getByRole("button", { name: "Notes" }).first().click();
      await expect(page.getByText(EPUB_MARK).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test("on a device without the book, it asks for the file, and the notes are there once given", async ({
    browser,
    baseURL,
  }) => {
    const backup = await backupFromDeviceA(browser, baseURL!);
    const { context, page } = await freshProfile(browser, baseURL!);
    try {
      await page.goto("/#/settings");
      await page.setInputFiles('input[type="file"]', {
        name: backup.name,
        mimeType: "application/zip",
        buffer: backup.bytes,
      });
      await expect(page.getByText("Restored 1 new and 0 existing books")).toBeVisible({
        timeout: 30_000,
      });
      expect(await rows(page, "books")).toBe(1);
      expect(await rows(page, "annotations")).toBe(1);
      expect(await rows(page, "files")).toBe(0);
      await expect(page.getByText("no file on this device")).toBeVisible({ timeout: 30_000 });

      // The book is on the shelf; opening it asks for the file instead of failing.
      await page.goto("/#/");
      await page
        .getByRole("link", { name: /hostile epub/i })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "This device doesn't have this book's file" }),
      ).toBeVisible({ timeout: 30_000 });

      // A different file is refused...
      await page.setInputFiles('input[aria-label="Choose the book file"]', makeProseEpub());
      await expect(page.getByText(/different size from the original/)).toBeVisible();

      // ...the same file is taken, and the notes that came in the backup are on it.
      await page.setInputFiles('input[aria-label="Choose the book file"]', backup.epub);
      await frameWith(page, /Chapter One/);
      await page.getByRole("button", { name: "Notes" }).first().click();
      await expect(page.getByText(EPUB_MARK).first()).toBeVisible({ timeout: 30_000 });
      expect(await rows(page, "books")).toBe(1);
      expect(await rows(page, "files")).toBe(1);

      await page.goto("/#/settings");
      await expect(page.getByText("no file on this device")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
