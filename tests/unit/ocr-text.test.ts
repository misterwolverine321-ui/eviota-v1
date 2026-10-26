import { describe, expect, it } from "vitest";
import {
  OCR_MIN_LONG_SIDE,
  OCR_TARGET_LONG_SIDE,
  isNoiseLine,
  normalizeOcrText,
  ocrScale,
  ocrSourceRect,
} from "@/workers/ocr.worker";

describe("ocrScale", () => {
  it("leaves in-range pages untouched", () => {
    expect(ocrScale(1200, 1600)).toBe(1);
    expect(ocrScale(OCR_MIN_LONG_SIDE, 600)).toBe(1);
    expect(ocrScale(OCR_TARGET_LONG_SIDE, 100)).toBe(1);
  });

  it("shrinks oversized scans to the target long side", () => {
    expect(ocrScale(3600, 1800)).toBeCloseTo(OCR_TARGET_LONG_SIDE / 3600);
  });

  it("upscales tiny scans, capped at 2x", () => {
    expect(ocrScale(600, 300)).toBeCloseTo(OCR_MIN_LONG_SIDE / 600);
    expect(ocrScale(400, 300)).toBe(2); // ratio exceeds the 2x cap
  });

  it("falls back to 1 for degenerate dimensions", () => {
    expect(ocrScale(0, 0)).toBe(1);
    expect(ocrScale(Number.NaN, 10)).toBe(1);
    expect(ocrScale(-5, -9)).toBe(1);
  });
});

describe("ocrSourceRect", () => {
  it("returns the full page without a part", () => {
    expect(ocrSourceRect(2000, 1000)).toEqual({ sx: 0, sy: 0, sw: 2000, sh: 1000 });
  });

  it("splits an even spread into left and right halves", () => {
    expect(ocrSourceRect(2000, 1000, "l")).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 1000 });
    expect(ocrSourceRect(2000, 1000, "r")).toEqual({ sx: 1000, sy: 0, sw: 1000, sh: 1000 });
  });

  it("gives the odd column to the right half", () => {
    expect(ocrSourceRect(2001, 1000, "l").sw).toBe(1000);
    expect(ocrSourceRect(2001, 1000, "r")).toEqual({ sx: 1000, sy: 0, sw: 1001, sh: 1000 });
  });
});

describe("isNoiseLine", () => {
  it("rejects empty and whitespace-only lines", () => {
    expect(isNoiseLine("")).toBe(true);
    expect(isNoiseLine("   ")).toBe(true);
  });

  it("rejects punctuation-only artifacts", () => {
    expect(isNoiseLine("—–—")).toBe(true);
    expect(isNoiseLine("| . , |")).toBe(true);
  });

  it("rejects lines that are mostly non-alphanumeric", () => {
    expect(isNoiseLine("a|||***")).toBe(true);
  });

  it("keeps dialogue, even short lines", () => {
    expect(isNoiseLine("NO!")).toBe(false);
    expect(isNoiseLine("What?")).toBe(false);
    expect(isNoiseLine("… . … . …")).toBe(true); // mostly dots
    expect(isNoiseLine("POW")).toBe(false);
  });
});

describe("normalizeOcrText", () => {
  it("drops noise lines and control characters", () => {
    const raw = "HEY KID\n| . |\n  \nWATCH OUT";
    expect(normalizeOcrText(raw)).toBe("HEY KID WATCH OUT");
  });

  it("rejoins words hyphenated across a line break", () => {
    expect(normalizeOcrText("conti-\nnued")).toBe("continued");
    expect(normalizeOcrText("SOME-\nTHING")).not.toBe("SOMETHING"); // only lowercase continuation rejoins
  });

  it("does not rejoin a hyphen that ends a real phrase", () => {
    expect(normalizeOcrText("well-\nKNOWN")).toBe("well- KNOWN");
  });

  it("normalizes CRLF and collapses whitespace runs", () => {
    expect(normalizeOcrText("a\r\nb\r\n\r\nc   d")).toBe("a b c d");
  });

  it("preserves casing for snippets", () => {
    expect(normalizeOcrText("The QUICK Brown FOX")).toBe("The QUICK Brown FOX");
  });

  it("returns an empty string for pure noise", () => {
    expect(normalizeOcrText("|||\n---\n   ")).toBe("");
  });
});
