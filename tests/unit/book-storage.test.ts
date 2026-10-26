// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it } from "vitest";
import { bookOpenState, checkReattach } from "@/lib/book-open-state";
import { getBook, getBookFile, putBook, type BookRecord } from "@/lib/db";
import { evictSource, reattachSource } from "@/lib/storage";

// Each test uses its own book id: db.ts keeps one cached connection per module,
// so isolation comes from unique ids rather than a fresh database.
const record = (id: string, size: number): BookRecord => ({
  id,
  title: "Walden",
  author: "Thoreau",
  format: "pdf",
  fileName: "walden.pdf",
  size,
  addedAt: 1,
  hasCover: false,
  lastOpenedAt: 12345,
});
// Node's Blob, not jsdom's: fake-indexeddb structured-clones what it stores, and a
// jsdom Blob comes back as an empty object (size undefined). Real browsers
// store real Blobs, so this keeps the test faithful to them.
const blobOf = (n: number) => new NodeBlob([new Uint8Array(n)]) as unknown as Blob;

describe("evicting a book's file and putting it back (real IndexedDB API via fake-indexeddb)", () => {
  it("evictSource leaves the record and removes the file, which the reader screen reports as 'evicted'", async () => {
    await putBook(record("evict-1", 100), blobOf(100));
    await evictSource("evict-1");
    const book = await getBook("evict-1");
    const file = await getBookFile("evict-1");
    expect(book?.blobEvicted).toBe(true);
    expect(file).toBeUndefined();
    expect(bookOpenState(book, file)).toBe("evicted");
  });

  it("reattachSource restores the SAME record: same id, notes and progress fields kept, file back, book opens", async () => {
    await putBook(record("evict-2", 100), blobOf(100));
    await evictSource("evict-2");

    const original = blobOf(100);
    expect(checkReattach(await getBook("evict-2"), original)).toEqual({ ok: true });
    await reattachSource("evict-2", original);

    const book = await getBook("evict-2");
    const file = await getBookFile("evict-2");
    expect(book?.id).toBe("evict-2");
    expect(book?.lastOpenedAt).toBe(12345); // record untouched
    expect(book?.blobEvicted).toBe(false);
    expect(file?.size).toBe(100);
    expect(bookOpenState(book, file)).toBe("ready");
  });

  it("a wrong-sized file is refused by the check, so the caller never writes it", async () => {
    await putBook(record("evict-3", 100), blobOf(100));
    await evictSource("evict-3");
    expect(checkReattach(await getBook("evict-3"), blobOf(101))).toEqual({
      ok: false,
      reason: "size",
    });
    // Nothing was written: still evicted.
    expect(bookOpenState(await getBook("evict-3"), await getBookFile("evict-3"))).toBe("evicted");
  });
});
