import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeSamplePdf, makeSectionsEpub, SECTIONS_EPUB } from "./fixtures";
import { makeHostileEpub } from "./hostile";

/**
 * Shelf search over books that have never been opened (checkpoint 17). The shelf indexes EPUB and
 * PDF books in the background; a search reaches them without opening them, and a hit opens the
 * reader at the same page or section the index counted.
 */

const WALDEN = fileURLToPath(new URL("../../public/samples/walden.epub", import.meta.url));

async function gotoShelf(page: Page) {
  await page.goto("/");
  await waitForApp(page);
}

/** The spoken index line (the visible copy is hidden from assistive technology). */
const indexLine = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

const search = (page: Page) => page.getByRole("searchbox", { name: "Search shelf" });

/** The text of the section the reader is showing (it lives in a frame of its own). */
async function sectionText(page: Page): Promise<string> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const text = await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    if (/Chapter (Alpha|Bravo|Charlie|Delta|Echo)/.test(text)) return text;
  }
  return "";
}

test.describe("shelf search over books that were never opened", () => {
  test("a PDF and an EPUB that were never opened are found from the shelf, and a hit opens its page", async ({
    page,
  }) => {
    await gotoShelf(page);
    await page.setInputFiles('input[type="file"]', [await makeSamplePdf(), WALDEN]);
    await expect(indexLine(page, "2 of 2 books and documents indexed")).toBeAttached({
      timeout: 120_000,
    });

    // The PDF was not opened: its third page is found and opens at page 3 of 4.
    await search(page).fill("CHARLIE");
    const hit = page.getByRole("link").filter({ hasText: "CHARLIE" }).first();
    await expect(hit).toBeVisible({ timeout: 30_000 });
    await expect(hit).toContainText("Page 3");
    await hit.click();
    await expect(page).toHaveURL(/\/read\//);
    await expect(page.getByRole("slider", { name: "Page position" })).toHaveAttribute(
      "aria-valuetext",
      "Page 3 of 4",
      { timeout: 60_000 },
    );
  });

  for (const readBefore of [false, true]) {
    test(`an EPUB hit opens the chapter the index counted (${
      readBefore ? "the book had been read before" : "the book was never opened"
    })`, async ({ page }) => {
      const chapter = SECTIONS_EPUB.chapters[3]!; // the fourth spine item: unit 4
      await gotoShelf(page);
      await page.setInputFiles('input[type="file"]', makeSectionsEpub());
      await expect(indexLine(page, "1 of 1 book or document indexed")).toBeAttached({
        timeout: 120_000,
      });

      if (readBefore) {
        // Open it, so that it has a saved reading position (the first chapter), and come back.
        await page
          .getByRole("link", { name: new RegExp(SECTIONS_EPUB.title, "i") })
          .first()
          .click();
        await expect.poll(() => sectionText(page), { timeout: 60_000 }).toContain("Chapter Alpha");
        await page.waitForTimeout(2_500); // the position is saved after a short quiet moment
        await page.goBack();
        await gotoShelf(page);
      }

      await search(page).fill(chapter.word);
      const hit = page.getByRole("link").filter({ hasText: chapter.word }).first();
      await expect(hit).toBeVisible({ timeout: 30_000 });
      // The hit names the chapter its section falls under (the contents entry), not "Page 4".
      await expect(hit).toContainText(chapter.heading);
      await hit.click();
      await expect(page).toHaveURL(/\/read\//);

      await expect.poll(() => sectionText(page), { timeout: 60_000 }).toContain(chapter.heading);
      // And it stays there: nothing moves the reader back to the saved position afterwards.
      await page.waitForTimeout(3_000);
      expect(await sectionText(page)).toContain(chapter.heading);
    });
  }

  test("a word inside an EPUB that was never opened is found, with the count the index holds", async ({
    page,
  }) => {
    await gotoShelf(page);
    await page.setInputFiles('input[type="file"]', WALDEN);
    await expect(indexLine(page, "1 of 1 book or document indexed")).toBeAttached({
      timeout: 120_000,
    });
    await search(page).fill("pond");
    await expect(page.getByText("In your books", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    // Walden's sample text holds the word "pond" in two places (counted from its text).
    await expect(page.getByText(/^\d+ matches?$/).first()).toHaveText("2 matches");
  });

  test("a word that is in none of them says what was searched", async ({ page }) => {
    await gotoShelf(page);
    await page.setInputFiles('input[type="file"]', [await makeSamplePdf(), WALDEN]);
    await expect(indexLine(page, "2 of 2 books and documents indexed")).toBeAttached({
      timeout: 120_000,
    });
    await search(page).fill("zzqxvbn");
    await expect(
      page.getByText("No matches for “zzqxvbn” in 2 of 2 indexed books and documents."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Comic and DjVu books are searched inside their reader only."),
    ).toBeVisible();
  });

  test("indexing a hostile EPUB the shelf has never opened makes no request to any other address", async ({
    page,
  }) => {
    const origin = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:4173").origin;
    const elsewhere: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (!url.startsWith(origin)) elsewhere.push(url);
    });
    await gotoShelf(page);
    await page.setInputFiles('input[type="file"]', makeHostileEpub());
    await expect(indexLine(page, "1 of 1 book or document indexed")).toBeAttached({
      timeout: 120_000,
    });
    expect(elsewhere).toEqual([]);
  });
});
