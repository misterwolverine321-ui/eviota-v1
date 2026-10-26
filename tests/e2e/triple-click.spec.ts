import { expect, test, type Frame, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeHostileHtml, makeHostileMarkdown, makeProseEpub } from "./hostile";

/**
 * A triple click on a paragraph selects exactly that paragraph, and the mark made from it must
 * store exactly that paragraph. Chromium ends the selection in different places depending on what
 * follows: at the start of the next block (`(next block, 0)`) or, when an image follows, just
 * past the blank text before it (`(parent, index)`). Reading those boundaries as if they were
 * inside the next block stored the mark with the following paragraph in it (HTML, Markdown), and
 * for the second shape left the HTML reader with no mark popover at all.
 */

interface Case {
  name: string;
  file: () => string;
  ready: RegExp;
  paragraph: string;
  /** The CFI the reader keeps as its hint, as the fixed build stored it (EPUB only). */
  cfi?: string;
}

const CASES: Case[] = [
  {
    name: "HTML, an image follows the paragraph",
    file: makeHostileHtml,
    ready: /Hostile Page/,
    paragraph: "Paragraph 1:",
  },
  {
    name: "HTML, another paragraph follows directly",
    file: makeHostileHtml,
    ready: /Hostile Page/,
    paragraph: "Paragraph 3:",
  },
  {
    name: "Markdown, a paragraph follows",
    file: makeHostileMarkdown,
    ready: /Hostile Markdown/,
    paragraph: "Paragraph 2:",
  },
  {
    name: "EPUB with line breaks between blocks, a paragraph follows",
    file: makeProseEpub,
    ready: /Chapter One/,
    paragraph: "Alpha paragraph",
    cfi: "epubcfi(/6/2!/4/4[a],/1:0,/1:86)",
  },
  {
    name: "EPUB with line breaks between blocks, an image follows",
    file: makeProseEpub,
    ready: /Chapter One/,
    paragraph: "Beta paragraph",
    cfi: "epubcfi(/6/2!/4/6[b],/1:0,/1:85)",
  },
];

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

function storedAnchors(page: Page): Promise<{ quote: string | null; cfi: string | null }[]> {
  return page.evaluate(
    () =>
      new Promise<{ quote: string | null; cfi: string | null }[]>((resolve, reject) => {
        const open = indexedDB.open("folio-library");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("annotations").objectStore("annotations").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(
              (all.result as { anchor: { quote?: string; cfi?: string } }[]).map((a) => ({
                quote: a.anchor.quote ?? null,
                cfi: a.anchor.cfi ?? null,
              })),
            );
          };
        };
      }),
  );
}

test.use({ viewport: { width: 1280, height: 1500 } });

for (const c of CASES) {
  test(`a triple click stores the paragraph and nothing more: ${c.name}`, async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.setInputFiles('input[type="file"]', c.file());
    const card = page.locator('a[href*="#/read/"]').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    const frame = await frameWith(page, c.ready);

    const paragraph = frame.locator("p", { hasText: c.paragraph }).first();
    const text = (await paragraph.innerText()).trim();
    await paragraph.click({ clickCount: 3 });

    // The selection is accepted (the HTML reader used to show nothing here)...
    const highlight = page.getByRole("button", { name: "Highlight", exact: true });
    await expect(highlight).toBeVisible();
    await highlight.click();

    // ...and what is stored is that paragraph, not the next one with it.
    await expect.poll(() => storedAnchors(page), { timeout: 15_000 }).toHaveLength(1);
    const [stored] = await storedAnchors(page);
    expect(stored!.quote?.trim()).toBe(text);
    // The CFI kept as a hint ends with the paragraph too, not in the blank text after it.
    if (c.cfi) expect(stored!.cfi).toBe(c.cfi);
  });
}
