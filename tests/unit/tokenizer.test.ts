import { describe, expect, it } from "vitest";
import { emptyIndex, indexPages, tokenize } from "@/workers/search-index.worker";

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumerics", () => {
    expect(tokenize("The Quick, brown-fox!")).toEqual(["the", "quick", "brown", "fox"]);
  });

  it("drops single-character tokens", () => {
    expect(tokenize("a bee c dee")).toEqual(["bee", "dee"]);
  });

  it("strips diacritics so 'cafe' finds 'café'", () => {
    expect(tokenize("Café Crème")).toEqual(["cafe", "creme"]);
  });

  it("keeps digits and mixed alphanumerics", () => {
    expect(tokenize("Chapter 12 — ISO8859")).toEqual(["chapter", "12", "iso8859"]);
  });

  it("handles non-Latin scripts as tokens", () => {
    expect(tokenize("日本語 テスト")).toEqual(["日本語", "テスト"]);
  });

  it("returns nothing for punctuation-only input", () => {
    expect(tokenize("… —!?")).toEqual([]);
  });
});

describe("indexPages", () => {
  it("builds an inverted index with sorted, unique postings", () => {
    const index = indexPages(emptyIndex(), [
      { page: 1, text: "the fox runs" },
      { page: 3, text: "the fox sleeps" },
      { page: 2, text: "nothing here" },
    ]);
    expect(index.terms["fox"]).toEqual([1, 3]);
    expect(index.terms["the"]).toEqual([1, 3]);
    expect(index.pageCount).toBe(3);
  });

  it("replaces a page instead of appending duplicates", () => {
    const index = indexPages(emptyIndex(), [{ page: 1, text: "alpha beta" }]);
    indexPages(index, [{ page: 1, text: "gamma" }]);
    expect(index.terms["alpha"]).toBeUndefined();
    expect(index.terms["gamma"]).toEqual([1]);
    expect(index.pages[1]).toBe("gamma");
  });

  it("keeps note text searchable alongside page text", () => {
    const index = indexPages(emptyIndex(), [{ page: 1, text: "page body" }]);
    indexPages(index, [{ page: 1, text: "my annotation" }], "notes");
    expect(index.terms["annotation"]).toEqual([1]);
    expect(index.terms["body"]).toEqual([1]);
    expect(index.pages[1]).toBe("page body");
    expect(index.notes[1]).toBe("my annotation");
  });

  it("preserves exact casing of the stored page text for snippets", () => {
    const index = indexPages(emptyIndex(), [{ page: 1, text: "The Raven" }]);
    expect(index.pages[1]).toBe("The Raven");
  });
});
