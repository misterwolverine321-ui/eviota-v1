import { fileURLToPath } from "node:url";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { TOC_EPUB, makeSampleCbz, makeSamplePdf, makeTocEpub } from "./fixtures";
import {
  EXTERNAL_LINK,
  makeHostileEpub,
  makeHostileHtml,
  makeHostileMarkdown,
  makeMarkEpub,
} from "./hostile";
import { auditAccessibleNames, auditStructure, axNodes, type A11yProblem } from "./a11y";

/**
 * Accessibility of the built app, driven in a real browser.
 *
 * Two kinds of check:
 *  - an audit of the browser's own accessibility tree (names, landmarks, references) in every
 *    state listed below. It needs Chromium's tree and is skipped elsewhere;
 *  - explicit assertions on the promises the interface makes to a keyboard or screen-reader
 *    user (a tab list that moves with the arrow keys, toggles that say whether they are on,
 *    focus that comes back). They go through roles and names only, so they run in any engine.
 *
 * What this does NOT show: how a real screen reader speaks any of it (nothing here ran under
 * NVDA, JAWS, VoiceOver or TalkBack), colour contrast, or behaviour in Safari or on a phone.
 */

const AUDIT_BROWSER = "chromium";

/** Names a header button and a hero button share on purpose: both start the same file picker. */
const SHARED_NAMES = ["Add books"];

async function ready(page: Page) {
  await waitForApp(page);
}

async function frameWith(page: Page, text: RegExp): Promise<Frame> {
  let found: Frame | undefined;
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

const describe = (p: A11yProblem) =>
  `${p.rule}: ${p.role} "${p.name}"${p.html ? `  ${p.html}` : ""}`;

/** Runs both audits; in an engine other than Chromium only the structure audit runs. */
async function audit(page: Page, label: string) {
  const problems: A11yProblem[] = await auditStructure(page);
  if (page.context().browser()?.browserType().name() === AUDIT_BROWSER) {
    problems.push(...(await auditAccessibleNames(page, { repeatedNames: SHARED_NAMES })));
  }
  expect(problems.map(describe), `accessibility problems in: ${label}`).toEqual([]);
}

async function openShelf(page: Page) {
  await page.goto("/");
  await ready(page);
}

async function importFiles(page: Page, files: string[]) {
  await page.setInputFiles('input[type="file"]', files);
}

async function openBook(page: Page, name: RegExp) {
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(/\/read\//);
}

/**
 * Opens the drawer from the toolbar and audits every tab it offers, so a format that has no
 * Contents or no Pages tab is audited for the tabs it does have. Returns the tab names.
 */
async function auditEveryTab(page: Page, label: string, minimum: string[]): Promise<string[]> {
  await page.getByRole("banner").getByRole("button", { name: "Display", exact: true }).click();
  const drawer = page.getByRole("dialog").filter({ has: page.getByRole("tablist") });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  const tabNames = () =>
    drawer
      .getByRole("tab")
      .evaluateAll((tabs) => tabs.map((t) => t.getAttribute("aria-label") ?? ""));
  // A format offers its tabs as the book finishes loading (a PDF's Pages tab needs its page
  // count), so wait for the ones this format must have rather than read the list too early.
  await expect
    .poll(tabNames, { message: `${label}: tabs offered`, timeout: 30_000 })
    .toEqual(expect.arrayContaining(minimum));
  // ...and for the rest of them to settle, so none is skipped because it arrived a moment later.
  let names = await tabNames();
  for (;;) {
    await page.waitForTimeout(500);
    const again = await tabNames();
    if (again.join() === names.join()) break;
    names = again;
  }
  for (const name of names) {
    await drawer.getByRole("tab", { name, exact: true }).click();
    await expect(drawer.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await audit(page, `${label}, ${name} tab`);
  }
  return names;
}

test.describe("accessibility: names and structure of every screen", () => {
  test.skip(
    ({ browserName }) => browserName !== AUDIT_BROWSER,
    "the audit reads Chromium's accessibility tree",
  );

  test("shelf: empty", async ({ page }) => {
    await openShelf(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await audit(page, "empty shelf");
  });

  test("Settings and the not-found page", async ({ page }) => {
    await openShelf(page);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await audit(page, "Settings");

    await page.goto("/#/no-such-page");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
    await audit(page, "not found");
  });

  test("shelf with books of every kind", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeMarkEpub(), await makeSamplePdf(), makeSampleCbz()]);
    await expect(page.getByRole("link", { name: /mark probe/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /eviota\s*test/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /eviota\s*comic/i })).toBeVisible();
    await audit(page, "shelf with three books");

    await page.getByRole("button", { name: "Add tag to Mark Probe" }).click();
    await page.getByRole("textbox", { name: "New tag for Mark Probe" }).fill("fiction");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Tags for Mark Probe" })).toContainText("fiction");
    await audit(page, "shelf after a tag was added");

    await page.getByRole("button", { name: "New collection" }).click();
    await audit(page, "shelf with the new-collection field open");
  });

  test("EPUB reader and every drawer tab", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeTocEpub()]);
    await openBook(page, /contents probe/i);
    await frameWith(page, /Chapter One/);
    await audit(page, "EPUB reader");

    await auditEveryTab(page, "EPUB reader", ["Contents", "Notes", "Search", "Display"]);
    // The Contents tab nests the section under its chapter, as a list inside a list item.
    await page.getByRole("tab", { name: "Contents", exact: true }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("list").first().getByRole("listitem").first()).toContainText(
      TOC_EPUB.nested,
    );
    await expect(panel.getByRole("list")).toHaveCount(2);
  });

  test("PDF reader and its drawer tabs", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [await makeSamplePdf()]);
    await openBook(page, /eviota\s*test/i);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await audit(page, "PDF reader");

    await auditEveryTab(page, "PDF reader", ["Notes", "Search", "Display", "Pages"]);
  });

  test("comic reader and its drawer tabs", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeSampleCbz()]);
    await openBook(page, /eviota\s*comic/i);
    await expect(page.locator("[data-comic-fit]").locator("img").first()).toBeVisible({
      timeout: 60_000,
    });
    await audit(page, "comic reader");
    await auditEveryTab(page, "comic reader", ["Display", "Pages"]);
  });

  test("DjVu reader and its drawer tabs", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [
      fileURLToPath(new URL("./data/cyrillic_simonovich_co2.djvu", import.meta.url)),
    ]);
    await openBook(page, /cyrillic/i);
    await expect(page.getByRole("img", { name: "Scanned image of page 1" })).toBeVisible({
      timeout: 60_000,
    });
    // The scan's text layer is read for a screen reader once the page is up.
    await expect(page.getByRole("group", { name: "Page 1 of 12" })).toContainText("РУКОВОДСТВО", {
      timeout: 30_000,
    });
    await audit(page, "DjVu reader");
    await auditEveryTab(page, "DjVu reader", ["Display", "Search", "Pages"]);
  });

  for (const [name, make, ready_] of [
    ["HTML", makeHostileHtml, /Hostile Page/],
    ["Markdown", makeHostileMarkdown, /Hostile Markdown/],
  ] as const) {
    test(`${name} reader`, async ({ page }) => {
      await openShelf(page);
      await importFiles(page, [make()]);
      await openBook(page, /hostile/i);
      await frameWith(page, ready_);
      await audit(page, `${name} reader`);
      await auditEveryTab(page, `${name} reader`, ["Display"]);
    });
  }

  test("safe-reading panel, link question and selection actions", async ({ page }) => {
    // example.org is not reachable from the sandbox, and nothing here should ask for it.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await openShelf(page);
    await importFiles(page, [makeHostileEpub()]);
    await openBook(page, /hostile/i);
    const shield = page.getByRole("button", { name: /^Safe reading/ });
    await expect(shield).toBeVisible({ timeout: 30_000 });
    await shield.click();
    await expect(page.getByRole("dialog", { name: /safe reading/i })).toBeVisible();
    await audit(page, "safe-reading panel");
    await page.keyboard.press("Escape");
    // Gone, not just closing: the panel's fade-out sits over the book for a moment, and the reader
    // lays the page out again while the panel goes (a click in that window was lost, 2 runs in 40).
    await expect(page.getByRole("dialog", { name: /safe reading/i })).toHaveCount(0);

    const frame = await frameWith(page, /Chapter One/);
    const link = frame.locator("#ext");
    // Click the link where it stands once the page has stopped moving.
    let before = "";
    await expect
      .poll(
        async () => {
          const now = JSON.stringify(await link.boundingBox());
          const still = now === before;
          before = now;
          return still;
        },
        { intervals: [250] },
      )
      .toBe(true);
    await link.click();
    const question = page.getByRole("alertdialog");
    await expect(question).toBeVisible();
    await expect(question).toContainText(new URL(EXTERNAL_LINK).hostname);
    await audit(page, "external-link question");
    await page.keyboard.press("Escape");
    // Gone, not just closing: the dialog's dark overlay fades out over the book, and a double click
    // during the fade lands on the overlay, not the text (the selection failed in about half of
    // the runs before this wait). The same wait is used for the safe-reading panel above.
    await expect(question).toHaveCount(0);

    await frame.locator("p", { hasText: "Paragraph 1" }).first().dblclick();
    const actions = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(actions).toBeVisible();
    await audit(page, "selection actions");
  });
});

test.describe("accessibility: what the interface promises a keyboard or screen-reader user", () => {
  test("the shelf offers one link per book, distinct tag controls, and gives focus back", async ({
    page,
  }) => {
    await openShelf(page);
    await importFiles(page, [makeMarkEpub(), await makeSamplePdf(), makeSampleCbz()]);
    const titles = [/^mark probe/i, /^eviota\s*test/i, /^eviota\s*comic/i];
    for (const title of titles) {
      await expect(page.getByRole("link", { name: title })).toHaveCount(1, { timeout: 30_000 });
    }
    // The cover is left to the mouse and the finger: hidden from the accessibility tree and out
    // of the tab order, so the Tab key and a screen reader meet each book once.
    const covers = page.locator('a[href*="#/read/"][aria-hidden="true"]');
    await expect(covers).toHaveCount(3);
    for (const cover of await covers.all()) await expect(cover).toHaveAttribute("tabindex", "-1");

    // Three books, three differently named buttons for the same job.
    const addTag = page.getByRole("button", { name: /^Add tag to / });
    await expect(addTag).toHaveCount(3);
    const names = await addTag.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(new Set(names).size).toBe(3);
    expect(names).toContain("Add tag to Mark Probe");

    // Keyboard only: Enter on the button opens the field, Enter in the field saves the tag and
    // puts focus back on the button instead of dropping it on the page.
    const add = page.getByRole("button", { name: "Add tag to Mark Probe" });
    await add.focus();
    await page.keyboard.press("Enter");
    const field = page.getByRole("textbox", { name: "New tag for Mark Probe" });
    await expect(field).toBeFocused();
    await page.keyboard.type("fiction");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Tags for Mark Probe" })).toContainText("fiction");
    await expect(add).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Remove tag fiction from Mark Probe" }),
    ).toBeVisible();

    // Escape gives focus back as well and keeps nothing.
    await page.keyboard.press("Enter");
    await page.keyboard.type("discard-me");
    await page.keyboard.press("Escape");
    await expect(add).toBeFocused();
    await expect(page.getByRole("group", { name: "Tags for Mark Probe" })).not.toContainText(
      "discard-me",
    );
  });

  test("removing a book takes two presses and says so", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeMarkEpub()]);
    await expect(page.getByRole("link", { name: /^mark probe/i })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Remove Mark Probe" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Confirm removal of Mark Probe" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "This is not undone." })).toHaveText(
      "Press the button again to remove Mark Probe. This is not undone.",
    );
  });

  test("the reader has one h1, a banner, a main, named controls and a spoken position", async ({
    page,
  }) => {
    await openShelf(page);
    await importFiles(page, [makeTocEpub()]);
    await openBook(page, /contents probe/i);
    await frameWith(page, /Chapter One/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TOC_EPUB.title);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Back to library" }),
    ).toBeVisible();
    const controls = page.getByRole("navigation", { name: "Reading controls" });
    await expect(controls.getByRole("button", { name: "Previous page" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Next page" })).toBeVisible();
    await expect(controls.getByRole("slider", { name: "Reading position" })).toHaveAttribute(
      "aria-valuetext",
      /^\d+% read$/,
    );
    // The book's own frame is named, so a screen reader does not say "frame".
    const frame = await frameWith(page, /Chapter One/);
    expect(await (await frame.frameElement()).getAttribute("title")).toBe("Book text");
  });

  test("the progress is spoken once it has settled, not on every scroll step", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeTocEpub()]);
    await openBook(page, /contents probe/i);
    await frameWith(page, /Chapter One/);
    const status = page.getByRole("navigation", { name: "Reading controls" }).getByRole("status");
    // Count how often the spoken text is rewritten while the reader jumps about quickly.
    await status.evaluate((el) => {
      const w = window as unknown as { __spoken: number };
      w.__spoken = 0;
      new MutationObserver(() => (w.__spoken += 1)).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    const slider = page.getByRole("slider", { name: "Reading position" });
    await slider.focus();
    for (const key of ["End", "Home", "End", "Home", "End", "Home"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(2_000);
    const writes = await page.evaluate(() => (window as unknown as { __spoken: number }).__spoken);
    expect(writes, "six quick jumps are announced as one settled value").toBeLessThanOrEqual(2);
    await expect(status).not.toBeEmpty();
  });

  test("the drawer is a labelled dialog with a tab list that works from the keyboard", async ({
    page,
  }) => {
    await openShelf(page);
    await importFiles(page, [makeTocEpub()]);
    await openBook(page, /contents probe/i);
    await frameWith(page, /Chapter One/);

    const opener = page.getByRole("banner").getByRole("button", { name: "Display", exact: true });
    await opener.click();
    // The dialog is named by the panel it shows, so its name follows the tab; find it by its tabs.
    const drawer = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("tablist", { name: "Reader panels" }) });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAccessibleName("Display");
    const tablist = drawer.getByRole("tablist", { name: "Reader panels" });
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(4); // Contents, Notes, Search, Display
    await expect(tablist.getByRole("tab", { name: "Display", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(drawer.getByRole("tabpanel", { name: "Display" })).toBeVisible();

    // One tab is in the tab order; the others are reached with the arrow keys.
    const stops = await tabs.evaluateAll((els) => els.filter((el) => el.tabIndex === 0).length);
    expect(stops).toBe(1);

    // Arrow keys move focus and leave the selection alone (manual activation).
    await tablist.getByRole("tab", { name: "Display", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tablist.getByRole("tab", { name: "Search", exact: true })).toBeFocused();
    await expect(tablist.getByRole("tab", { name: "Display", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Home");
    await expect(tablist.getByRole("tab", { name: "Contents", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(tablist.getByRole("tab", { name: "Display", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight"); // wraps to the first
    await expect(tablist.getByRole("tab", { name: "Contents", exact: true })).toBeFocused();
    await expect(tablist.getByRole("tab", { name: "Display", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Enter selects it and the panel follows, named by its tab.
    await page.keyboard.press("Enter");
    await expect(tablist.getByRole("tab", { name: "Contents", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(drawer.getByRole("tabpanel", { name: "Contents" })).toBeVisible();
    await expect(drawer).toHaveAccessibleName("Contents");

    // Closing returns focus to the button that opened the drawer.
    await drawer.getByRole("button", { name: "Close drawer" }).click();
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("toggles keep their name and say whether they are on", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeTocEpub()]);
    await openBook(page, /contents probe/i);
    await frameWith(page, /Chapter One/);

    await page.getByRole("banner").getByRole("button", { name: "Search", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Search" });
    for (const name of ["Match case", "Whole word"]) {
      const toggle = panel.getByRole("button", { name, exact: true });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await toggle.click();
      // Same name, new state.
      await expect(panel.getByRole("button", { name, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }

    // The same holds for the toolbar's own toggles.
    const notes = page.getByRole("banner").getByRole("button", { name: "Notes", exact: true });
    await expect(notes).toHaveAttribute("aria-pressed", /true|false/);
  });

  test("a stepper names its buttons and announces the new value", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeTocEpub()]);
    await openBook(page, /contents probe/i);
    await frameWith(page, /Chapter One/);
    await page.getByRole("banner").getByRole("button", { name: "Display", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Display" });
    const group = panel.getByRole("group", { name: "Text size" });
    await expect(group).toBeVisible();
    const live = group.getByRole("status");
    const before = await live.textContent();
    await group.getByRole("button", { name: "Increase Text size" }).click();
    await expect(live).not.toHaveText(before ?? "");
    await expect(live).toContainText("Text size");
    // The panel's sections are headings, so they can be jumped to.
    await expect(panel.getByRole("heading", { level: 3, name: "Theme" })).toBeVisible();
  });

  test("a comic page is an image named with its position", async ({ page }) => {
    await openShelf(page);
    await importFiles(page, [makeSampleCbz()]);
    await openBook(page, /eviota\s*comic/i);
    await expect(page.locator("[data-comic-fit]").locator("img").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("img", { name: /^Page 1 of \d+/ })).toBeVisible();
  });

  test("Settings has a level-1 heading and its sections are level-2 headings", async ({ page }) => {
    await page.goto("/#/settings");
    await ready(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    expect(await page.getByRole("heading", { level: 2 }).count()).toBeGreaterThan(2);
  });

  test("an unknown address shows a main region with a heading", async ({ page }) => {
    await page.goto("/#/definitely-not-a-page");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  });

  test("the accessibility tree names the book's controls (Chromium)", async ({ page }) => {
    test.skip(
      page.context().browser()?.browserType().name() !== AUDIT_BROWSER,
      "reads Chromium's accessibility tree",
    );
    await openShelf(page);
    await importFiles(page, [makeTocEpub()]);
    await openBook(page, /contents probe/i);
    await frameWith(page, /Chapter One/);
    const nodes = await axNodes(page);
    const has = (role: string, name: string) =>
      nodes.some((n) => n.role === role && n.name === name);
    expect(has("heading", TOC_EPUB.title)).toBe(true);
    expect(has("link", "Back to library")).toBe(true);
    expect(has("navigation", "Reading controls")).toBe(true);
    expect(has("slider", "Reading position")).toBe(true);
    // No highlight overlay is exposed as an unnamed image.
    expect(nodes.filter((n) => n.role === "image" && n.name === "")).toEqual([]);
  });
});
