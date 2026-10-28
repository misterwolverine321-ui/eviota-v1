import type { AdjustOptions } from "@/workers/image-adjust.worker";
import { probeImageSize } from "@/lib/image-size";

/**
 * Comic image pipeline.
 *
 * Two jobs, both kept out of the engine component:
 *  - build a panel list from archive entries, optionally cutting wide
 *    double-page scans into two halves in reading order,
 *  - run brightness/contrast/sharpen through the image-adjust worker with a
 *    small URL cache keyed by panel + settings.
 *
 * Panels are built from a header-only size probe: no page is ever decoded or
 * re-encoded here. Split spreads reuse the original object URL and are cropped
 * with CSS clipping at render time, which keeps one `<img>` per panel.
 */

export interface ComicPanel {
  id: string;
  /** Archive entry name, used for alt text and labels. */
  name: string;
  url: string;
  /** Rendered width of this panel (half of the source for split spreads). */
  width: number;
  height: number;
  /** Which half of a split spread this panel is, when it is one. */
  part?: "l" | "r";
}

/** Aspect above which a scan is treated as a double-page spread. */
export const SPREAD_ASPECT = 1.15;

const canOffscreen = () =>
  typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";

/**
 * Turn a single archive entry into one panel, or two when it is a wide
 * double-page scan and splitting is on.
 */
export async function buildPanelsForEntry(
  entry: { name: string; blob: Blob },
  opts: { split: boolean; track: (url: string) => void },
): Promise<ComicPanel[]> {
  const { width, height } = await probeImageSize(entry.blob);
  const wide = width > 0 && height > 0 && width / height >= SPREAD_ASPECT;
  const url = URL.createObjectURL(entry.blob);
  opts.track(url);

  if (opts.split && wide) {
    const half = Math.floor(width / 2);
    return (["l", "r"] as const).map((side) => ({
      id: `${entry.name}#${side}`,
      name: entry.name,
      url,
      width: side === "l" ? half : width - half,
      height,
      part: side,
    }));
  }

  return [{ id: entry.name, name: entry.name, url, width, height }];
}

/**
 * Turn archive entries into panels. Dimensions come from a header probe so the
 * reader can pick a fit mode without measuring the DOM or decoding pages.
 */
export async function buildPanels(
  entries: { name: string; blob: Blob }[],
  opts: { split: boolean; track: (url: string) => void },
): Promise<ComicPanel[]> {
  const panels: ComicPanel[] = [];
  for (const entry of entries) panels.push(...(await buildPanelsForEntry(entry, opts)));
  return panels;
}

/** True when the adjust pipeline would be a no-op. */
export function isIdentityAdjust(o: AdjustOptions): boolean {
  return o.brightness === 100 && o.contrast === 100 && o.sharpen === 0 && !o.scaleTo && !o.enhance;
}

// -------------------------------------------------- Sharp zoom target --

/** Never resample beyond this multiple of the scan's native width. */
export const MAX_ENHANCE = 3;
/** Hard ceiling on the long edge of an enhanced render, in device pixels. */
export const MAX_ENHANCE_EDGE = 4200;
/** Targets snap to this grid so a pinch does not spawn a render per frame. */
export const ENHANCE_STEP = 256;
/** Below this much magnification the browser's own scaler is good enough. */
export const ENHANCE_THRESHOLD = 1.15;

/**
 * Device-pixel size an enhanced render should target for a panel displayed at
 * `displayed` CSS px, or `null` when the source already has enough pixels.
 */
export function enhanceTarget(
  panel: { width: number; height: number },
  displayed: { w: number; h: number },
  dpr: number,
): { w: number; h: number } | null {
  if (!panel.width || !panel.height || !displayed.w) return null;
  const wanted = displayed.w * Math.max(1, dpr);
  if (wanted <= panel.width * ENHANCE_THRESHOLD) return null;
  let w = Math.min(wanted, panel.width * MAX_ENHANCE);
  w = Math.ceil(w / ENHANCE_STEP) * ENHANCE_STEP;
  w = Math.min(w, panel.width * MAX_ENHANCE, MAX_ENHANCE_EDGE);
  const h = Math.round((w * panel.height) / panel.width);
  if (h > MAX_ENHANCE_EDGE) {
    const k = MAX_ENHANCE_EDGE / h;
    return { w: Math.round(w * k), h: MAX_ENHANCE_EDGE };
  }
  if (w <= panel.width) return null;
  return { w: Math.round(w), h };
}

/** Shrink a render target so neither edge passes the enhance ceiling. */
export function capTarget(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MAX_ENHANCE_EDGE / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

// ------------------------------------------------------------ worker client --

let worker: Worker | null = null;
let seq = 0;
const inflight = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined" || !canOffscreen()) return null;
  if (!worker) {
    worker = new Worker(new URL("../workers/image-adjust.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, blob, error } = e.data ?? {};
      const pending = inflight.get(id);
      if (!pending) return;
      inflight.delete(id);
      if (ok) pending.resolve(blob as Blob);
      else pending.reject(new Error(error ?? "image adjust failed"));
    };
    worker.onerror = () => {
      for (const p of inflight.values()) p.reject(new Error("image adjust worker crashed"));
      inflight.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Cache of adjusted object URLs, keyed by panel id + settings. */
export class AdjustCache {
  private urls = new Map<string, string>();

  key(panelId: string, o: AdjustOptions) {
    return `${panelId}|${o.brightness}|${o.contrast}|${o.sharpen}|${o.scaleTo?.w ?? 0}|${
      o.enhance ?? 0
    }`;
  }

  get(panelId: string, o: AdjustOptions): string | undefined {
    return this.urls.get(this.key(panelId, o));
  }

  /**
   * Adjusted URL for a panel, or `null` when the environment can't do the
   * work (SSR, no OffscreenCanvas) — callers then show the original image.
   */
  async request(panel: ComicPanel, o: AdjustOptions): Promise<string | null> {
    if (isIdentityAdjust(o)) return null;
    // Split halves share one source image, so they share one adjusted result.
    // An enhanced half is sized from the half, so it keeps its own entry.
    const cacheKey = this.key(panel.part && !o.scaleTo ? panel.name : panel.id, o);
    const hit = this.urls.get(cacheKey);
    if (hit) return hit;
    const w = getWorker();
    if (!w) return null;
    let bitmap: ImageBitmap;
    try {
      const res = await fetch(panel.url);
      bitmap = await createImageBitmap(await res.blob());
    } catch {
      return null;
    }
    const id = ++seq;
    // A split half is rendered from the whole double-page source, so its target
    // has to be doubled — and then re-capped, or a half asking for the maximum
    // edge would make the worker resample a page twice that size.
    const scaleTo = o.scaleTo
      ? panel.part
        ? capTarget(o.scaleTo.w * 2, o.scaleTo.h)
        : o.scaleTo
      : undefined;
    const blob = await new Promise<Blob>((resolve, reject) => {
      inflight.set(id, { resolve, reject });
      w.postMessage({ id, bitmap, ...o, scaleTo }, [bitmap]);
    }).catch(() => null);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    // keep the cache small: 12 adjusted panels is plenty for a reading window
    if (this.urls.size > 8) {
      const oldest = this.urls.keys().next().value;
      if (oldest) {
        URL.revokeObjectURL(this.urls.get(oldest)!);
        this.urls.delete(oldest);
      }
    }
    this.urls.set(cacheKey, url);
    return url;
  }

  dispose() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
