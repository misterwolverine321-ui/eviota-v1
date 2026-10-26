import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyIndex, indexPages } from "@/workers/search-index.worker";
import { deleteBook, getDb } from "@/lib/db";
import {
  ensureIndex,
  INDEX_VERSION,
  readIndex,
  readIndexMeta,
  sweepOrphanIndexes,
  writeIndex,
  type SearchIndexRecord,
} from "@/lib/search-index";
import { addShelfBook } from "./fixtures/shelf-book";

/**
 * The index of a book is written after every batch of a build, and a build can take a while. A book
 * deleted in between used to get its index records back from the next write, for good: nothing read
 * them, but every query loaded them and they were never removed.
 */

const addBook = addShelfBook;

function record(bookId: string): SearchIndexRecord {
  const index = emptyIndex(1);
  indexPages(index, [{ page: 1, text: "some words" }]);
  return {
    bookId,
    version: INDEX_VERSION,
    builtAt: 1,
    status: "ready",
    pending: [],
    rotations: {},
    index,
  };
}

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("searchIndex");
  await db.clear("searchMeta");
});

describe("an index build for a book that is deleted while it runs", () => {
  it("leaves no index record behind, and stops extracting", async () => {
    await addBook("orphan-1");
    const asked: number[] = [];
    const extract = async (page: number) => {
      asked.push(page);
      // The person deletes the book while the build is on its second page.
      if (page === 2) await deleteBook("orphan-1");
      return `words of page ${page}`;
    };
    const result = await ensureIndex({ bookId: "orphan-1", pageCount: 6, extract, batch: 1 });

    expect(await readIndex("orphan-1")).toBeUndefined();
    expect(await readIndexMeta("orphan-1")).toBeUndefined();
    // It did not go on reading the other four pages of a book that is gone.
    expect(asked).toEqual([1, 2]);
    // And it does not report a finished index.
    expect(result.status).not.toBe("ready");
  });

  it("does not start building for a book that is not on the shelf", async () => {
    const asked: number[] = [];
    const result = await ensureIndex({
      bookId: "never-shelved",
      pageCount: 4,
      extract: async (page) => {
        asked.push(page);
        return "words";
      },
      batch: 1,
    });
    expect(asked).toEqual([]);
    expect(await readIndex("never-shelved")).toBeUndefined();
    expect(await readIndexMeta("never-shelved")).toBeUndefined();
    expect(result.status).not.toBe("ready");
  });

  it("leaves nothing when the book is deleted just after the last page was indexed", async () => {
    await addBook("late-1");
    const result = await ensureIndex({
      bookId: "late-1",
      pageCount: 2,
      extract: async (page) => `words of page ${page}`,
      batch: 1,
      // Reported after the last batch is stored, before the build marks itself finished.
      onProgress: (p) => {
        if (p.status === "building" && p.done === 2) void deleteBook("late-1");
      },
    });
    expect(await readIndex("late-1")).toBeUndefined();
    expect(await readIndexMeta("late-1")).toBeUndefined();
    expect(result.status).not.toBe("ready");
  });

  it("leaves nothing when the book is deleted during a label refresh of a finished index", async () => {
    await addBook("label-1");
    await ensureIndex({
      bookId: "label-1",
      pageCount: 2,
      extract: async (page) => `words of page ${page}`,
    });
    expect((await readIndex("label-1"))?.status).toBe("ready");

    // Nothing is left to extract; only the labels are rewritten, and the book goes while they are.
    let gone: Promise<void> | undefined;
    const result = await ensureIndex({
      bookId: "label-1",
      pageCount: 2,
      extract: async () => "",
      label: (page) => {
        gone ??= deleteBook("label-1");
        return `page ${page}`;
      },
    });
    await gone;
    expect(await readIndex("label-1")).toBeUndefined();
    expect(await readIndexMeta("label-1")).toBeUndefined();
    expect(result.status).not.toBe("ready");
  });

  it("keeps the index of a book that is still there", async () => {
    await addBook("kept-1");
    const result = await ensureIndex({
      bookId: "kept-1",
      pageCount: 3,
      extract: async (page) => `words of page ${page}`,
      batch: 1,
    });
    expect(result.status).toBe("ready");
    expect((await readIndex("kept-1"))?.status).toBe("ready");
    expect((await readIndexMeta("kept-1"))?.status).toBe("ready");
  });
});

describe("writeIndex", () => {
  it("writes nothing for a book that is not on the shelf, and says so", async () => {
    expect(await writeIndex(record("never-added"))).toBe(false);
    expect(await readIndex("never-added")).toBeUndefined();
    expect(await readIndexMeta("never-added")).toBeUndefined();
  });

  it("writes both records for a book that is", async () => {
    await addBook("real-1");
    expect(await writeIndex(record("real-1"))).toBe(true);
    expect(await readIndex("real-1")).toBeDefined();
    expect(await readIndexMeta("real-1")).toBeDefined();
  });
});

describe("sweepOrphanIndexes", () => {
  it("removes the records of books that are gone and nothing else", async () => {
    await addBook("alive");
    const db = await getDb();
    // Left behind by an older build: records with no book.
    await db.put("searchIndex", record("gone-a"));
    await db.put("searchIndex", record("gone-b"));
    await db.put("searchMeta", { bookId: "gone-a", version: INDEX_VERSION, status: "ready" });
    await db.put("searchMeta", { bookId: "only-meta", version: INDEX_VERSION, status: "ready" });
    await db.put("searchIndex", record("alive"));
    await db.put("searchMeta", { bookId: "alive", version: INDEX_VERSION, status: "ready" });

    expect(await sweepOrphanIndexes()).toBe(3);

    expect(await db.getAllKeys("searchIndex")).toEqual(["alive"]);
    expect(await db.getAllKeys("searchMeta")).toEqual(["alive"]);
    expect(await db.getAllKeys("books")).toEqual(["alive"]);
  });

  it("does nothing on a shelf with no leftovers", async () => {
    await addBook("alive");
    await (await getDb()).put("searchIndex", record("alive"));
    expect(await sweepOrphanIndexes()).toBe(0);
    expect(await readIndex("alive")).toBeDefined();
  });
});
