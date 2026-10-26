import { describe, expect, it } from "vitest";
import {
  MAX_DPI,
  MAX_PAGE_PIXELS,
  MIN_DPI,
  dpiForWidth,
  fitPage,
  hasTextLayer,
  normalizeDjvuText,
  renderWidth,
  renderWindow,
} from "@/lib/djvu";

describe("renderWindow", () => {
  it("keeps the current page plus one neighbour on each side", () => {
    expect(renderWindow(5, 10)).toEqual([4, 5, 6]);
  });

  it("clamps at the document edges", () => {
    expect(renderWindow(1, 10)).toEqual([1, 2]);
    expect(renderWindow(10, 10)).toEqual([9, 10]);
    expect(renderWindow(99, 3)).toEqual([2, 3]);
  });

  it("honours a wider radius and degenerate documents", () => {
    expect(renderWindow(3, 6, 2)).toEqual([1, 2, 3, 4, 5]);
    expect(renderWindow(1, 1, 0)).toEqual([1]);
    expect(renderWindow(1, 0)).toEqual([]);
  });
});

describe("normalizeDjvuText", () => {
  it("joins hyphenated line breaks and collapses whitespace", () => {
    expect(normalizeDjvuText("hyphen-\nated  word\r\nnext   line")).toBe(
      "hyphenated word next line",
    );
  });

  it("treats the text layer's zone separators as breaks, not as text", () => {
    // Read from the first page of a real file (a 1973 State Department cable): zones are
    // separated by 0x1F, 0x1D and 0x0B, and the text ends with 0x0B 0x0B 0x00.
    const raw =
      "Declassified US Department of State \n\u001f\u001d\u000bMessage Text \n\u001fMRN: 1974STATE 218189 \n\u001f\u001d\u000b\u000b\u0000";
    const out = normalizeDjvuText(raw);
    expect(out).toBe("Declassified US Department of State Message Text MRN: 1974STATE 218189");
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f]/.test(out)).toBe(false);
    // A separator in the middle of a hyphenated word still joins it.
    expect(normalizeDjvuText("inter-\u001fnational")).toBe("international");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeDjvuText("")).toBe("");
    expect(normalizeDjvuText("   \n  ")).toBe("");
  });
});

describe("hasTextLayer", () => {
  it("accepts real prose", () => {
    expect(hasTextLayer("The quick brown fox jumps")).toBe(true);
  });

  it("rejects empty or noise-only text layers", () => {
    expect(hasTextLayer("")).toBe(false);
    expect(hasTextLayer("  .  ")).toBe(false);
    expect(hasTextLayer("1 2 3 4 5 6 7 8 9")).toBe(false);
  });
});

describe("dpiForWidth", () => {
  it("scales the page's own resolution to the width asked for", () => {
    // A real page: 2550 x 3301 pixels at its own 300 dpi, which the decoder reports as 850 pixels
    // wide at 100 dpi.
    expect(dpiForWidth(300, 2550, 3301, 850)).toBeCloseTo(100, 6);
    expect(dpiForWidth(300, 2550, 3301, 1275)).toBeCloseTo(150, 6);
    // Another real page: 764 x 1112 at 129 dpi.
    expect(dpiForWidth(129, 764, 1112, 382)).toBeCloseTo(64.5, 6);
  });

  it("never asks for more pixels than a page may have, nor for an absurd resolution", () => {
    const dpi = dpiForWidth(300, 2550, 3301, 10_000);
    const pixels = ((2550 * dpi) / 300) * ((3301 * dpi) / 300);
    expect(pixels).toBeLessThanOrEqual(MAX_PAGE_PIXELS * 1.001);
    expect(dpi).toBeLessThanOrEqual(MAX_DPI);
    expect(dpiForWidth(300, 2550, 3301, 1)).toBe(MIN_DPI);
    expect(dpiForWidth(50, 100, 100, 100_000)).toBeLessThanOrEqual(MAX_DPI);
  });

  it("falls back to the page's own resolution when it is told nothing usable", () => {
    expect(dpiForWidth(300, 0, 3301, 850)).toBe(300);
    expect(dpiForWidth(300, 2550, 3301, 0)).toBe(300);
    expect(dpiForWidth(Number.NaN, 2550, 3301, 0)).toBe(300);
    expect(dpiForWidth(0, 0, 0, 100)).toBe(300);
  });
});

describe("fitPage", () => {
  it("fits one page inside the surface minus the padding, keeping its shape", () => {
    // 800 x 600 surface, a page 0.7 as wide as it is tall: the height decides.
    expect(fitPage(0.7, { w: 800, h: 600 })).toEqual({ w: 403, h: 575 });
  });

  it("splits the width between the pages of a spread", () => {
    // (800 - 24 - 6) / 2 = 385 wide each, narrower than the height allows.
    expect(fitPage(0.7, { w: 800, h: 600 }, 2)).toEqual({ w: 385, h: 550 });
  });

  it("lets the width decide on a narrow surface and never returns less than a pixel", () => {
    expect(fitPage(0.7, { w: 300, h: 900 })).toEqual({ w: 276, h: 394 });
    expect(fitPage(0.7, { w: 0, h: 0 })).toEqual({ w: 1, h: 1 });
  });

  it("uses a portrait shape for an aspect it cannot trust", () => {
    expect(fitPage(Number.NaN, { w: 800, h: 600 })).toEqual(fitPage(0.7, { w: 800, h: 600 }));
    expect(fitPage(-2, { w: 800, h: 600 })).toEqual(fitPage(0.7, { w: 800, h: 600 }));
  });
});

describe("renderWidth", () => {
  it("rounds the pixel width up to a multiple of 64", () => {
    expect(renderWidth(478, 2)).toBe(960);
    expect(renderWidth(400, 1)).toBe(448);
  });

  it("keeps small changes of the window from drawing every page again", () => {
    expect(renderWidth(441, 2)).toBe(renderWidth(447, 2));
  });

  it("stays between 256 and 3200 pixels, and copes with bad input", () => {
    expect(renderWidth(0, 1)).toBe(256);
    expect(renderWidth(5000, 2)).toBe(3200);
    expect(renderWidth(500, Number.NaN)).toBe(512);
    expect(renderWidth(-10, 2)).toBe(256);
  });
});
