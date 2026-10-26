/**
 * Image adjust worker (Phase 5).
 *
 * Applies brightness/contrast (LUT) and an unsharp 3x3 convolution to a
 * decoded bitmap on an OffscreenCanvas, off the main thread. Returns a PNG
 * blob; the caller owns the object URL and its lifetime.
 */

export interface AdjustOptions {
  /** Percentage, 100 = untouched. */
  brightness: number;
  /** Percentage, 100 = untouched. */
  contrast: number;
  /** Unsharp amount, 0..100. */
  sharpen: number;
  /** Phase 15: resample the source to this device-pixel size before adjusting. */
  scaleTo?: { w: number; h: number };
  /** Phase 15: unsharp amount applied after an upscale, 0..100. */
  enhance?: number;
}

// --------------------------------------------------------- Phase 15: resample --

const LANCZOS_A = 3;

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Lanczos-3 kernel value. Exported for tests. */
export function lanczos(x: number, a = LANCZOS_A): number {
  const t = Math.abs(x);
  if (t >= a) return 0;
  return sinc(t) * sinc(t / a);
}

/**
 * Per-output-pixel source taps and weights for one axis. Weights are
 * normalised so a flat input stays flat (no ringing on solid areas).
 */
export function buildWeights(
  srcLen: number,
  dstLen: number,
  a = LANCZOS_A,
): { starts: Int32Array; counts: Int32Array; weights: Float32Array } {
  const scale = dstLen / srcLen;
  const support = scale < 1 ? a / scale : a;
  const step = scale < 1 ? scale : 1;
  const maxTaps = Math.ceil(support * 2) + 2;
  const starts = new Int32Array(dstLen);
  const counts = new Int32Array(dstLen);
  const weights = new Float32Array(dstLen * maxTaps);

  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const first = Math.max(0, Math.ceil(center - support));
    const last = Math.min(srcLen - 1, Math.floor(center + support));
    starts[i] = first;
    let sum = 0;
    let n = 0;
    for (let j = first; j <= last && n < maxTaps; j++, n++) {
      const w = lanczos((j - center) * step, a);
      weights[i * maxTaps + n] = w;
      sum += w;
    }
    counts[i] = n;
    if (sum !== 0) {
      for (let k = 0; k < n; k++) weights[i * maxTaps + k] /= sum;
    }
  }
  return { starts, counts, weights };
}

/**
 * Separable Lanczos-3 resample of RGBA pixels. This is the quality difference
 * between a browser bilinear upscale (soft) and a desktop comic reader (hard
 * edges): the kernel keeps high-frequency detail that bilinear averages away.
 */
export function resampleLanczos(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  a = LANCZOS_A,
): Uint8ClampedArray {
  const hx = buildWeights(sw, dw, a);
  const maxX = hx.weights.length / dw;
  // Horizontal pass into a float buffer at dw x sh.
  const tmp = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    const out = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const start = hx.starts[x];
      const count = hx.counts[x];
      let r = 0,
        g = 0,
        b = 0,
        al = 0;
      for (let k = 0; k < count; k++) {
        const w = hx.weights[x * maxX + k];
        const o = row + (start + k) * 4;
        r += src[o] * w;
        g += src[o + 1] * w;
        b += src[o + 2] * w;
        al += src[o + 3] * w;
      }
      const o = out + x * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = al;
    }
  }

  const vy = buildWeights(sh, dh, a);
  const maxY = vy.weights.length / dh;
  const dst = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const start = vy.starts[y];
    const count = vy.counts[y];
    const out = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      let r = 0,
        g = 0,
        b = 0,
        al = 0;
      for (let k = 0; k < count; k++) {
        const w = vy.weights[y * maxY + k];
        const o = ((start + k) * dw + x) * 4;
        r += tmp[o] * w;
        g += tmp[o + 1] * w;
        b += tmp[o + 2] * w;
        al += tmp[o + 3] * w;
      }
      const o = out + x * 4;
      dst[o] = r;
      dst[o + 1] = g;
      dst[o + 2] = b;
      dst[o + 3] = al;
    }
  }
  return dst;
}

/** Noise floor: differences below this are left alone so grain is not amplified. */
const EDGE_GUARD = 2;

/**
 * Unsharp mask: blur, then push the original away from the blur. Applied after
 * an upscale so resampled edges read as crisp instead of soft.
 */
export function enhancePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): void {
  const k = Math.max(0, Math.min(100, amount)) / 100;
  if (k === 0 || width < 3 || height < 3) return;
  const src = new Uint8ClampedArray(data);
  // 3x3 gaussian (1 2 1 / 2 4 2 / 1 2 1) / 16
  const g = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        let gi = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[((y + dy) * width + (x + dx)) * 4 + ch] * g[gi++];
          }
        }
        const blur = sum / 16;
        const base = src[o + ch];
        const diff = base - blur;
        if (Math.abs(diff) < EDGE_GUARD) continue;
        data[o + ch] = Math.max(0, Math.min(255, base + diff * k * 1.6));
      }
    }
  }
}

/** Pure pixel pass, exported so it can be unit-tested and run inline. */
export function adjustPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: AdjustOptions,
): void {
  const b = (opts.brightness ?? 100) / 100;
  const c = (opts.contrast ?? 100) / 100;
  const amount = Math.max(0, Math.min(100, opts.sharpen ?? 0)) / 100;

  if (b !== 1 || c !== 1) {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      // brightness scales, contrast pivots around mid-grey
      lut[i] = Math.max(0, Math.min(255, (i * b - 128) * c + 128));
    }
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  }

  if (amount > 0 && width > 2 && height > 2) {
    const src = new Uint8ClampedArray(data);
    // 3x3 laplacian-ish sharpen kernel, blended by `amount`
    const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const o = (y * width + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          let sum = 0;
          let ki = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += src[((y + dy) * width + (x + dx)) * 4 + ch] * k[ki++];
            }
          }
          const base = src[o + ch];
          data[o + ch] = Math.max(0, Math.min(255, base + (sum - base) * amount));
        }
      }
    }
  }
}

async function run(bitmap: ImageBitmap, opts: AdjustOptions): Promise<Blob> {
  const sw = bitmap.width;
  const sh = bitmap.height;
  const source = new OffscreenCanvas(sw, sh);
  const sctx = source.getContext("2d")!;
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  let frame = sctx.getImageData(0, 0, sw, sh);
  let w = sw;
  let h = sh;

  // Phase 15: high-quality upscale before any tonal work, so the LUT and the
  // unsharp pass operate on the pixels that actually reach the screen.
  if (opts.scaleTo && opts.scaleTo.w > sw) {
    w = Math.round(opts.scaleTo.w);
    h = Math.round(opts.scaleTo.h || (sh * w) / sw);
    const scaled = resampleLanczos(frame.data, sw, sh, w, h);
    // ImageData wants a plain-ArrayBuffer view; the resampler's return type is
    // buffer-agnostic, so re-wrap it before handing it over.
    frame = new ImageData(new Uint8ClampedArray(scaled), w, h);
  }

  adjustPixels(frame.data, w, h, opts);
  if (opts.enhance) enhancePixels(frame.data, w, h, opts.enhance);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(frame, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

if (typeof self !== "undefined" && typeof (self as unknown as Worker).postMessage === "function") {
  self.onmessage = async (e: MessageEvent) => {
    const { id, bitmap, ...opts } = e.data ?? {};
    try {
      const blob = await run(bitmap as ImageBitmap, opts as AdjustOptions);
      (self as unknown as Worker).postMessage({ id, ok: true, blob });
    } catch (err) {
      (self as unknown as Worker).postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
