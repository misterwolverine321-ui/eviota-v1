/// <reference lib="webworker" />
/**
 * OCR worker (§6.4).
 *
 * Comics and DJVU carry no text layer, so `search` is unreachable for them
 * until something reads the pixels. This worker decodes one page image at a
 * time (`createImageBitmap`, same primitive the image-adjust pipeline uses),
 * runs tesseract over it and returns plaintext. The kernel then feeds that
 * text into the *same* `searchIndex` store every other engine uses, so
 * snippets, cross-book search and text anchors work unchanged.
 *
 * Everything above the message handler is pure and unit-tested: the tesseract
 * call is the only impure step, and it is loaded lazily so importing this
 * module (tests, SSR-safe paths) never pulls in the wasm core.
 */

/** Which half of a split double-page scan to read, when the page is one. */
export type OcrPart = "l" | "r";

export interface OcrRequest {
  type: "recognize";
  /** Page image bytes. Transferred, never copied back. */
  blob: Blob;
  /** Crop to one half of a wide spread before recognizing. */
  part?: OcrPart;
  /**
   * ABSOLUTE URL of the tesseract vendor folder, resolved on the main thread.
   * A worker resolves relative URLs against its own script (in `assets/`), so
   * it cannot work this out itself when the app is hosted under a sub-path.
   */
  vendorBase?: string;
}

type Req = OcrRequest;

type Res = { id: number; ok: true; text: string } | { id: number; ok: false; error: string };

/** Longest side tesseract is fed. Comic scans are far larger than it needs. */
export const OCR_TARGET_LONG_SIDE = 1800;
/** Below this the page is upscaled instead — small scans OCR badly. */
export const OCR_MIN_LONG_SIDE = 900;

/**
 * Scale factor for a page before recognition: shrink oversized scans, nudge
 * tiny ones up, leave anything already in range untouched.
 */
export function ocrScale(width: number, height: number): number {
  const long = Math.max(width, height);
  if (!Number.isFinite(long) || long <= 0) return 1;
  if (long > OCR_TARGET_LONG_SIDE) return OCR_TARGET_LONG_SIDE / long;
  if (long < OCR_MIN_LONG_SIDE) return Math.min(2, OCR_MIN_LONG_SIDE / long);
  return 1;
}

/** Source rectangle for a page, accounting for split-spread halves. */
export function ocrSourceRect(
  width: number,
  height: number,
  part?: OcrPart,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!part) return { sx: 0, sy: 0, sw: width, sh: height };
  const half = Math.floor(width / 2);
  return part === "l"
    ? { sx: 0, sy: 0, sw: half, sh: height }
    : { sx: half, sy: 0, sw: width - half, sh: height };
}

// eslint-disable-next-line no-control-regex -- stripping control chars is the point
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * True when a line is OCR noise rather than dialogue: mostly punctuation or
 * stray marks. Speech balloons are short, so length alone can't decide.
 */
export function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  const letters = trimmed.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length === 0) return true;
  // A line that is mostly non-alphanumeric is panel border / halftone noise.
  return letters.length / trimmed.length < 0.5;
}

/**
 * Clean raw tesseract output into indexable page text: drop control chars and
 * noise lines, rejoin words hyphenated across a line break, collapse runs of
 * whitespace. Casing is preserved — snippets show the page as it reads.
 */
export function normalizeOcrText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_RE, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((l) => !isNoiseLine(l));

  let out = "";
  for (const line of lines) {
    if (!out) {
      out = line;
      continue;
    }
    // "conti-\nnued" -> "continued"
    if (/[\p{L}]-$/u.test(out) && /^[\p{Ll}]/u.test(line)) {
      out = `${out.slice(0, -1)}${line}`;
    } else {
      out = `${out} ${line}`;
    }
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

// ------------------------------------------------------------- recognition --

/** Tesseract assets are served locally from `public/vendor/tesseract`. */
const DEFAULT_VENDOR = "/vendor/tesseract";

type TesseractWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let enginePromise: Promise<TesseractWorker> | null = null;

async function getEngine(vendor: string): Promise<TesseractWorker> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker("eng", 1, {
        workerPath: `${vendor}/worker.min.js`,
        corePath: `${vendor}/tesseract-core-simd-lstm.wasm.js`,
        langPath: vendor,
        gzip: false,
        legacyCore: false,
        legacyLang: false,
      })) as unknown as TesseractWorker;
    })().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * Decode + normalize one page image so tesseract sees a sanely sized, cropped
 * bitmap. Returns a blob because the tesseract worker takes image input, not
 * pixels.
 */
async function prepare(blob: Blob, part?: OcrPart): Promise<Blob> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
    return blob;
  }
  const bitmap = await createImageBitmap(blob);
  const { sx, sy, sw, sh } = ocrSourceRect(bitmap.width, bitmap.height, part);
  const scale = ocrScale(sw, sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = new OffscreenCanvas(dw, dh);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return blob;
  }
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

/** Recognize one page image and return cleaned plaintext. */
export async function recognizePage(
  blob: Blob,
  part?: OcrPart,
  vendorBase: string = DEFAULT_VENDOR,
): Promise<string> {
  const prepared = await prepare(blob, part);
  const engine = await getEngine(vendorBase);
  const result = await engine.recognize(prepared);
  return normalizeOcrText(result?.data?.text ?? "");
}

// Guarded so the module can also be imported directly (tests, SSR-safe paths).
if (typeof self !== "undefined" && "onmessage" in self) {
  self.onmessage = (e: MessageEvent<Req & { id: number }>) => {
    const { id, blob, part, vendorBase } = e.data ?? ({} as Req & { id: number });
    void recognizePage(blob, part, vendorBase)
      .then((text) => {
        (self as unknown as Worker).postMessage({ id, ok: true, text } satisfies Res);
      })
      .catch((err: unknown) => {
        (self as unknown as Worker).postMessage({
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies Res);
      });
  };
}
