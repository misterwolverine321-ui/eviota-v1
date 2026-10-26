import { describe, expect, it } from "vitest";
import { afterDelete, afterMove, remapAnchors, samePages } from "@/lib/pdf-ops";
import type { Annotation } from "@/lib/annotations";

const rectAnn = (id: string, page: number, orphaned?: boolean): Annotation => ({
  id,
  bookId: "b",
  anchor: { kind: "rect", page, rects: [{ x: 0, y: 0, w: 1, h: 0.1 }] },
  type: "highlight",
  color: "yellow",
  ...(orphaned ? { orphaned: true } : {}),
});

const cfiAnn = (id: string): Annotation => ({
  id,
  bookId: "b",
  anchor: { kind: "cfi", cfi: "epubcfi(/6/4!/4/2)" },
  type: "highlight",
  color: "yellow",
});

describe("samePages", () => {
  it("is the identity mapper", () => {
    expect([1, 2, 9].map(samePages)).toEqual([1, 2, 9]);
  });
});

describe("afterDelete", () => {
  it("drops the deleted page and shifts later pages down", () => {
    const map = afterDelete([3]);
    expect(map(1)).toBe(1);
    expect(map(2)).toBe(2);
    expect(map(3)).toBeNull();
    expect(map(4)).toBe(3);
    expect(map(10)).toBe(9);
  });

  it("handles multiple deletions, including duplicates", () => {
    const map = afterDelete([2, 5, 5]);
    expect(map(1)).toBe(1);
    expect(map(2)).toBeNull();
    expect(map(3)).toBe(2);
    expect(map(5)).toBeNull();
    expect(map(6)).toBe(4);
  });
});

describe("afterMove", () => {
  it("moves a page forward and shifts the span back", () => {
    const map = afterMove(2, 5);
    expect(map(2)).toBe(5);
    expect(map(3)).toBe(2);
    expect(map(5)).toBe(4);
    expect(map(6)).toBe(6);
    expect(map(1)).toBe(1);
  });

  it("moves a page backward and shifts the span forward", () => {
    const map = afterMove(5, 2);
    expect(map(5)).toBe(2);
    expect(map(2)).toBe(3);
    expect(map(4)).toBe(5);
    expect(map(6)).toBe(6);
    expect(map(1)).toBe(1);
  });

  it("is a no-op when from === to", () => {
    const map = afterMove(3, 3);
    expect([1, 3, 7].map(map)).toEqual([1, 3, 7]);
  });

  it("round-trips a move and its inverse", () => {
    const fwd = afterMove(2, 5);
    const back = afterMove(5, 2);
    for (const p of [1, 2, 3, 4, 5, 6]) expect(back(fwd(p)!)).toBe(p);
  });
});

describe("remapAnchors", () => {
  it("ignores CFI anchors entirely", () => {
    expect(remapAnchors([cfiAnn("c1")], afterDelete([1]))).toEqual([]);
  });

  it("emits patches only for pages that actually shifted", () => {
    const patches = remapAnchors([rectAnn("a", 1), rectAnn("b", 4)], afterDelete([3]));
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe("b");
    expect(patches[0].patch.anchor).toMatchObject({ kind: "rect", page: 3 });
  });

  it("preserves the rest of the anchor when remapping", () => {
    const [patch] = remapAnchors([rectAnn("a", 4)], afterDelete([1]));
    expect(patch.patch.anchor).toEqual({
      kind: "rect",
      page: 3,
      rects: [{ x: 0, y: 0, w: 1, h: 0.1 }],
    });
  });

  it("flags anchors whose page was deleted as orphaned", () => {
    const patches = remapAnchors([rectAnn("a", 3)], afterDelete([3]));
    expect(patches).toEqual([{ id: "a", patch: { orphaned: true } }]);
  });

  it("does not re-flag an already orphaned annotation", () => {
    expect(remapAnchors([rectAnn("a", 3, true)], afterDelete([3]))).toEqual([]);
  });

  it("returns no patches for a rotation", () => {
    expect(remapAnchors([rectAnn("a", 2), rectAnn("b", 7)], samePages)).toEqual([]);
  });

  it("remaps a move across several annotations", () => {
    const patches = remapAnchors(
      [rectAnn("a", 2), rectAnn("b", 3), rectAnn("c", 6)],
      afterMove(2, 5),
    );
    expect(patches.map((p) => [p.id, (p.patch.anchor as { page: number }).page])).toEqual([
      ["a", 5],
      ["b", 2],
    ]);
  });
});
