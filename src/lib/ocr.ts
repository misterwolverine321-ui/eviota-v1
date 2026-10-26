import { assetUrl } from "./asset-url";
import type { OcrPart } from "@/workers/ocr.worker";

/**
 * OCR client (§6.4).
 *
 * Owns the single OCR worker and a per-page text cache. Recognition is
 * serialized: tesseract is CPU-bound and a comic archive has hundreds of
 * pages, so running one page at a time keeps the reader responsive and lets
 * the kernel's idle-batched `ensureIndex` pace the whole build.
 */

interface Pending {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

export class OcrClient {
  private worker: Worker | null = null;
  private seq = 0;
  private inflight = new Map<number, Pending>();
  /** page key -> recognized text, so a re-index never re-reads a page. */
  private cache = new Map<string, string>();
  /** Tail of the recognition queue; keeps pages strictly sequential. */
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  private getWorker(): Worker | null {
    if (this.disposed || typeof Worker === "undefined") return null;
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/ocr.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, ok, text, error } = e.data ?? {};
        const pending = this.inflight.get(id);
        if (!pending) return;
        this.inflight.delete(id);
        if (ok) pending.resolve(String(text ?? ""));
        else pending.reject(new Error(error ?? "OCR failed"));
      };
      this.worker.onerror = () => {
        for (const p of this.inflight.values()) p.reject(new Error("OCR worker crashed"));
        this.inflight.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Text for one page image. Cached by `key` (the panel id), so split-spread
   * halves and repeated index passes each cost at most one recognition.
   */
  async recognize(
    key: string,
    source: () => Promise<Blob | null>,
    part?: OcrPart,
  ): Promise<string> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    const run = this.chain.then(async () => {
      const cached = this.cache.get(key);
      if (cached !== undefined) return cached;
      const worker = this.getWorker();
      if (!worker) return "";
      const blob = await source().catch(() => null);
      if (!blob) return "";
      const id = ++this.seq;
      const text = await new Promise<string>((resolve, reject) => {
        this.inflight.set(id, { resolve, reject });
        worker.postMessage({
          id,
          type: "recognize",
          blob,
          part,
          vendorBase: assetUrl("vendor/tesseract"),
        });
      }).catch(() => "");
      this.cache.set(key, text);
      return text;
    });
    // A failed page must not poison the queue for the pages behind it.
    this.chain = run.catch(() => undefined);
    return run;
  }

  dispose() {
    this.disposed = true;
    for (const p of this.inflight.values()) p.reject(new Error("OCR cancelled"));
    this.inflight.clear();
    this.cache.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
