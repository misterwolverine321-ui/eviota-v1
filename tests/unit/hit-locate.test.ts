// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  confirmMatchStart,
  HIT_HIGHLIGHT,
  isTallBlock,
  occurrenceBefore,
  paintHit,
  rangeInBlock,
  spansForOccurrence,
} from "@/lib/hit-locate";

describe("confirmMatchStart", () => {
  const text = "the quick brown fox jumps over the lazy dog";

  it("trusts the offset when the text there is the match, whatever its case", () => {
    expect(confirmMatchStart(text, 4, "Quick")).toBe(4);
    expect(confirmMatchStart(text, 35, "LAZY")).toBe(35);
  });

  it("falls back to the nearest occurrence when the text has shifted", () => {
    expect(confirmMatchStart(text, 0, "fox")).toBe(16);
    // An offset a little past the match (the text lost a few characters) still finds it.
    expect(confirmMatchStart(text, 30, "fox")).toBe(16);
  });

  it("answers -1 when the match is not there", () => {
    expect(confirmMatchStart(text, 4, "zebra")).toBe(-1);
    expect(confirmMatchStart(text, 4, "")).toBe(-1);
  });
});

describe("rangeInBlock", () => {
  it("covers the match across inline markup", () => {
    document.body.innerHTML = "<p id='b'>Call me <b>Ish</b>mael. Some years ago</p>";
    const block = document.getElementById("b")!;
    const range = rangeInBlock(block, 8, "Ishmael")!;
    expect(range.toString()).toBe("Ishmael");
  });

  it("finds the match when the offset is a little off", () => {
    document.body.innerHTML = "<p id='b'>one two three four</p>";
    const block = document.getElementById("b")!;
    expect(rangeInBlock(block, 9, "three")!.toString()).toBe("three");
  });

  it("is null when the block no longer holds the match", () => {
    document.body.innerHTML = "<p id='b'>one two three</p>";
    expect(rangeInBlock(document.getElementById("b")!, 0, "zebra")).toBeNull();
  });
});

describe("occurrenceBefore", () => {
  it("counts the appearances of the phrase before the offset", () => {
    const text = "cat dog cat bird cat";
    expect(occurrenceBefore(text, "cat", 0)).toBe(0);
    expect(occurrenceBefore(text, "cat", 8)).toBe(1);
    expect(occurrenceBefore(text, "cat", 17)).toBe(2);
  });

  it("counts overlapping candidates, as the search lists them", () => {
    expect(occurrenceBefore("aaaa", "aa", 2)).toBe(2);
  });
});

describe("spansForOccurrence", () => {
  it("names the pieces that hold the n-th appearance", () => {
    const pieces = ["The cat", " sat on the", "cat", " mat"];
    expect(spansForOccurrence(pieces, "cat", 0)).toEqual([0]);
    expect(spansForOccurrence(pieces, "cat", 1)).toEqual([2]);
  });

  it("names every piece a phrase runs across", () => {
    const pieces = ["The quick", "brown", "fox"];
    expect(spansForOccurrence(pieces, "quick brown", 0)).toEqual([0, 1]);
    expect(spansForOccurrence(pieces, "brown fox", 0)).toEqual([1, 2]);
  });

  it("joins pieces as the index text is made, so spacing between pieces does not matter", () => {
    expect(spansForOccurrence(["a  b ", "  c"], "b c", 0)).toEqual([0, 1]);
  });

  it("uses the last appearance when the page shows fewer than the index counted", () => {
    expect(spansForOccurrence(["cat", "dog"], "cat", 5)).toEqual([0]);
  });

  it("is empty when the phrase is not on the page", () => {
    expect(spansForOccurrence(["cat", "dog"], "bird", 0)).toEqual([]);
    expect(spansForOccurrence(["cat"], "", 0)).toEqual([]);
  });

  it("keeps characters outside the basic plane aligned with their pieces", () => {
    expect(spansForOccurrence(["😀 x", "target"], "target", 0)).toEqual([1]);
    // A character outside the basic plane is two units of text and must be two owners: counted as
    // one, every owner after it is one place early and a match at the end of a piece takes in the
    // next piece.
    expect(spansForOccurrence(["😀 target", "next"], "target", 0)).toEqual([0]);
  });
});

describe("isTallBlock", () => {
  it("is true for a block taller than most of the window", () => {
    expect(isTallBlock(900, 800)).toBe(true);
    expect(isTallBlock(641, 800)).toBe(true);
    expect(isTallBlock(300, 800)).toBe(false);
    expect(isTallBlock(900, 0)).toBe(false);
  });
});

describe("paintHit", () => {
  it("registers the range under the highlight name and removes it", () => {
    const registry = new Map<string, unknown>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    const win = document.defaultView as unknown as Record<string, unknown>;
    win.CSS = { highlights: registry };
    win.Highlight = FakeHighlight;
    document.body.innerHTML = "<p id='b'>hello world</p>";
    const range = rangeInBlock(document.getElementById("b")!, 6, "world")!;
    paintHit(document, range);
    expect(registry.has(HIT_HIGHLIGHT)).toBe(true);
    paintHit(document, null);
    expect(registry.has(HIT_HIGHLIGHT)).toBe(false);
    delete win.CSS;
    delete win.Highlight;
  });

  it("does nothing, and does not throw, where the browser has no highlight API", () => {
    expect(() => paintHit(document, null)).not.toThrow();
  });
});
