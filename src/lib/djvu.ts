/**
 * DjVu: the page thread's side of the decoder.
 *
 * The decoder is `djvu-rs` (MIT; WebAssembly built from Rust), run in `src/workers/djvu.worker.ts`.
 * It replaces DjVu.js, which was removed because it is distributed under the GNU
 * General Public License, Version 2. This file holds the helpers that need no decoder (tested without
 * a browser) and `DjvuClient`, the small request/answer wrapper around the worker.
 */

/** Most pixels one rendered page may have: 16 million is 64 MB of RGBA while it is being drawn. */
export const MAX_PAGE_PIXELS = 16_000_000;
/** A page is never rendered below or above these resolutions, whatever the screen asks for. */
export const MIN_DPI = 20;
export const MAX_DPI = 600;

/**
 * The resolution that makes a page `width` pixels wide, given the page's own resolution and the
 * width and height it has when rendered at that resolution. Pure, so it is tested without a browser.
 */
export function dpiForWidth(
  nativeDpi: number,
  nativeWidth: number,
  nativeHeight: number,
  width: number,
): number {
  const dpi = Number.isFinite(nativeDpi) && nativeDpi > 0 ? nativeDpi : 300;
  if (!(nativeWidth > 0) || !(nativeHeight > 0) || !(width > 0)) return dpi;
  let target = dpi * (width / nativeWidth);
  // Never more pixels than the cap allows: a page's area grows with the square of the resolution.
  const area = nativeWidth * nativeHeight * (target / dpi) ** 2;
  if (area > MAX_PAGE_PIXELS) target *= Math.sqrt(MAX_PAGE_PIXELS / area);
  return Math.min(MAX_DPI, Math.max(MIN_DPI, target));
}

/**
 * Pages to keep decoded around `page`: the visible one plus `radius` on each
 * side, clamped to the document. Rendering a DjVu page is expensive, so the
 * engine only ever holds this window.
 */
export function renderWindow(page: number, total: number, radius = 1): number[] {
  if (!Number.isFinite(total) || total < 1) return [];
  const current = Math.min(Math.max(Math.round(page) || 1, 1), total);
  const span = Math.max(0, Math.round(radius) || 0);
  const pages: number[] = [];
  for (let p = current - span; p <= current + span; p++) {
    if (p >= 1 && p <= total) pages.push(p);
  }
  return pages;
}

/** Space kept clear around the pages and between the two pages of a spread, in CSS pixels. */
export const PAGE_PAD = 12;
export const PAGE_GAP = 6;

/**
 * The size, in CSS pixels, at which a page of the given width-to-height ratio fits a reading surface
 * that shows `across` pages side by side. Never larger than the surface, never smaller than 1 px.
 */
export function fitPage(
  aspect: number,
  surface: { w: number; h: number },
  across = 1,
): { w: number; h: number } {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.7;
  const n = Math.max(1, Math.round(across));
  const availW = (surface.w - 2 * PAGE_PAD - PAGE_GAP * (n - 1)) / n;
  const availH = surface.h - 2 * PAGE_PAD;
  const w = Math.max(1, Math.floor(Math.min(availW, availH * ratio)));
  return { w, h: Math.max(1, Math.floor(w / ratio)) };
}

/**
 * How many pixels wide to draw a page that fills `cssWidth` CSS pixels on a screen with the given
 * pixel ratio: rounded up to a multiple of 64, so small changes of the window do not draw every page
 * again, and kept between 256 and 3200.
 */
export function renderWidth(cssWidth: number, pixelRatio = 1): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const wanted = Math.ceil((Math.max(0, cssWidth) * ratio) / 64) * 64;
  return Math.min(3200, Math.max(256, wanted));
}

/**
 * Normalize a page's native text layer: DjVu text chunks keep hard line breaks
 * from the scan, so joins hyphenated words and collapses whitespace before the
 * text reaches the search index.
 */
export function normalizeDjvuText(text: string): string {
  if (!text) return "";
  return (
    text
      // The text layer separates its zones (page, column, region, paragraph, line) with control
      // characters (0x0B, 0x1D, 0x1E, 0x1F) and ends with a NUL. They are breaks, not text.
      // eslint-disable-next-line no-control-regex -- matching those control characters is the point
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "\n")
      .replace(/\r\n?/g, "\n")
      .replace(/(\p{L})[-\u00ad]\n(\p{L})/gu, "$1$2")
      .replace(/\s*\n\s*/g, " ")
      .replace(/[ \t\u00a0]+/g, " ")
      .trim()
  );
}

/** A page carries usable native text only when there are real words in it. */
export function hasTextLayer(text: string): boolean {
  const normalized = normalizeDjvuText(text);
  if (normalized.length < 8) return false;
  return /\p{L}{2,}/u.test(normalized);
}

/* ------------------------------------------------------------------ *
 * Client for the worker
 * ------------------------------------------------------------------ */

export interface DjvuPage {
  /** The decoded page, ready to draw on a canvas. The caller closes it when it is done with it. */
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

interface Pending {
  resolve: (reply: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

/**
 * One document in one worker. Every call is a request the worker answers in order; `dispose()`
 * ends the worker and fails whatever is still waiting. Pages are numbered from 1.
 */
export class DjvuClient {
  private worker: Worker | null = null;
  private seq = 0;
  private inflight = new Map<number, Pending>();
  private disposed = false;

  private call(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<Record<string, unknown>> {
    if (this.disposed) return Promise.reject(new Error("The DjVu reader was closed."));
    if (typeof Worker === "undefined") {
      return Promise.reject(new Error("This browser cannot run the DjVu decoder."));
    }
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/djvu.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (e: MessageEvent) => {
        const reply = e.data as { id: number; ok: boolean; error?: string };
        const pending = this.inflight.get(reply.id);
        if (!pending) {
          // Nobody is waiting any more (the reader closed): free the page that arrived.
          (reply as { bitmap?: ImageBitmap }).bitmap?.close();
          return;
        }
        this.inflight.delete(reply.id);
        if (reply.ok) pending.resolve(reply as unknown as Record<string, unknown>);
        else pending.reject(new Error(reply.error ?? "The DjVu decoder failed."));
      };
      this.worker.onerror = () => {
        for (const p of this.inflight.values()) p.reject(new Error("The DjVu decoder crashed."));
        this.inflight.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    const id = ++this.seq;
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      this.inflight.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  /** Opens the file; resolves with its page count, or rejects when it is not a readable DjVu file. */
  async open(file: Blob): Promise<{ pageCount: number }> {
    const bytes = await file.arrayBuffer();
    const reply = await this.call({ op: "open", bytes }, [bytes]);
    return { pageCount: Number(reply["pageCount"]) };
  }

  /** The page's size in pixels at its own resolution. */
  async size(page: number): Promise<{ width: number; height: number }> {
    const reply = await this.call({ op: "size", page });
    return { width: Number(reply["width"]), height: Number(reply["height"]) };
  }

  /** The page drawn about `width` pixels wide. */
  async render(page: number, width: number): Promise<DjvuPage> {
    const reply = await this.call({ op: "render", page, width: Math.round(width) });
    return {
      bitmap: reply["bitmap"] as ImageBitmap,
      width: Number(reply["width"]),
      height: Number(reply["height"]),
    };
  }

  /** The page's own text layer, or null when the scan has none. Not normalised. */
  async text(page: number): Promise<string | null> {
    const reply = await this.call({ op: "text", page });
    const text = reply["text"];
    return typeof text === "string" ? text : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.inflight.values()) p.reject(new Error("The DjVu reader was closed."));
    this.inflight.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
