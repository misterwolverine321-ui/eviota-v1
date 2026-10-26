import { describe, expect, it } from "vitest";
import { missingSamples, shelfState } from "@/lib/first-run";
import { SAMPLE_BOOKS } from "@/lib/samples";

describe("missingSamples", () => {
  it("returns every sample on an empty shelf", () => {
    expect(missingSamples([], SAMPLE_BOOKS)).toHaveLength(SAMPLE_BOOKS.length);
  });

  it("skips samples already imported, ignoring case", () => {
    const books = [{ fileName: SAMPLE_BOOKS[0].fileName.toUpperCase() }];
    const out = missingSamples(books, SAMPLE_BOOKS);
    expect(out).toHaveLength(SAMPLE_BOOKS.length - 1);
    expect(out.map((s) => s.fileName)).not.toContain(SAMPLE_BOOKS[0].fileName);
  });

  it("returns nothing once all samples are present", () => {
    expect(missingSamples(SAMPLE_BOOKS, SAMPLE_BOOKS)).toEqual([]);
  });
});

describe("shelfState", () => {
  it("is loading until the first read finishes", () => {
    expect(shelfState({ loaded: false, total: 0, visible: 0, pending: 0 })).toBe("loading");
  });
  it("is empty with no books at all", () => {
    expect(shelfState({ loaded: true, total: 0, visible: 0, pending: 0 })).toBe("empty");
  });
  it("is filtered-empty when filters hide every book", () => {
    expect(shelfState({ loaded: true, total: 4, visible: 0, pending: 0 })).toBe("filtered-empty");
  });
  it("is ready while imports are pending", () => {
    expect(shelfState({ loaded: true, total: 0, visible: 0, pending: 2 })).toBe("ready");
  });
});
