import { describe, expect, it } from "vitest";
import {
  appendPages,
  candidatePages,
  deletePage,
  emptyIndex,
  indexPages,
  movePage,
  type IndexShape,
} from "@/workers/search-index.worker";

/** Four pages, each with a unique marker token plus a shared one. */
function fixture(): IndexShape {
  return indexPages(emptyIndex(), [
    { page: 1, text: "shared alpha" },
    { page: 2, text: "shared bravo" },
    { page: 3, text: "shared charlie" },
    { page: 4, text: "shared delta" },
  ]);
}

describe("movePage", () => {
  it("moves a page forward and renumbers everything after it", () => {
    const index = movePage(fixture(), 1, 3);
    // order becomes bravo, charlie, alpha, delta
    expect(index.terms["alpha"]).toEqual([3]);
    expect(index.terms["bravo"]).toEqual([1]);
    expect(index.terms["charlie"]).toEqual([2]);
    expect(index.terms["delta"]).toEqual([4]);
    expect(index.pages[3]).toBe("shared alpha");
    expect(index.terms["shared"]).toEqual([1, 2, 3, 4]);
  });

  it("moves a page backward", () => {
    const index = movePage(fixture(), 4, 1);
    expect(index.terms["delta"]).toEqual([1]);
    expect(index.terms["alpha"]).toEqual([2]);
    expect(index.pages[1]).toBe("shared delta");
  });

  it("is a no-op when from === to", () => {
    const index = movePage(fixture(), 2, 2);
    expect(index.terms["bravo"]).toEqual([2]);
  });

  it("keeps note text attached to the page it moved with", () => {
    const index = fixture();
    indexPages(index, [{ page: 2, text: "my note" }], "notes");
    movePage(index, 2, 4);
    expect(index.notes[4]).toBe("my note");
    expect(index.terms["note"]).toEqual([4]);
  });

  it("survives a round trip", () => {
    const index = movePage(movePage(fixture(), 1, 4), 4, 1);
    expect(index.terms["alpha"]).toEqual([1]);
    expect(index.terms["delta"]).toEqual([4]);
  });
});

describe("deletePage", () => {
  it("drops the page's postings and shifts the tail down", () => {
    const index = deletePage(fixture(), 2);
    expect(index.terms["bravo"]).toBeUndefined();
    expect(index.terms["charlie"]).toEqual([2]);
    expect(index.terms["delta"]).toEqual([3]);
    expect(index.terms["shared"]).toEqual([1, 2, 3]);
    expect(index.pageCount).toBe(3);
    expect(index.pages[4]).toBeUndefined();
  });

  it("deleting the last page leaves earlier pages untouched", () => {
    const index = deletePage(fixture(), 4);
    expect(index.pageCount).toBe(3);
    expect(index.terms["alpha"]).toEqual([1]);
    expect(index.terms["delta"]).toBeUndefined();
  });

  it("removes a term entirely when its last posting goes away", () => {
    const index = deletePage(deletePage(fixture(), 1), 1);
    expect(index.terms["alpha"]).toBeUndefined();
    expect(index.terms["bravo"]).toBeUndefined();
    expect(index.terms["shared"]).toEqual([1, 2]);
  });
});

describe("appendPages", () => {
  it("reserves slots without inventing postings", () => {
    const index = appendPages(fixture(), 3);
    expect(index.pageCount).toBe(7);
    expect(index.terms["shared"]).toEqual([1, 2, 3, 4]);
    expect(index.pages[5]).toBeUndefined();
  });

  it("indexes the reserved slots once their text arrives", () => {
    const index = appendPages(fixture(), 1);
    indexPages(index, [{ page: 5, text: "echo" }]);
    expect(index.terms["echo"]).toEqual([5]);
    expect(index.pageCount).toBe(5);
  });
});

describe("candidatePages", () => {
  it("intersects postings across query tokens", () => {
    const index = fixture();
    expect(candidatePages(index, "shared charlie", false)).toEqual([3]);
    expect(candidatePages(index, "alpha delta", false)).toEqual([]);
  });

  it("prefix-scans a partial token unless wholeWord is set", () => {
    const index = fixture();
    expect(candidatePages(index, "char", false)).toEqual([3]);
    expect(candidatePages(index, "char", true)).toEqual([]);
    expect(candidatePages(index, "charlie", true)).toEqual([3]);
  });

  it("returns nothing for an empty query", () => {
    expect(candidatePages(fixture(), "  ", false)).toEqual([]);
  });

  it("still resolves correctly after an incremental edit", () => {
    const index = movePage(fixture(), 3, 1);
    expect(candidatePages(index, "charlie", false)).toEqual([1]);
    deletePage(index, 1);
    expect(candidatePages(index, "charlie", false)).toEqual([]);
  });
});
