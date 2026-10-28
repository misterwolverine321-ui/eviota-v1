import { describe, expect, it } from "vitest";
import { isPlainClick, markAt } from "@/lib/mark-hit";

/**
 * In a PDF the text layer covers the whole page above the highlight overlay,
 * so a click never reaches a highlight's own element (found in Chromium). The reader finds the
 * mark under the pointer by geometry
 * instead; rects are fractions of the page box.
 */
const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("markAt", () => {
  const marks = [
    { id: "a", rects: [box(0.1, 0.1, 0.4, 0.05), box(0.1, 0.16, 0.2, 0.05)] },
    { id: "b", rects: [box(0.6, 0.5, 0.2, 0.1)] },
  ];

  it("finds the mark whose rectangle holds the point, and returns that rectangle", () => {
    expect(markAt(marks, 0.2, 0.12)).toEqual({ id: "a", rect: box(0.1, 0.1, 0.4, 0.05) });
    expect(markAt(marks, 0.15, 0.18)).toEqual({ id: "a", rect: box(0.1, 0.16, 0.2, 0.05) });
    expect(markAt(marks, 0.7, 0.55)?.id).toBe("b");
  });

  it("returns null between marks, outside every rectangle, and for no marks", () => {
    expect(markAt(marks, 0.4, 0.18)).toBeNull(); // right of the short second line of "a"
    expect(markAt(marks, 0.05, 0.12)).toBeNull();
    expect(markAt(marks, 0.2, 0.9)).toBeNull();
    expect(markAt([], 0.2, 0.12)).toBeNull();
  });

  it("counts the edges as inside, so a click on the border still selects", () => {
    expect(markAt(marks, 0.1, 0.1)?.id).toBe("a");
    expect(markAt(marks, 0.5, 0.15)?.id).toBe("a");
  });

  it("prefers the mark drawn last where two overlap (it is the one on top)", () => {
    const overlap = [
      { id: "under", rects: [box(0.1, 0.1, 0.5, 0.1)] },
      { id: "over", rects: [box(0.3, 0.1, 0.5, 0.1)] },
    ];
    expect(markAt(overlap, 0.4, 0.15)?.id).toBe("over");
    expect(markAt(overlap, 0.15, 0.15)?.id).toBe("under");
  });
});

describe("isPlainClick", () => {
  const at = (x: number, y: number, detail = 1) => ({ x, y, detail });

  it("accepts a single click that did not move, and one that wobbled a few pixels", () => {
    expect(isPlainClick(at(100, 100), { x: 100, y: 100 })).toBe(true);
    expect(isPlainClick(at(103, 102), { x: 100, y: 100 })).toBe(true);
  });

  it("rejects the click that ends a drag", () => {
    expect(isPlainClick(at(160, 100), { x: 100, y: 100 })).toBe(false);
    expect(isPlainClick(at(100, 130), { x: 100, y: 100 })).toBe(false);
  });

  it("rejects the second and third click of a double or triple click", () => {
    expect(isPlainClick(at(100, 100, 2), { x: 100, y: 100 })).toBe(false);
    expect(isPlainClick(at(100, 100, 3), { x: 100, y: 100 })).toBe(false);
  });

  it("accepts a click when the pointer-down position is not known", () => {
    expect(isPlainClick(at(100, 100), null)).toBe(true);
  });
});
