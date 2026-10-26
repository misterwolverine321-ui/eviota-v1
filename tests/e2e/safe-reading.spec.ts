import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import {
  EXTERNAL_LINK,
  makeHostileEpub,
  makeHostileHtml,
  makeHostileMarkdown,
  makeLinkPdf,
} from "./hostile";

/**
 * A book is untrusted. These specs drive the built app in a real browser with
 * hostile files and check the promises the README makes:
 *  - no script in the book runs and nothing is requested from the addresses it
 *    names (trackers, remote CSS, frames);
 *  - a link that leaves the app is never followed by itself: a left, middle,
 *    Ctrl or Shift click and the Enter key all ask first, and nothing opens
 *    until "Open link" is pressed.
 * The sandbox cannot reach the internet, so example.org is answered by the spec
 * itself and counted.
 */

interface Kind {
  name: string;
  file: () => string | Promise<string>;
  /** Text that proves the content (not the library) is on screen. */
  ready: RegExp;
  /** Where the link lives: the page itself (PDF) or the book's iframe. */
  inFrame: boolean;
  link: string;
}

const KINDS: Kind[] = [
  { name: "EPUB", file: makeHostileEpub, ready: /Chapter One/, inFrame: true, link: "#ext" },
  { name: "HTML", file: makeHostileHtml, ready: /Hostile Page/, inFrame: true, link: "#ext" },
  {
    name: "Markdown",
    file: makeHostileMarkdown,
    ready: /Hostile Markdown/,
    inFrame: true,
    link: "#rawext",
  },
  { name: "PDF", file: makeLinkPdf, ready: /Link PDF/, inFrame: false, link: "a[data-external]" },
];

interface Session {
  page: Page;
  tabs: Page[];
  requests: string[];
  linkHits: string[];
}

async function openBook(page: Page, file: string): Promise<Session> {
  const context = page.context();
  const session: Session = { page, tabs: [], requests: [], linkHits: [] };
  context.on("page", (p) => {
    if (p !== page) session.tabs.push(p);
  });
  context.on("request", (r) => session.requests.push(r.url()));
  await context.route(/^https:\/\/example\.org\//, (route) => {
    session.linkHits.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>stub</title>stub",
    });
  });
  await page.goto("/");
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', file);
  const card = page.locator('a[href*="#/read/"]').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/\/read\//);
  return session;
}

/** The iframe whose document contains `text`; foliate re-creates frames, so poll. */
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

async function contentLocator(session: Session, kind: Kind): Promise<Locator> {
  const { page } = session;
  if (!kind.inFrame) {
    await expect(page.locator(kind.link).first()).toBeAttached({ timeout: 30_000 });
    return page.locator(kind.link).first();
  }
  const frame = await frameWith(page, kind.ready);
  return frame.locator(kind.link).first();
}

const dialog = (page: Page) => page.getByText("Open this link?");

for (const kind of KINDS) {
  test.describe(`${kind.name}: hostile file`, () => {
    test("no script runs and nothing leaves for the addresses the file names", async ({ page }) => {
      const s = await openBook(page, await kind.file());
      await contentLocator(s, kind);
      // Give any remote request or timer a moment to show itself.
      await page.waitForTimeout(1_500);
      const flags = await page.evaluate(() =>
        Object.keys(window).filter((k) => k.startsWith("__pwned")),
      );
      expect(flags).toEqual([]);
      const leaked = s.requests.filter((u) => /^https?:\/\/[^/]*\.example(\/|:|$)/.test(u));
      expect(leaked).toEqual([]);
      expect(s.linkHits).toEqual([]);
    });

    test("every way of following an external link asks first", async ({ page }) => {
      const s = await openBook(page, await kind.file());
      const link = await contentLocator(s, kind);
      await link.scrollIntoViewIfNeeded().catch(() => {});

      const ways: [string, () => Promise<void>][] = [
        ["left click", () => link.click({ timeout: 5_000 })],
        ["middle click", () => link.click({ button: "middle", timeout: 5_000 })],
        ["Ctrl + click", () => link.click({ modifiers: ["Control"], timeout: 5_000 })],
        ["Shift + click", () => link.click({ modifiers: ["Shift"], timeout: 5_000 })],
        [
          "Enter key",
          async () => {
            await link.focus();
            await page.keyboard.press("Enter");
          },
        ],
      ];

      for (const [way, act] of ways) {
        s.tabs.length = 0;
        s.linkHits.length = 0;
        let unreachable: string | undefined;
        await act().catch((e: Error) => {
          unreachable = e.message.split("\n")[0];
        });
        // A new tab or a request is asynchronous; wait long enough to see one.
        await page.waitForTimeout(800);
        const asked = await dialog(page).isVisible();
        expect.soft(unreachable, `${way}: the link can be reached`).toBeUndefined();
        expect.soft(asked, `${way}: the confirmation is shown`).toBe(true);
        expect.soft(s.tabs.length, `${way}: no tab opened by itself`).toBe(0);
        expect.soft(s.linkHits, `${way}: nothing requested from the link target`).toEqual([]);
        for (const t of s.tabs) await t.close().catch(() => {});
        if (asked) {
          await page.getByRole("button", { name: "Stay here" }).click();
          await expect(dialog(page)).toBeHidden();
        }
      }
    });

    test("Open link opens the page in a tab that cannot reach back", async ({ page }) => {
      const s = await openBook(page, await kind.file());
      const link = await contentLocator(s, kind);
      await link.scrollIntoViewIfNeeded().catch(() => {});
      await link.click({ timeout: 5_000 });
      await expect(dialog(page)).toBeVisible();
      await expect(page.getByText(EXTERNAL_LINK, { exact: true })).toBeVisible();
      expect(s.tabs).toHaveLength(0);
      await page.getByRole("button", { name: "Open link" }).click();
      await expect.poll(() => s.tabs.length).toBe(1);
      const tab = s.tabs[0]!;
      await tab.waitForLoadState();
      expect(tab.url()).toBe(EXTERNAL_LINK);
      expect(await tab.evaluate(() => window.opener)).toBeNull();
    });
  });
}

test.describe("PDF links with a mouse", () => {
  test("an internal link turns to its page, and a javascript: link is not offered", async ({
    page,
  }) => {
    const s = await openBook(page, await makeLinkPdf());
    await contentLocator(s, KINDS[3]!);
    await expect(page.locator("a[data-internal-page]").first()).toBeAttached();
    expect(await page.locator("a[data-external]").count()).toBe(1);
    expect(await page.locator('a[href^="javascript:" i]').count()).toBe(0);
    await page.locator("a[data-internal-page]").first().click({ timeout: 5_000 });
    await expect(page.getByRole("spinbutton", { name: "Go to page" })).toHaveValue("2");
  });

  test("text away from a link can still be selected with the mouse", async ({ page }) => {
    // The link layer sits above the text layer; it must not swallow the drag.
    const s = await openBook(page, await makeLinkPdf());
    await contentLocator(s, KINDS[3]!);
    const title = page.locator(".textLayer span", { hasText: "Link PDF" }).first();
    await expect(title).toBeVisible();
    const box = (await title.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(selected).toContain("Link");
  });
});
