import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyIndex, indexPages } from "@/workers/search-index.worker";
import { INDEX_VERSION, type IndexStatus } from "@/lib/search-index";
import { getDb, type BookRecord } from "@/lib/db";
import { hitOffset, hitPage, searchLibrary } from "@/lib/library-search";
import type { SearchHit } from "@/lib/reader-settings";

/**
 * The search across the shelf. Each test builds small synthetic indexes straight into the store, so
 * it is about which books are searched and how the results are ordered, not about indexing.
 */

const id = (k: number) => `book-${String(k).padStart(4, "0")}`;

function book(k: number): BookRecord {
  return {
    id: id(k),
    title: `Book ${k}`,
    author: "Author",
    format: "epub",
    fileName: `${k}.epub`,
    size: 1,
    addedAt: k,
    hasCover: false,
    progress: null,
  };
}

async function putIndex(k: number, text: string, status: IndexStatus = "ready") {
  const index = emptyIndex(1);
  indexPages(index, [{ page: 1, text }]);
  const db = await getDb();
  await db.put("searchIndex", {
    bookId: id(k),
    version: INDEX_VERSION,
    builtAt: 1,
    status,
    pending: [],
    rotations: {},
    index,
  });
}

beforeEach(async () => {
  await (await getDb()).clear("searchIndex");
});

describe("searchLibrary", () => {
  it("searches every indexed book, not only the first few", async () => {
    const books = Array.from({ length: 60 }, (_, k) => book(k));
    for (const b of books) await putIndex(Number(b.id.slice(5)), "plain filler words");
    await putIndex(59, "plain filler words and the rare word quillfeather");
    const results = await searchLibrary("quillfeather", books);
    expect(results.map((r) => r.bookId)).toEqual([id(59)]);
  });

  it("lists at most maxBooks books, the ones with the most matches first", async () => {
    const books = Array.from({ length: 12 }, (_, k) => book(k));
    for (let k = 0; k < 12; k++) await putIndex(k, "ember ".repeat(k === 11 ? 5 : 1));
    const results = await searchLibrary("ember", books, { maxBooks: 3 });
    expect(results).toHaveLength(3);
    expect(results[0]!.bookId).toBe(id(11));
  });

  it("leaves out books that are not on the shelf and indexes that are not ready", async () => {
    await putIndex(1, "ember here", "ready");
    await putIndex(2, "ember here", "building");
    await putIndex(3, "ember here", "ready"); // no shelf record for book 3
    const results = await searchLibrary("ember", [book(1), book(2)]);
    expect(results.map((r) => r.bookId)).toEqual([id(1)]);
  });

  it("answers nothing for a query shorter than two characters", async () => {
    await putIndex(1, "ember here");
    expect(await searchLibrary("e", [book(1)])).toEqual([]);
    expect(await searchLibrary("  ", [book(1)])).toEqual([]);
  });
});

describe("hitPage and hitOffset", () => {
  const hit = (target: SearchHit["target"]): SearchHit => ({
    id: "h",
    excerpt: { pre: "", match: "x", post: "" },
    target,
  });

  it("read the page and the offset a page-based hit carries, for a link from the shelf", () => {
    const h = hit({ kind: "page", page: 4, offset: 1234 });
    expect(hitPage(h)).toBe(4);
    expect(hitOffset(h)).toBe(1234);
  });

  it("say nothing for a hit that has no offset or is not page-based", () => {
    expect(hitOffset(hit({ kind: "page", page: 4 }))).toBeNull();
    expect(hitOffset(hit({ kind: "cfi", cfi: "epubcfi(/6/2)" }))).toBeNull();
    expect(hitPage(hit({ kind: "cfi", cfi: "epubcfi(/6/2)" }))).toBeNull();
  });

  it("keeps an offset of zero: a match at the very start of a section is still a place", () => {
    expect(hitOffset(hit({ kind: "page", page: 1, offset: 0 }))).toBe(0);
  });
});
