import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { unzipSync, zipSync } from "fflate";
import { REAL_PAIRS } from "../unit/fixtures/old-annotations";
import { makeMarkEpub } from "./hostile";

/**
 * Marks that checkpoint 8 and earlier stored with the wrong end (a triple click ran on over the
 * next paragraph) are corrected when the book is opened, in a real browser.
 *
 * The records are the real ones: `REAL_PAIRS` holds what that build stored and what the fixed
 * build stores for the same gestures on the same book. The spec restores the old ones from a
 * backup into a brand new profile (how they would arrive from another device), then checks what
 * is stored and what the reader does: tapping a paragraph that is not marked must not open a
 * mark, which is what the overshoot used to do for the paragraph after a marked one.
 */

test.use({ viewport: { width: 1280, height: 1500 } });

const T0 = 1_700_000_000_000;
/** P3 underline, last-block P5, P1 with a note, the #target sentence: the EPUB records. */
const EPUB_PAIRS = [0, 1, 3, 4].map((i) => REAL_PAIRS[i]!);

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function oldRecords(bookId: string) {
  return EPUB_PAIRS.map(([old], n) => ({
    ...clone(old),
    id: `old-${n}`,
    bookId,
    label: "Chapter One",
    createdAt: T0 + n,
    updatedAt: T0 + 1000 + n,
  }));
}

interface Stored {
  id: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  cfi?: string;
  updatedAt: number;
}

/** What the old build left, and what the fixed one stores, for the same marks. */
const asRestored = (side: 0 | 1): Stored[] =>
  EPUB_PAIRS.map((pair, n) => {
    const a = pair[side].anchor as unknown as Omit<Stored, "id" | "updatedAt">;
    return {
      id: `old-${n}`,
      start: a.start,
      end: a.end,
      quote: a.quote,
      prefix: a.prefix,
      suffix: a.suffix,
      cfi: a.cfi,
      updatedAt: T0 + 1000 + n,
    };
  });

/** Straight from IndexedDB, so the UI cannot paper over what is actually stored. */
function readStore(page: Page): Promise<Stored[]> {
  return page.evaluate(
    () =>
      new Promise<Stored[]>((resolve, reject) => {
        const open = indexedDB.open("folio-library");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("annotations").objectStore("annotations").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            const rows = all.result as {
              id: string;
              updatedAt: number;
              anchor: Omit<Stored, "id" | "updatedAt">;
            }[];
            resolve(
              rows
                .map((r) => ({
                  id: r.id,
                  start: r.anchor.start,
                  end: r.anchor.end,
                  quote: r.anchor.quote,
                  prefix: r.anchor.prefix,
                  suffix: r.anchor.suffix,
                  cfi: r.anchor.cfi,
                  updatedAt: r.updatedAt,
                }))
                .sort((a, b) => a.id.localeCompare(b.id)),
            );
          };
        };
      }),
  );
}

async function ready(page: Page, path = "/") {
  await page.goto(path);
  await waitForApp(page);
}

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

/** A real backup of this book from the current build, with the marks swapped for the old ones. */
async function oldBackupFrom(page: Page): Promise<Buffer> {
  await ready(page);
  await page.setInputFiles('input[type="file"]', makeMarkEpub());
  await expect(page.getByRole("link", { name: /mark probe/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/#/settings");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export everything" }).click(),
  ]);
  const entries = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  const books = dec(entries["books.json"]!) as { id: string }[];
  expect(books).toHaveLength(1);
  const manifest = dec(entries["manifest.json"]!);
  manifest.counts.annotations = EPUB_PAIRS.length;
  entries["manifest.json"] = enc(manifest);
  entries["annotations.json"] = enc(oldRecords(books[0]!.id));
  return Buffer.from(zipSync(entries));
}

/** A brand new browser profile (what another device amounts to) with the old backup restored. */
async function restoreInFreshProfile(
  browser: Browser,
  origin: string,
  backup: Buffer,
  viewport: { width: number; height: number },
) {
  const context = await browser.newContext({ baseURL: origin, viewport });
  const other = await context.newPage();
  await ready(other);
  await other.goto("/#/settings");
  await other.setInputFiles('input[type="file"]', {
    name: "from-checkpoint-8.eviota.zip",
    mimeType: "application/zip",
    buffer: backup,
  });
  await expect(other.getByText("Restored 1 new and 0 existing books")).toBeVisible({
    timeout: 30_000,
  });
  return { context, other };
}

test("marks an old build stored with the wrong end are corrected when the book is opened", async ({
  page,
  browser,
}) => {
  const oldBackup = await oldBackupFrom(page);
  const { context, other } = await restoreInFreshProfile(
    browser,
    new URL(page.url()).origin,
    oldBackup,
    { width: 1280, height: 1500 },
  );
  try {
    // As restored: exactly what the old build stored (the guard that the later change is a repair).
    expect(await readStore(other)).toEqual(asRestored(0));

    await other.goto("/#/");
    await other
      .getByRole("link", { name: /mark probe/i })
      .first()
      .click();
    const frame = await frameWith(other, /Chapter One/);

    // Opened: the three that overshot now hold what the fixed build stores for the same
    // gestures, including the CFI the engine derived; the one that never overshot is as it was,
    // and no mark counts as edited.
    await expect.poll(() => readStore(other), { timeout: 30_000 }).toEqual(asRestored(1));

    // What the reader does with them. A tap on a paragraph that is marked opens the mark; on one
    // that is not, it must open nothing (the old overshoot marked the paragraph after each).
    const del = other.getByRole("button", { name: "Delete", exact: true });
    const tap = async (label: string) => {
      const box = (await frame.locator("p", { hasText: label }).first().boundingBox())!;
      await other.mouse.click(box.x + 120, box.y + 10);
    };
    // Escape goes to the book's own document while focus is there, so close the popover by its
    // own button, as a reader would.
    const dismiss = async () => {
      await other.getByRole("button", { name: "Copy text" }).click();
      await expect(del).toHaveCount(0);
    };
    for (const marked of ["Real text that", "Paragraph 1:", "Paragraph 3:", "Paragraph 5:"]) {
      await tap(marked);
      await expect(del, `${marked} is marked`).toBeVisible();
      await dismiss();
    }
    for (const bare of ["Paragraph 2:", "Paragraph 4:"]) {
      await tap(bare);
      await other.waitForTimeout(800);
      await expect(del, `${bare} is not marked`).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

test("a jump to a repaired mark in a section that is not loaded lands on the mark", async ({
  page,
  browser,
}) => {
  // A screen short enough that the section spans several pages, so landing on the section's
  // first page is visibly not landing on the mark.
  const viewport = { width: 1280, height: 520 };
  const oldBackup = await oldBackupFrom(page);
  const { context, other } = await restoreInFreshProfile(
    browser,
    new URL(page.url()).origin,
    oldBackup,
    viewport,
  );
  try {
    // The reader was last in chapter two, so chapter one is not loaded when the book opens.
    await other.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("folio-library");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("books", "readwrite");
            const store = tx.objectStore("books");
            const all = store.getAll();
            all.onsuccess = () => {
              for (const book of all.result) {
                store.put({
                  ...book,
                  progress: {
                    kind: "cfi",
                    cfi: "epubcfi(/6/4!/4/2/1:0)",
                    fraction: 0.9,
                    updatedAt: Date.now(),
                  },
                });
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
    await other.goto("/#/");
    await other
      .getByRole("link", { name: /mark probe/i })
      .first()
      .click();
    await frameWith(other, /Chapter Two/);
    // Not repaired-and-resolved yet: the repaired marks have no CFI of their own.
    expect((await readStore(other)).filter((r) => r.cfi == null).length).toBe(3);

    await other.getByRole("button", { name: "Notes" }).first().click();
    await other.getByText("Paragraph 3: the quick brown fox").first().click();

    // Chapter one opens AND shows the paragraph the note is about, not the section's first page.
    await expect
      .poll(
        async () => {
          for (const f of other.frames()) {
            if (f === other.mainFrame()) continue;
            const body = await f.evaluate(() => document.body?.innerText ?? "").catch(() => "");
            if (!/Chapter One/.test(body)) continue;
            const box = await f
              .locator("p", { hasText: "Paragraph 3:" })
              .first()
              .boundingBox()
              .catch(() => null);
            return !!box && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0;
          }
          return false;
        },
        { timeout: 30_000, message: "Paragraph 3 is on the screen" },
      )
      .toBe(true);
    // And the CFI the engine derived on the way is kept.
    await expect.poll(() => readStore(other), { timeout: 30_000 }).toEqual(asRestored(1));
  } finally {
    await context.close();
  }
});
