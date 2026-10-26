import { describe, expect, it } from "vitest";
import {
  allTags,
  bookStatus,
  collectionBooks,
  filterBooks,
  isSmartCollection,
  normalizeTags,
} from "@/lib/collections";
import type { Collection } from "@/lib/collections";
import type { BookRecord } from "@/lib/db";

function book(id: string, tags: string[] = []): BookRecord {
  return {
    id,
    title: id,
    author: "A",
    format: "epub",
    size: 1,
    addedAt: 0,
    tags,
  } as BookRecord;
}

describe("normalizeTags", () => {
  it("trims, collapses whitespace, dedupes case-insensitively and sorts", () => {
    expect(normalizeTags([" sci  fi ", "Sci Fi", "", "art"])).toEqual(["art", "sci fi"]);
  });
});

describe("allTags", () => {
  it("collects unique tags across the shelf", () => {
    expect(allTags([book("a", ["Essays"]), book("b", ["essays", "Poetry"])])).toEqual([
      "Essays",
      "Poetry",
    ]);
  });
});

describe("filterBooks", () => {
  const books = [book("a", ["Essays"]), book("b", ["Essays", "Poetry"]), book("c")];
  const collection: Collection = {
    id: "c1",
    name: "Shelf",
    color: "#000",
    order: 0,
    bookIds: ["a", "c"],
  };

  it("passes everything through with no filter", () => {
    expect(filterBooks(books, {})).toHaveLength(3);
  });

  it("scopes to a collection", () => {
    expect(filterBooks(books, { collection }).map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("requires every selected tag", () => {
    expect(filterBooks(books, { tags: ["essays", "poetry"] }).map((b) => b.id)).toEqual(["b"]);
  });

  it("combines collection and tags", () => {
    expect(filterBooks(books, { collection, tags: ["Essays"] }).map((b) => b.id)).toEqual(["a"]);
  });
});

function progressed(id: string, fraction: number, lastOpenedAt?: number): BookRecord {
  return {
    ...book(id),
    progress: { kind: "fraction", fraction, updatedAt: 0 },
    lastOpenedAt,
  } as BookRecord;
}

describe("bookStatus", () => {
  it("is unread with no progress and no open", () => {
    expect(bookStatus(book("a"))).toBe("unread");
  });

  it("is reading once opened even with zero progress", () => {
    expect(bookStatus({ ...book("a"), lastOpenedAt: 5 } as BookRecord)).toBe("reading");
  });

  it("is reading part-way through", () => {
    expect(bookStatus(progressed("a", 0.42))).toBe("reading");
  });

  it("is finished at the tail of the book", () => {
    expect(bookStatus(progressed("a", 0.99))).toBe("finished");
    expect(bookStatus(progressed("a", 1))).toBe("finished");
  });
});

describe("smart collections", () => {
  const shelf = [
    progressed("a", 1),
    progressed("b", 0.3),
    { ...book("c", ["Poetry"]), format: "pdf" } as BookRecord,
  ];
  const smart: Collection = {
    id: "s1",
    name: "Finished",
    color: "#000",
    order: 0,
    bookIds: [],
    rule: { status: "finished" },
  };

  it("recognises a rule-backed collection", () => {
    expect(isSmartCollection(smart)).toBe(true);
    expect(isSmartCollection({ ...smart, rule: null })).toBe(false);
  });

  it("computes membership from the rule, ignoring bookIds", () => {
    expect(collectionBooks(smart, shelf).map((b) => b.id)).toEqual(["a"]);
    expect(collectionBooks({ ...smart, bookIds: ["b", "c"] }, shelf).map((b) => b.id)).toEqual([
      "a",
    ]);
  });

  it("ANDs format and tag rules", () => {
    const rule: Collection = {
      ...smart,
      rule: { format: "pdf", tag: "poetry" },
    };
    expect(collectionBooks(rule, shelf).map((b) => b.id)).toEqual(["c"]);
    expect(
      collectionBooks({ ...rule, rule: { format: "epub", tag: "poetry" } }, shelf),
    ).toHaveLength(0);
  });

  it("still uses bookIds for a plain collection", () => {
    const plain: Collection = { ...smart, rule: null, bookIds: ["b"] };
    expect(collectionBooks(plain, shelf).map((b) => b.id)).toEqual(["b"]);
  });

  it("filters by status and scopes to a smart collection", () => {
    expect(filterBooks(shelf, { status: "reading" }).map((b) => b.id)).toEqual(["b"]);
    expect(filterBooks(shelf, { status: "unread" }).map((b) => b.id)).toEqual(["c"]);
    expect(filterBooks(shelf, { collection: smart }).map((b) => b.id)).toEqual(["a"]);
    expect(filterBooks(shelf, { collection: smart, status: "reading" })).toHaveLength(0);
  });
});
