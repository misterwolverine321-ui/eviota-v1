import { describe, expect, it } from "vitest";
import { backgroundLevel, detectPanels, orderPanels, panelView } from "@/lib/guided-view";

/** Paint a white page with dark filled rects (in pixel coords). */
function page(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number }[],
) {
  const gray = new Uint8Array(width * height).fill(250);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) gray[y * width + x] = 30;
    }
  }
  return gray;
}

describe("detectPanels", () => {
  it("finds a 2x2 grid of panels separated by gutters", () => {
    const w = 400;
    const h = 600;
    const gray = page(w, h, [
      { x: 20, y: 20, w: 170, h: 270 },
      { x: 210, y: 20, w: 170, h: 270 },
      { x: 20, y: 310, w: 170, h: 270 },
      { x: 210, y: 310, w: 170, h: 270 },
    ]);
    const panels = detectPanels(gray, w, h);
    expect(panels).toHaveLength(4);
    for (const p of panels) {
      expect(p.w).toBeGreaterThan(0.3);
      expect(p.w).toBeLessThan(0.55);
      expect(p.h).toBeLessThan(0.55);
    }
  });

  it("finds three stacked strips", () => {
    const w = 300;
    const h = 900;
    const gray = page(w, h, [
      { x: 10, y: 10, w: 280, h: 270 },
      { x: 10, y: 310, w: 280, h: 270 },
      { x: 10, y: 610, w: 280, h: 270 },
    ]);
    const panels = detectPanels(gray, w, h);
    expect(panels).toHaveLength(3);
    expect(panels.every((p) => p.w > 0.8)).toBe(true);
  });

  it("falls back to the whole page for a single splash panel", () => {
    const gray = page(300, 400, [{ x: 5, y: 5, w: 290, h: 390 }]);
    const panels = detectPanels(gray, 300, 400);
    expect(panels).toHaveLength(1);
    expect(panels[0].w).toBeGreaterThan(0.9);
  });

  it("never returns an empty list, even for a blank page", () => {
    expect(detectPanels(new Uint8Array(100 * 100).fill(255), 100, 100)).toEqual([
      { x: 0, y: 0, w: 1, h: 1 },
    ]);
  });

  it("guards against a bad buffer", () => {
    expect(detectPanels(new Uint8Array(4), 2, 2)).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
  });

  it("reads the page background level", () => {
    expect(backgroundLevel(page(50, 50, [{ x: 0, y: 0, w: 5, h: 5 }]))).toBeGreaterThan(200);
  });
});

describe("orderPanels", () => {
  const grid = [
    { x: 0.55, y: 0.02, w: 0.4, h: 0.45 },
    { x: 0.05, y: 0.02, w: 0.4, h: 0.45 },
    { x: 0.05, y: 0.52, w: 0.4, h: 0.45 },
    { x: 0.55, y: 0.52, w: 0.4, h: 0.45 },
  ];

  it("reads rows top-down, left-to-right", () => {
    expect(orderPanels(grid).map((p) => [p.x, p.y])).toEqual([
      [0.05, 0.02],
      [0.55, 0.02],
      [0.05, 0.52],
      [0.55, 0.52],
    ]);
  });

  it("reverses each row for manga", () => {
    expect(orderPanels(grid, true).map((p) => p.x)).toEqual([0.55, 0.05, 0.55, 0.05]);
  });
});

describe("panelView", () => {
  const page1 = { w: 800, h: 1200 };
  const view = { w: 800, h: 600 };

  it("zooms a small panel up and centres it", () => {
    const { zoom, cx, cy } = panelView({ x: 0, y: 0, w: 0.5, h: 0.25 }, page1, view);
    expect(zoom).toBeGreaterThan(1.5);
    expect(cx).toBeCloseTo(0.25 * page1.w * zoom, 3);
    expect(cy).toBeCloseTo(0.125 * page1.h * zoom, 3);
  });

  it("never zooms below the fitted size", () => {
    expect(panelView({ x: 0, y: 0, w: 1, h: 1 }, page1, view).zoom).toBe(1);
  });

  it("respects the max zoom cap", () => {
    expect(panelView({ x: 0, y: 0, w: 0.01, h: 0.01 }, page1, view, { maxZoom: 4 }).zoom).toBe(4);
  });
});
