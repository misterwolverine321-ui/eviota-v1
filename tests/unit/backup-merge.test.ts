import { describe, expect, it } from "vitest";
import { backupFileName, mergeAnnotation, mergeBook, mergeCollection } from "@/lib/backup";
import type { Collection } from "@/lib/collections";
import type { BookRecord } from "@/lib/db";

function book(overrides: Partial<BookRecord>): BookRecord {
  return {
    id: "b1",
    title: "Book",
    author: "A",
    format: "epub",
    size: 10,
    addedAt: 1,
    ...overrides,
  } as BookRecord;
}

describe("mergeBook", () => {
  it("takes the incoming record when there is no local copy", () => {
    const incoming = book({ title: "New" });
    expect(mergeBook(undefined, incoming)).toBe(incoming);
  });

  it("lets the newer progress stamp win", () => {
    const prev = book({ progress: { fraction: 0.1, updatedAt: 100 } as never });
    const incoming = book({ progress: { fraction: 0.6, updatedAt: 200 } as never });
    expect(mergeBook(prev, incoming).progress?.fraction).toBe(0.6);
  });

  it("keeps the local record when the backup is older", () => {
    const prev = book({ progress: { fraction: 0.9, updatedAt: 500 } as never });
    const incoming = book({ progress: { fraction: 0.2, updatedAt: 100 } as never });
    expect(mergeBook(prev, incoming).progress?.fraction).toBe(0.9);
  });

  it("unions tags from both sides", () => {
    const merged = mergeBook(book({ tags: ["a"] }), book({ tags: ["b"] }));
    expect(merged.tags).toEqual(["a", "b"]);
  });
});

describe("mergeAnnotation", () => {
  it("prefers the newer updatedAt", () => {
    const prev = { id: "x", updatedAt: 1, note: "old" };
    const next = { id: "x", updatedAt: 2, note: "new" };
    expect(mergeAnnotation(prev, next).note).toBe("new");
    expect(mergeAnnotation(next, prev).note).toBe("new");
  });
});

describe("mergeCollection", () => {
  it("unions membership", () => {
    const base: Collection = {
      id: "c",
      name: "One",
      color: "#000",
      order: 0,
      bookIds: ["a"],
    };
    const merged = mergeCollection(base, { ...base, name: "Two", bookIds: ["b", "a"] });
    expect(merged.name).toBe("Two");
    expect(merged.bookIds.sort()).toEqual(["a", "b"]);
  });
});

describe("backupFileName", () => {
  it("stamps the date", () => {
    expect(backupFileName(new Date("2026-03-10T00:00:00Z"))).toBe("eviota-2026-03-10.eviota.zip");
  });
});
