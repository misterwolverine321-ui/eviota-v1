import { expect, test, type Frame, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeMarkEpub } from "./hostile";

/**
 * Define is the one place the reader can start a request that carries something about what they
 * are reading: the selected word goes to Wiktionary (and Wikipedia if Wiktionary has no entry).
 * These specs drive the built app in a real browser and check what the README and Settings say:
 *  - nothing is requested until the reader has agreed, and what is sent is that word and nothing
 *    else from the book;
 *  - the answer is kept on this device, Cancel keeps nothing, and Settings can take it back;
 *  - the "Read more" link in the card waits for the same confirmation as a link in a book.
 * The sandbox cannot reach the internet, so Wikimedia is answered by the spec itself and counted.
 */

const WORD_PARAGRAPH = "Real text that the reader should see.";
const CONSENT_KEY = "nawiri-lookup-consent";

interface Session {
  page: Page;
  /** Every request that went to a Wikimedia address. */
  wiki: { url: string; referer: string | undefined }[];
  tabs: Page[];
  bookUrl: string;
}

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

async function begin(page: Page, options: { consent?: boolean } = {}): Promise<Session> {
  const context = page.context();
  const session: Session = { page, wiki: [], tabs: [], bookUrl: "" };
  context.on("page", (p) => {
    if (p !== page) session.tabs.push(p);
  });
  await context.route(/^https:\/\/[a-z-]+\.(?:wiktionary|wikipedia)\.org\//, (route) => {
    const request = route.request();
    const url = request.url();
    session.wiki.push({ url, referer: request.headers()["referer"] });
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.includes("/api/rest_v1/page/definition/")) {
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({
          en: [
            {
              partOfSpeech: "Noun",
              definitions: [{ definition: "Stub definition of the looked-up word." }],
            },
          ],
        }),
      });
    }
    // The page behind "Read more", and anything else: a stub page.
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "text/html",
      body: "<title>stub</title>stub",
    });
  });
  await page.goto("/");
  await ready(page);
  if (options.consent) {
    await page.evaluate((key) => localStorage.setItem(key, "1"), CONSENT_KEY);
  }
  await page.setInputFiles('input[type="file"]', makeMarkEpub());
  const card = page.locator('a[href*="#/read/"]').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/\/read\//);
  session.bookUrl = page.url();
  return session;
}

/** Select one word of the first paragraph the way a reader does: a double click on it. */
async function selectWord(page: Page, word: string) {
  const frame = await frameWith(page, /Chapter One/);
  const paragraph = frame.locator("p", { hasText: WORD_PARAGRAPH }).first();
  const at = await paragraph.evaluate((p, w) => {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? "").indexOf(w);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + w.length);
      const r = range.getBoundingClientRect();
      const box = p.getBoundingClientRect();
      return { x: r.x - box.x + r.width / 2, y: r.y - box.y + r.height / 2 };
    }
    return null;
  }, word);
  expect(at, `"${word}" is in the first paragraph`).not.toBeNull();
  await paragraph.dblclick({ position: at! });
}

async function define(page: Page, word: string) {
  await selectWord(page, word);
  const button = page.getByRole("button", { name: "Define", exact: true });
  await expect(button).toBeVisible();
  await button.click();
}

const consentStored = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY);

const askCard = (page: Page, word: string) =>
  page.getByRole("dialog", { name: `Look up ${word}?` });
const answerCard = (page: Page, word: string) =>
  page.getByRole("dialog", { name: `Definition of ${word}` });

test.describe("Define asks before it sends a word", () => {
  test("nothing is requested until the reader says yes, and then only that word is", async ({
    page,
  }) => {
    const s = await begin(page);
    await define(page, "reader");

    const ask = askCard(page, "reader");
    await expect(ask).toBeVisible();
    await expect(ask).toContainText("Nothing sent yet");
    await expect(ask).toContainText("sends that word to Wiktionary (en.wiktionary.org)");
    await expect(ask).toContainText("Nothing else from this book is sent.");
    // Give a wrongly eager card the time to ask Wikimedia anyway.
    await page.waitForTimeout(1_000);
    expect(s.wiki, "nothing requested before the answer").toEqual([]);

    await ask.getByRole("button", { name: "Look it up" }).click();
    const answer = answerCard(page, "reader");
    await expect(answer).toContainText("Stub definition of the looked-up word.");
    expect(s.wiki.map((r) => r.url)).toEqual([
      "https://en.wiktionary.org/api/rest_v1/page/definition/reader",
    ]);
    // The page sets `no-referrer`: the request does not name Eviota's address, let alone the book.
    expect(s.wiki[0]!.referer, "no Referer header on the lookup").toBeUndefined();
    expect(await consentStored(page)).toBe("1");
  });

  test("the answer is kept: after a reload the next word goes straight out", async ({ page }) => {
    const s = await begin(page);
    await define(page, "reader");
    await askCard(page, "reader").getByRole("button", { name: "Look it up" }).click();
    await expect(answerCard(page, "reader")).toBeVisible();
    expect(s.wiki).toHaveLength(1);

    await page.reload();
    await ready(page);
    await define(page, "sentence");
    await expect(answerCard(page, "sentence")).toContainText("Stub definition");
    await expect(page.getByRole("dialog", { name: /^Look up / })).toHaveCount(0);
    expect(s.wiki.map((r) => r.url)).toEqual([
      "https://en.wiktionary.org/api/rest_v1/page/definition/reader",
      "https://en.wiktionary.org/api/rest_v1/page/definition/sentence",
    ]);
  });

  test("Cancel sends nothing, keeps nothing, and the next Define asks again", async ({ page }) => {
    const s = await begin(page);
    await define(page, "reader");
    await askCard(page, "reader").getByRole("button", { name: "Cancel" }).click();
    await expect(askCard(page, "reader")).toBeHidden();
    expect(await consentStored(page)).toBeNull();

    await define(page, "sentence");
    await expect(askCard(page, "sentence")).toBeVisible();
    await page.waitForTimeout(500);
    expect(s.wiki).toEqual([]);
  });
});

test.describe("Settings can take the answer back", () => {
  test("Privacy says what Define does, and 'Ask before looking up words' makes it ask again", async ({
    page,
  }) => {
    const s = await begin(page, { consent: true });
    await define(page, "reader");
    await expect(answerCard(page, "reader")).toContainText("Stub definition");
    expect(s.wiki).toHaveLength(1);

    await page.goto("/#/settings");
    await expect(page.getByText("Define sends words without asking.")).toBeVisible();
    await page.getByRole("button", { name: "Ask before looking up words" }).click();
    await expect(page.getByText("Define asks before it sends a word.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask before looking up words" })).toHaveCount(0);
    expect(await consentStored(page)).toBeNull();

    await page.goto(s.bookUrl);
    await define(page, "sentence");
    await expect(askCard(page, "sentence")).toBeVisible();
    await page.waitForTimeout(500);
    expect(s.wiki, "nothing more was requested after the answer was taken back").toHaveLength(1);
  });

  test("a reader who never agreed sees that Define asks, with nothing to turn back", async ({
    page,
  }) => {
    await begin(page);
    await page.goto("/#/settings");
    await expect(page.getByText("Define asks before it sends a word.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask before looking up words" })).toHaveCount(0);
  });
});

test.describe("Read more waits for the same confirmation as a link in a book", () => {
  test("left click and middle click ask first; Stay here opens nothing; Open link opens one tab", async ({
    page,
  }) => {
    const s = await begin(page, { consent: true });
    await define(page, "reader");
    const answer = answerCard(page, "reader");
    await expect(answer).toContainText("Stub definition");
    const more = answer.getByRole("link", { name: /Read more/ });
    const target = "https://en.wiktionary.org/wiki/reader";
    const pageRequests = () => s.wiki.filter((r) => r.url === target);

    for (const way of ["left", "middle"] as const) {
      await more.click({ button: way });
      await expect(page.getByText("Open this link?")).toBeVisible();
      await expect(
        page.getByText("Eviota wants to open a page on en.wiktionary.org."),
        `${way}: the card is the one asking`,
      ).toBeVisible();
      await expect(page.getByText(target, { exact: true })).toBeVisible();
      expect(s.tabs, `${way}: no tab opened by itself`).toHaveLength(0);
      expect(pageRequests(), `${way}: nothing requested from the page`).toEqual([]);
      await page.getByRole("button", { name: "Stay here" }).click();
      await expect(page.getByText("Open this link?")).toBeHidden();
    }
    expect(s.tabs).toHaveLength(0);

    await more.click();
    await page.getByRole("button", { name: "Open link" }).click();
    await expect.poll(() => s.tabs.length).toBe(1);
    const tab = s.tabs[0]!;
    await tab.waitForLoadState();
    expect(tab.url()).toBe(target);
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    expect(pageRequests()).toHaveLength(1);
  });
});
