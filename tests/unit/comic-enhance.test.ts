import { describe, expect, it } from "vitest";
import {
  buildWeights,
  enhancePixels,
  lanczos,
  resampleLanczos,
} from "@/workers/image-adjust.worker";
import { enhanceTarget, ENHANCE_STEP, MAX_ENHANCE, MAX_ENHANCE_EDGE } from "@/lib/comic-image";

describe("lanczos kernel", () => {
  it("peaks at the sample point and dies at the support edge", () => {
    expect(lanczos(0)).toBeCloseTo(1, 6);
    expect(lanczos(3)).toBe(0);
    expect(lanczos(4)).toBe(0);
  });

  it("normalises weights per output pixel", () => {
    const { counts, weights, starts } = buildWeights(4, 12);
    const maxTaps = weights.length / 12;
    for (let i = 0; i < 12; i++) {
      let sum = 0;
      for (let k = 0; k < counts[i]; k++) sum += weights[i * maxTaps + k];
      expect(sum).toBeCloseTo(1, 5);
      expect(starts[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

/** Solid colour in, solid colour out — a resampler that rings here is broken. */
describe("resampleLanczos", () => {
  it("preserves a flat image while changing size", () => {
    const sw = 8;
    const sh = 8;
    const src = new Uint8ClampedArray(sw * sh * 4).fill(200);
    const out = resampleLanczos(src, sw, sh, 24, 24);
    expect(out.length).toBe(24 * 24 * 4);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(200);
  });

  it("keeps an edge hard instead of averaging it away", () => {
    const sw = 8;
    const sh = 2;
    const src = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const o = (y * sw + x) * 4;
        const v = x < 4 ? 0 : 255;
        src[o] = src[o + 1] = src[o + 2] = v;
        src[o + 3] = 255;
      }
    }
    const dw = 32;
    const out = resampleLanczos(src, sw, sh, dw, 8);
    const left = out[(2 * dw + 2) * 4];
    const right = out[(2 * dw + dw - 3) * 4];
    expect(left).toBeLessThan(20);
    expect(right).toBeGreaterThan(235);
  });
});

describe("enhancePixels", () => {
  it("leaves flat areas untouched", () => {
    const data = new Uint8ClampedArray(6 * 6 * 4).fill(128);
    const before = new Uint8ClampedArray(data);
    enhancePixels(data, 6, 6, 60);
    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it("increases local contrast across an edge", () => {
    const w = 7;
    const h = 7;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const v = x < 3 ? 90 : 170;
        data[o] = data[o + 1] = data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    const darkBefore = data[(3 * w + 2) * 4];
    const lightBefore = data[(3 * w + 3) * 4];
    enhancePixels(data, w, h, 80);
    const dark = data[(3 * w + 2) * 4];
    const light = data[(3 * w + 3) * 4];
    expect(light - dark).toBeGreaterThan(lightBefore - darkBefore);
  });
});

describe("enhanceTarget", () => {
  const panel = { width: 900, height: 1400 };

  it("returns null when the source already has enough pixels", () => {
    expect(enhanceTarget(panel, { w: 700, h: 1089 }, 1)).toBeNull();
    expect(enhanceTarget(panel, { w: 900, h: 1400 }, 1)).toBeNull();
  });

  it("targets device pixels once magnified past the source", () => {
    const t = enhanceTarget(panel, { w: 1200, h: 1866 }, 2);
    expect(t).not.toBeNull();
    expect(t!.w % ENHANCE_STEP).toBe(0);
    expect(t!.w).toBeLessThanOrEqual(panel.width * MAX_ENHANCE);
    expect(t!.h).toBeCloseTo((t!.w * panel.height) / panel.width, 0);
  });

  it("caps the long edge", () => {
    const t = enhanceTarget({ width: 2000, height: 3000 }, { w: 6000, h: 9000 }, 2);
    expect(t).not.toBeNull();
    expect(Math.max(t!.w, t!.h)).toBeLessThanOrEqual(MAX_ENHANCE_EDGE);
  });

  it("ignores degenerate input", () => {
    expect(enhanceTarget({ width: 0, height: 0 }, { w: 100, h: 100 }, 2)).toBeNull();
    expect(enhanceTarget(panel, { w: 0, h: 0 }, 2)).toBeNull();
  });
});
