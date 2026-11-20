import { expect, test, type Frame, type Page } from "@playwright/test";
import { makeLongEpub, makeLongTxt, makeSampleCbz, makeSamplePdf } from "./fixtures";
import { pngPixel } from "./png-pixel";
import { waitForApp } from "./ready";

/**
 * The reading surface, round two, end to end in Chromium:
 *  - every page turn starts a slide, and reduced motion turns it off,
 *  - a text selection swaps the top bar for its actions, and the actions work,
 *  - a dark page stays dark on open, on an in-app reopen and after a change in Display,
 *  - back goes one screen at a time, and the shelf is the end of the stack.
 * Chromium only. Safari has not been run here (see playwright.webkit.config.ts).
 */

/** How the shelf names each fixture: the text file by its file name, the EPUB by its title. */
const LONG_TXT = /long.document/i;
const LONG_EPUB = /long.document/i;
const PDF = /eviota.test/i;
const CBZ = /eviota.comic/i;

/** The host behind a Dusk page (`#131313`). */
const DUSK = "rgb(19, 19, 19)";

type CueWindow = Window & { __cues?: number };

/** Counts the slides the reading surface starts: every animate() call on it. Runs before any page script. */
async function countSlides(page: Page) {
  await page.addInitScript(() => {
    const w = window as CueWindow;
    w.__cues = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      if (this.hasAttribute("data-reading-surface")) w.__cues = (w.__cues ?? 0) + 1;
      return animate.apply(this, args);
    };
  });
}

function slideCount(page: Page) {
  return page.evaluate(() => (window as CueWindow).__cues ?? 0);
}

async function expectSlide(page: Page, before: number) {
  await expect.poll(() => slideCount(page)).toBeGreaterThan(before);
}

async function openBook(page: Page, file: string, name: RegExp) {
  await page.goto("/");
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', file);
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.getByRole("button", { name: "Next page" })).toBeAttached();
}

/** Picks a book from the shelf without a page load, as a reader does after going back to it. */
async function reopenBook(page: Page, name: RegExp) {
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.getByRole("button", { name: "Next page" })).toBeAttached();
}

async function leaveBook(page: Page) {
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page).not.toHaveURL(/\/read\//);
}

async function mainBox(page: Page) {
  const box = await page.locator("main").boundingBox();
  if (!box) throw new Error("the reading surface has no box");
  return box;
}

/** The top bar is on screen, not slid off the top of it. */
async function expectHeaderShown(page: Page) {
  const back = page.getByRole("link", { name: "Back to library" });
  await expect(back).toBeVisible();
  await expect.poll(async () => (await back.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
}

/** The book's own document frame, once it has text (an e-book draws into a frame). */
async function bookFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const f of page.frames()) {
          if (f === page.mainFrame()) continue;
          const n = await f.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
          if (n > 200) {
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

/** The colour of the host the book sits in: the element the foliate view is appended to. */
function hostBackground(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view");
    return view?.parentElement ? getComputedStyle(view.parentElement).backgroundColor : null;
  });
}

/** Whether a pixel in the left margin, read from a screenshot, is dark. */
async function marginIsDark(page: Page): Promise<boolean> {
  const png = await page.screenshot({ clip: { x: 3, y: 400, width: 2, height: 2 } });
  const [r, g, b] = pngPixel(png, 0, 0);
  return Math.max(r, g, b) < 60;
}

/**
 * The share of sampled points on the book's page that are light, read from a screenshot. The
 * margin check above only sees the outer edge of the screen, which is dark even when the page
 * itself is white. Text is light only in its strokes, so a dark page reads near 0 and a white one
 * near 1.
 */
async function lightShareOfPage(page: Page): Promise<number> {
  const box = await page.locator("foliate-view").boundingBox();
  if (!box) throw new Error("the book is not on the screen");
  const inset = 90; // clear of the top and bottom bars
  const clip = { x: box.x, y: box.y + inset, width: box.width, height: box.height - 2 * inset };
  const png = await page.screenshot({ clip });
  let light = 0;
  let total = 0;
  for (let i = 1; i <= 12; i++) {
    for (let j = 1; j <= 10; j++) {
      const [r, g, b] = pngPixel(
        png,
        Math.floor((clip.width * i) / 13),
        Math.floor((clip.height * j) / 11),
      );
      total++;
      if (Math.max(r, g, b) > 128) light++;
    }
  }
  return light / total;
}

async function setTheme(page: Page, theme: string) {
  await page.goto("/");
  await waitForApp(page);
  await page.evaluate(
    (t) =>
      localStorage.setItem(
        "nawiri-reader-settings",
        JSON.stringify({ settingsSchema: 2, theme: t }),
      ),
    theme,
  );
  await page.reload();
  await waitForApp(page);
}

/** Double-clicks a word in the second paragraph of a text document; returns the word. */
async function selectWordInText(page: Page): Promise<string> {
  await page.locator("main p").filter({ hasText: /\S/ }).nth(1).dblclick();
  const word = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(word.trim().length).toBeGreaterThan(0);
  return word.trim();
}

function toolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Selection actions" });
}

test.describe("desktop: every page turn starts a slide", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await countSlides(page);
  });

  test("a click on the right third slides a text page; a click in the middle does not", async ({
    page,
  }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    const box = await mainBox(page);
    const y = box.y + box.height / 2;
    const before = await slideCount(page);
    await page.mouse.click(box.x + box.width * 0.9, y);
    await expectSlide(page, before);

    const middle = await slideCount(page);
    await page.mouse.click(box.x + box.width / 2, y);
    await page.waitForTimeout(400);
    expect(await slideCount(page)).toBe(middle);
  });

  test("the arrow keys and the page buttons slide the page too", async ({ page }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    let before = await slideCount(page);
    await page.keyboard.press("ArrowRight");
    await expectSlide(page, before);

    before = await slideCount(page);
    await page.getByRole("button", { name: "Previous page" }).click();
    await expectSlide(page, before);

    before = await slideCount(page);
    await page.getByRole("button", { name: "Next page" }).click();
    await expectSlide(page, before);
  });

  test("an e-book page turn slides the page", async ({ page }) => {
    await openBook(page, makeLongEpub(), LONG_EPUB);
    const box = await mainBox(page);
    const before = await slideCount(page);
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    await expectSlide(page, before);
  });

  test("a PDF page turn slides the page", async ({ page }) => {
    await openBook(page, await makeSamplePdf(), PDF);
    const box = await mainBox(page);
    const before = await slideCount(page);
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    await expectSlide(page, before);
  });

  test("a comic page turn slides the page once its tap delay has passed", async ({ page }) => {
    await openBook(page, makeSampleCbz(), CBZ);
    const box = await mainBox(page);
    const before = await slideCount(page);
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    await expectSlide(page, before);
  });

  test("with reduced motion on, a page turn does not slide", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBook(page, makeLongTxt(), LONG_TXT);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    expect(await slideCount(page)).toBe(0);
  });
});

test.describe("phone: a touch tap slides the page", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a tap on the right third of a text page slides it", async ({ page }) => {
    await countSlides(page);
    await openBook(page, makeLongTxt(), LONG_TXT);
    const box = await mainBox(page);
    const before = await slideCount(page);
    await page.touchscreen.tap(box.x + box.width * 0.9, box.y + box.height / 2);
    await expectSlide(page, before);
  });
});

test.describe("desktop: a selection uses the top bar", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("selecting a word swaps the top bar for the actions, with no floating box", async ({
    page,
  }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    await selectWordInText(page);
    await expect(
      page.locator("header").getByRole("toolbar", { name: "Selection actions" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Selection actions" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to library" })).toHaveCount(0);
  });

  test("a colour from the bar highlights the word, and the mark is listed in Notes", async ({
    page,
  }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    const word = await selectWordInText(page);
    await page.getByRole("button", { name: "yellow colour" }).click();
    await expect(toolbar(page)).toHaveCount(0);
    await expectHeaderShown(page);

    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByRole("tabpanel").getByText(word).first()).toBeVisible();
  });

  test("a note from the bar is saved and listed in Notes", async ({ page }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    await selectWordInText(page);
    await page.getByRole("button", { name: "Add note" }).click();
    await page.getByRole("textbox", { name: "Note" }).fill("round two note");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(toolbar(page)).toHaveCount(0);
    await expectHeaderShown(page);

    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByRole("tabpanel").getByText("round two note").first()).toBeVisible();
  });

  test("the close button and Escape both dismiss the bar and bring the header back", async ({
    page,
  }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    await selectWordInText(page);
    await page.getByRole("button", { name: "Close selection actions" }).click();
    await expect(toolbar(page)).toHaveCount(0);
    await expectHeaderShown(page);

    await selectWordInText(page);
    await expect(toolbar(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(toolbar(page)).toHaveCount(0);
    await expectHeaderShown(page);
  });

  test("a selection on the first lines is not hidden under the bar", async ({ page }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    await page.locator("main p").filter({ hasText: /\S/ }).first().dblclick();
    await expect(toolbar(page)).toBeVisible();
    const header = await page.locator("header").first().boundingBox();
    const top = await page.evaluate(() => {
      const range = window.getSelection()?.getRangeAt(0);
      return range ? range.getBoundingClientRect().top : null;
    });
    expect(header).not.toBeNull();
    expect(top).not.toBeNull();
    expect(top!).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  });

  test("a selection in an e-book opens the same bar", async ({ page }) => {
    await openBook(page, makeLongEpub(), LONG_EPUB);
    const frame = await bookFrame(page);
    await frame.locator("p").filter({ hasText: /\S/ }).nth(1).dblclick();
    await expect(
      page.locator("header").getByRole("toolbar", { name: "Selection actions" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to library" })).toHaveCount(0);
  });
});

test.describe("desktop: a dark page stays dark", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a Dusk book opens dark and reopens dark from the shelf", async ({ page }) => {
    await setTheme(page, "dusk");
    await openBook(page, makeLongEpub(), LONG_EPUB);
    const frame = await bookFrame(page);
    await expect.poll(() => hostBackground(page)).toBe(DUSK);
    expect(await marginIsDark(page)).toBe(true);
    const ink = await frame
      .locator("p")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = (ink.match(/\d+/g) ?? []).map(Number);
    expect((r! + g! + b!) / 3).toBeGreaterThan(120);

    await leaveBook(page);
    await reopenBook(page, LONG_EPUB);
    await bookFrame(page);
    await expect.poll(() => hostBackground(page)).toBe(DUSK);
    expect(await marginIsDark(page)).toBe(true);
  });

  test("a change to Dusk in Display applies at once and is kept after reopening", async ({
    page,
  }) => {
    await openBook(page, makeLongEpub(), LONG_EPUB);
    await bookFrame(page);
    await expect.poll(() => hostBackground(page)).not.toBe(DUSK);

    await page.getByRole("button", { name: "Display", exact: true }).click();
    await page.getByRole("button", { name: "Dusk", exact: true }).click();
    await expect.poll(() => hostBackground(page)).toBe(DUSK);
    expect(await marginIsDark(page)).toBe(true);

    await page.keyboard.press("Escape");
    await leaveBook(page);
    await reopenBook(page, LONG_EPUB);
    await bookFrame(page);
    await expect.poll(() => hostBackground(page)).toBe(DUSK);
  });
});

test.describe("desktop: back goes one screen at a time, and the shelf is the end", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("back from a book returns to the shelf, and the shelf logo adds no screen", async ({
    page,
  }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    const opened = await page.evaluate(() => history.length);
    await leaveBook(page);
    expect(await page.evaluate(() => history.length)).toBe(opened);

    await page.locator("header").first().locator("a").first().click();
    await expect(page).not.toHaveURL(/\/read\//);
    expect(await page.evaluate(() => history.length)).toBe(opened);
  });

  test("opening a book again is a new screen, and going back leaves the book", async ({ page }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    await leaveBook(page);
    await reopenBook(page, LONG_TXT);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/read\//);
  });

  test("Settings goes back to the shelf", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("link", { name: "Settings" }).first().click();
    await expect(page).toHaveURL(/#\/settings/);
    await page.getByRole("link", { name: /shelf/i }).first().click();
    await expect(page).not.toHaveURL(/#\/settings/);
  });

  test("a book opened from a bookmark backs out to the shelf, and never back into the book", async ({
    page,
    context,
  }) => {
    await openBook(page, makeLongTxt(), LONG_TXT);
    await leaveBook(page);
    const href = await page.getByRole("link", { name: LONG_TXT }).first().getAttribute("href");
    expect(href).toMatch(/#\/read\//);
    const hash = href!.slice(href!.indexOf("#"));

    const fresh = await context.newPage();
    await fresh.goto(`/${hash}`);
    await expect(fresh).toHaveURL(/\/read\//);
    await expect(fresh.getByRole("button", { name: "Next page" })).toBeAttached();
    const before = await fresh.evaluate(() => history.length);
    await fresh.getByRole("link", { name: "Back to library" }).click();
    await expect(fresh).not.toHaveURL(/\/read\//);
    expect(await fresh.evaluate(() => history.length)).toBe(before);
  });

  test("Go home on a missing page replaces it, and adds no screen", async ({ page }) => {
    await page.goto("/#/no-such-screen");
    await waitForApp(page);
    const before = await page.evaluate(() => history.length);
    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).not.toHaveURL(/no-such-screen/);
    expect(await page.evaluate(() => history.length)).toBe(before);
  });
});

// On a phone the page fills the width of the screen, so a white page shows up as most of the frame.
// On a desktop the text column is narrow and the dark margins hide most of it, so the phone size
// is the one that catches it. The system scheme is dark too: foliate repaints the page when the
// scheme changes, and a white page showed up only with the dark system scheme.
test.describe("phone: a dark page stays dark", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });

  test("a Dusk book whose own page is white still has a dark page, not a white sheet", async ({
    page,
  }) => {
    await setTheme(page, "dusk");
    await openBook(page, makeLongEpub({ whitePage: true }), LONG_EPUB);
    await bookFrame(page);
    await expect.poll(() => hostBackground(page)).toBe(DUSK);
    expect(await lightShareOfPage(page)).toBeLessThan(0.5);
  });
});
