import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";

/**
 * DjVu files open and are read with the `djvu-rs` engine: the page is decoded in a
 * worker, drawn on a canvas, turned with the keys and taps every other paged engine answers to, and
 * searched through its own text layer. The two files are real documents from the `djvu-rs`
 * repository's corpus; where they came from is in `tests/e2e/data/README.md`.
 */

const data = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./data/${name}`, import.meta.url)));

const BOOKLET = {
  name: "booklet-1905.djvu",
  mimeType: "image/vnd.djvu",
  buffer: data("cyrillic_simonovich_co2.djvu"),
  pages: 12,
};
const CABLE = {
  name: "cable-1973.djvu",
  mimeType: "image/vnd.djvu",
  buffer: data("cable_1973_100133.djvu"),
  pages: 2,
};
const COLOUR = {
  name: "goody-two-shoes-1888.djvu",
  mimeType: "image/vnd.djvu",
  buffer: data("goody_twoshoes.djvu"),
  pages: 16,
};

async function ready(page: Page) {
  await waitForApp(page);
}

/** Imports one file and opens it from the shelf. */
async function open(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/");
  await ready(page);
  await page.setInputFiles('input[type="file"]', file);
  const card = page.locator('a[href*="#/read/"]').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/\/read\//);
}

/** How many pixels of the canvas are not white: a blank or failed page has none. */
const inkOf = (canvas: ReturnType<Page["locator"]>) =>
  canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! < 200 || data[i + 1]! < 200 || data[i + 2]! < 200) ink++;
    }
    return { ink, width: c.width, height: c.height };
  });

/** How many pixels of the canvas are visibly coloured (not grey): a greyscale page has none. */
const colourOf = (canvas: ReturnType<Page["locator"]>) =>
  canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const { data, width, height } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    let coloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.max(data[i]!, data[i + 1]!, data[i + 2]!) -
          Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >
        40
      )
        coloured++;
    }
    return { coloured, pixels: width * height };
  });

const position = (page: Page) => page.getByRole("slider", { name: "Page position" });
const pageImage = (page: Page, n: number) =>
  page.getByRole("img", { name: `Scanned image of page ${n}` });

async function openDrawerTab(page: Page, name: string) {
  await page.getByRole("banner").getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

// Half of the coloured-pixel count measured on the drawn colour page on 2026-10-18 (108,072): a grey page has 0.
const COLOUR_MIN_PIXELS = 50_000;

test.describe("DjVu reader", () => {
  test("a DjVu file opens, and its first page is drawn with ink on it", async ({ page }) => {
    await open(page, BOOKLET);
    const canvas = pageImage(page, 1);
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await inkOf(canvas)).ink, { timeout: 30_000 })
      .toBeGreaterThan(500);
    const { width, height } = await inkOf(canvas);
    expect(width, "drawn at a usable size").toBeGreaterThanOrEqual(256);
    expect(height / width, "a portrait page").toBeGreaterThan(1);
    await expect(position(page)).toHaveAttribute("aria-valuetext", `Page 1 of ${BOOKLET.pages}`);
  });

  test("the arrow keys and a tap on either outer third turn the page; the middle does not", async ({
    page,
  }) => {
    await open(page, BOOKLET);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    const slider = position(page);

    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", `Page 2 of ${BOOKLET.pages}`);
    await expect(pageImage(page, 2)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", `Page 1 of ${BOOKLET.pages}`);

    const surface = page.locator("[data-djvu-surface]");
    const box = (await surface.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.click(box.x + box.width * 0.85, y);
    await expect(slider).toHaveAttribute("aria-valuetext", `Page 2 of ${BOOKLET.pages}`);
    await page.mouse.click(box.x + box.width * 0.5, y);
    await page.waitForTimeout(400);
    await expect(slider).toHaveAttribute("aria-valuetext", `Page 2 of ${BOOKLET.pages}`);
    await page.mouse.click(box.x + box.width * 0.15, y);
    await expect(slider).toHaveAttribute("aria-valuetext", `Page 1 of ${BOOKLET.pages}`);
  });

  test("the first and last page are the ends: there is nothing beyond them", async ({ page }) => {
    await open(page, CABLE);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    const slider = position(page);
    await expect(slider).toHaveAttribute("aria-valuetext", `Page 1 of ${CABLE.pages}`);
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", `Page 1 of ${CABLE.pages}`);
    await page.keyboard.press("ArrowRight");
    await expect(pageImage(page, 2)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    await expect(slider).toHaveAttribute("aria-valuetext", `Page ${CABLE.pages} of ${CABLE.pages}`);
    // The second page of this file is not blank either.
    await expect
      .poll(async () => (await inkOf(pageImage(page, 2))).ink, { timeout: 30_000 })
      .toBeGreaterThan(200);
  });

  test("search runs on the scan's own text layer and a result jumps to its page", async ({
    page,
  }) => {
    await open(page, BOOKLET);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    await openDrawerTab(page, "Search");
    // A word that the text layer has on page 3 and nowhere else (read from the file with the
    // decoder in Node before this spec was written).
    await page.getByRole("textbox", { name: "Search in book" }).fill("обусловливается");
    const results = page.getByRole("list", { name: "Search results" });
    await expect(results.getByRole("listitem")).toHaveCount(1, { timeout: 60_000 });
    await expect(results.getByRole("listitem").first()).toContainText("обусловливается");
    await results.getByRole("button").first().click();
    await expect(position(page)).toHaveAttribute("aria-valuetext", `Page 3 of ${BOOKLET.pages}`);
    await page.keyboard.press("Escape");
    await expect(pageImage(page, 3)).toBeVisible({ timeout: 30_000 });
  });

  test("a search typed the moment the tab appears waits for the index and is answered", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "slowing the processor needs Chromium's DevTools protocol",
    );
    // A DjVu scan has no search of its own: its words come from the index, which is built after the
    // book opens. A query typed before that used to answer "No results" and keep saying it. The
    // processor is slowed down so that the build is still running when the query is typed (without
    // that it happens only on some runs).
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', BOOKLET);
    const card = page.locator('a[href*="#/read/"]').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await card.click();
    const tab = page.getByRole("banner").getByRole("button", { name: "Search", exact: true });
    await expect(tab).toBeVisible({ timeout: 90_000 });
    await tab.click();
    await page.getByRole("textbox", { name: "Search in book" }).fill("обусловливается");
    const results = page.getByRole("list", { name: "Search results" });
    await expect(results.getByRole("listitem")).toHaveCount(1, { timeout: 60_000 });
    await expect(results.getByRole("listitem").first()).toContainText("обусловливается");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });

  test("a word that is not in the file finds nothing", async ({ page }) => {
    await open(page, BOOKLET);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    await openDrawerTab(page, "Search");
    await page.getByRole("textbox", { name: "Search in book" }).fill("zebra");
    await expect(page.getByText("No matches for")).toBeVisible({ timeout: 60_000 });
  });

  test("the page's text is there for a screen reader, and only the pages on screen carry it", async ({
    page,
  }) => {
    await open(page, BOOKLET);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    const first = page.getByRole("group", { name: `Page 1 of ${BOOKLET.pages}` });
    await expect(first).toContainText("РУКОВОДСТВО ДЛЯ УЧИТЕЛЕЙ", { timeout: 30_000 });
    // The drawn page is an image named for what it is; the text sits beside it, not in its name.
    await expect(pageImage(page, 1)).toHaveAttribute("aria-label", "Scanned image of page 1");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const third = page.getByRole("group", { name: `Page 3 of ${BOOKLET.pages}` });
    await expect(third).toContainText("Углекислота", { timeout: 30_000 });
    await expect(page.getByRole("group", { name: `Page 1 of ${BOOKLET.pages}` })).toHaveCount(0);
  });

  test("two pages side by side, and the keys then turn two at a time", async ({ page }) => {
    await open(page, BOOKLET);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    await openDrawerTab(page, "Display");
    await page.getByRole("button", { name: "Two pages" }).click();
    await page.keyboard.press("Escape");
    await expect(pageImage(page, 2)).toBeVisible({ timeout: 30_000 });
    await expect(pageImage(page, 1)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(pageImage(page, 3)).toBeVisible({ timeout: 30_000 });
    await expect(pageImage(page, 4)).toBeVisible({ timeout: 30_000 });
    await expect(position(page)).toHaveAttribute("aria-valuetext", `Page 3 of ${BOOKLET.pages}`);
  });

  test("the place is kept: leaving a book on page 5 and opening it again returns to page 5", async ({
    page,
  }) => {
    await open(page, BOOKLET);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await expect(position(page)).toHaveAttribute("aria-valuetext", `Page 5 of ${BOOKLET.pages}`);
    await expect(pageImage(page, 5)).toBeVisible({ timeout: 30_000 });
    // Progress is written shortly after the page settles.
    await page.waitForTimeout(1500);
    await page.getByRole("banner").getByRole("link", { name: "Back to library" }).click();
    await expect(page).not.toHaveURL(/\/read\//);
    await page.locator('a[href*="#/read/"]').first().click();
    await expect(position(page)).toHaveAttribute("aria-valuetext", `Page 5 of ${BOOKLET.pages}`, {
      timeout: 60_000,
    });
    await expect(pageImage(page, 5)).toBeVisible({ timeout: 30_000 });
  });

  test("another book opened through the address, while one is open, shows nothing left over from the first", async ({
    page,
  }) => {
    // Changing the book in the address keeps the reader mounted (the route does not go back to its
    // loading state), so the reader is handed a different file and has to forget the first one.
    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', BOOKLET);
    const cards = page.locator('a[href*="#/read/"]');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    const hrefs = () =>
      cards.evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")))]);
    const [bookletHref] = await hrefs();
    await page.setInputFiles('input[type="file"]', CABLE);
    await expect.poll(async () => (await hrefs()).length, { timeout: 30_000 }).toBe(2);
    const cableHref = (await hrefs()).find((h) => h !== bookletHref)!;

    await page.locator(`a[href="${bookletHref}"]`).first().click();
    await expect(position(page)).toHaveAttribute("aria-valuetext", `Page 1 of ${BOOKLET.pages}`, {
      timeout: 60_000,
    });
    await expect(page.getByRole("group", { name: `Page 1 of ${BOOKLET.pages}` })).toContainText(
      "РУКОВОДСТВО ДЛЯ УЧИТЕЛЕЙ",
      { timeout: 30_000 },
    );

    await page.evaluate((href) => {
      window.location.hash = new URL(href, window.location.href).hash;
    }, cableHref);

    await expect(position(page)).toHaveAttribute("aria-valuetext", `Page 1 of ${CABLE.pages}`, {
      timeout: 60_000,
    });
    const first = page.getByRole("group", { name: `Page 1 of ${CABLE.pages}` });
    await expect(first).toContainText("Declassified/Released US Department of State", {
      timeout: 30_000,
    });
    await expect(first, "the first book's text is not spoken for the second").not.toContainText(
      "РУКОВОДСТВО",
    );
    // The page's box takes its shape from the page that is drawn in it (0.7725 here, 0.6871 for the
    // first book's page 1), not from a shape remembered from the other book.
    const canvas = pageImage(page, 1);
    await expect
      .poll(async () => (await inkOf(canvas)).ink, { timeout: 30_000 })
      .toBeGreaterThan(500);
    const drawn = await inkOf(canvas);
    const box = (await canvas.boundingBox())!;
    expect(Math.abs(box.width / box.height - drawn.width / drawn.height)).toBeLessThan(0.02);
  });

  test("a colour page is drawn in colour, not in grey", async ({ page }) => {
    // A colour IW44 page (the layer that carries colour is what this checks); the file is a
    // public-domain book from the djvu-rs corpus, see tests/e2e/data/README.md.
    await open(page, COLOUR);
    const canvas = pageImage(page, 1);
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await colourOf(canvas)).coloured, { timeout: 30_000 })
      .toBeGreaterThan(COLOUR_MIN_PIXELS);
    const { coloured, pixels } = await colourOf(canvas);
    expect(coloured / pixels, "a substantial part of the page is coloured").toBeGreaterThan(0.05);
  });

  test("a damaged file says so and offers itself back unchanged", async ({ page }) => {
    const bytes = Buffer.concat([
      Buffer.from("AT&TFORM\u0000\u0000\u0000\u0010DJVMDIRM\u0000\u0000\u0000\u0000"),
      Buffer.from("this is not the rest of a DjVu file"),
    ]);
    await open(page, { name: "broken.djvu", mimeType: "image/vnd.djvu", buffer: bytes });
    await expect(page.getByRole("heading", { name: "Couldn't open this file" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("could not be read")).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download file" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("broken.djvu");
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
  });

  test("once a DjVu file has been opened the decoder is kept, and a book opens with no network", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await ready(page);
    // The service worker must be in charge of the page before the decoder is asked for, or its
    // answer is not kept. (A first visit registers the worker; it claims the page when it starts.)
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
        timeout: 60_000,
      })
      .toBe(true);
    await page.setInputFiles('input[type="file"]', BOOKLET);
    const card = page.locator('a[href*="#/read/"]').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });

    const kept = () =>
      page.evaluate(async () => {
        const names = await caches.keys();
        if (!names.includes("nawiri-djvu")) return [];
        const cache = await caches.open("nawiri-djvu");
        return (await cache.keys()).map((request) => new URL(request.url).pathname);
      });
    await expect.poll(kept, { timeout: 30_000 }).toHaveLength(1);
    expect((await kept())[0]).toMatch(/\/assets\/djvu_rs_bg-[\w-]+\.wasm$/);

    await context.setOffline(true);
    await page.goto("/");
    await ready(page);
    await page.locator('a[href*="#/read/"]').first().click();
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await inkOf(pageImage(page, 1))).ink, { timeout: 30_000 })
      .toBeGreaterThan(500);
  });

  test("the decoder comes from the site's own files and nothing is asked of any other address", async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) asked.push(request.url());
    });
    await open(page, BOOKLET);
    await expect(pageImage(page, 1)).toBeVisible({ timeout: 60_000 });
    const hosts = new Set(asked.map((url) => new URL(url).host));
    expect([...hosts], "every request went to the site itself").toEqual(["127.0.0.1:4173"]);
    expect(
      asked.filter((url) => /\/assets\/djvu_rs_bg-[\w-]+\.wasm$/.test(url)),
      "exactly one of the two builds was fetched",
    ).toHaveLength(1);
    expect(asked.some((url) => /\/assets\/djvu\.worker-[\w-]+\.js$/.test(url))).toBe(true);
  });
});

/**
 * A large scan (a photograph-sized page, 6780 × 9148 pixels in its file) is not in the repository:
 * its origin is not known. Set EVIOTA_LARGE_DJVU to a local path to run this; it is skipped
 * otherwise. Its timing is printed so the number can be recorded.
 */
const LARGE_SCAN = process.env.EVIOTA_LARGE_DJVU;
test.describe("large scan from a local path", () => {
  test.skip(!LARGE_SCAN, "set EVIOTA_LARGE_DJVU to a local .djvu file to run this");

  test("a page with tens of megapixels opens and is drawn within a minute", async ({ page }) => {
    const started = Date.now();
    await open(page, {
      name: "large-scan.djvu",
      mimeType: "image/vnd.djvu",
      buffer: readFileSync(LARGE_SCAN!),
    });
    const canvas = pageImage(page, 1);
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await inkOf(canvas)).ink, { timeout: 60_000 })
      .toBeGreaterThan(500);
    console.log(`large scan: first page drawn in ${Date.now() - started} ms`);
    const { width, height } = await inkOf(canvas);
    expect(width, "drawn at a usable size, not at its full size").toBeLessThan(3200);
    expect(height / width, "a portrait page").toBeGreaterThan(1);
  });
});
