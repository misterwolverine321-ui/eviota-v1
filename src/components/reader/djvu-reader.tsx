import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RendererProps } from "./foliate-reader";
import type { RendererCaps } from "@/lib/reader-settings";
import {
  DjvuClient,
  PAGE_GAP,
  PAGE_PAD,
  fitPage,
  hasTextLayer,
  normalizeDjvuText,
  renderWidth,
  renderWindow,
} from "@/lib/djvu";
import { OcrClient } from "@/lib/ocr";
import { tapZone } from "@/lib/tap-gesture";
import { BookLoader } from "@/components/loading-book";

/** Longest page text handed to a screen reader in one piece. */
const SPOKEN_TEXT_LIMIT = 30_000;
/** Width, in pixels, of the page image given to OCR. */
const OCR_WIDTH = 1800;

interface Drawn {
  bitmap: ImageBitmap;
  /** The width this page was asked for, so a change of window size can tell it is stale. */
  asked: number;
}

/**
 * DjVu engine, built on `djvu-rs` (MIT; WebAssembly) running in a worker.
 *
 * A paged surface: the page or the two pages of a spread are drawn to fit, the pages on either side
 * are drawn in advance, and everything further away is released. A scan that carries its own text
 * layer is searchable outright and its text is available to a screen reader; any other scan is
 * searchable through the kernel's OCR opt-in. Not offered yet: zoom, a table of contents (the
 * package's WebAssembly interface does not expose one), highlights and notes.
 */
export function DjvuReader({
  file,
  settings,
  theme,
  progress,
  onReady,
  onProgress,
  onError,
  navRef,
  ocrEnabled,
}: RendererProps) {
  const clientRef = useRef<DjvuClient | null>(null);
  const ocrRef = useRef<OcrClient | null>(null);
  const [pageCount, setPageCount] = useState(0);
  /** True when some page of the document carries a usable native text layer. */
  const [nativeText, setNativeText] = useState(false);
  const [index, setIndex] = useState(0); // 0-based
  const [box, setBox] = useState({ w: 0, h: 0 });

  // What has been drawn lives in refs (a bitmap is not state); `bump` tells React to look again.
  const drawn = useRef(new Map<number, Drawn>());
  const aspects = useRef(new Map<number, number>());
  const texts = useRef(new Map<number, string>());
  const failed = useRef(new Set<number>());
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const latest = useRef({ onReady, onProgress, onError });
  latest.current = { onReady, onProgress, onError };
  /** Where to start: read once, because the kernel saves progress and hands it back as it moves. */
  const startFraction = useRef(progress?.fraction ?? 0);

  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const capsFor = (pages: number, native: boolean, ocr: boolean): RendererCaps => ({
    paged: true,
    typography: false,
    flowControl: false,
    annotations: false as const,
    // Native text makes the scan searchable outright; otherwise OCR must be on.
    search: native || ocr,
    spread: true,
    imageAdjust: false,
    // The engine can always build a text layer from pixels on request.
    ocr: true,
    pageCount: pages,
  });
  const capsRef = useRef(capsFor);
  capsRef.current = capsFor;

  // Keep the surface's size, so pages are drawn at the size they are shown.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () =>
      setBox((prev) =>
        prev.w === el.clientWidth && prev.h === el.clientHeight
          ? prev
          : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Open the document once per file.
  useEffect(() => {
    let cancelled = false;
    const client = new DjvuClient();
    clientRef.current = client;
    const store = drawn.current;
    // The three tables below are created once and never replaced, so these are the same objects the
    // rest of the component uses; they are named here so the cleanup does not read `.current` later.
    const aspectTable = aspects.current;
    const textTable = texts.current;
    const failedPages = failed.current;

    client
      .open(file)
      .then(async ({ pageCount: total }) => {
        if (cancelled) return;
        if (total < 1) {
          latest.current.onError("This DjVu document has no readable pages.");
          return;
        }
        const start = Math.max(
          0,
          Math.min(total - 1, Math.round(startFraction.current * (total - 1))),
        );
        setPageCount(total);
        setIndex(start);
        // A few pages decide whether search needs OCR at all: a scan can open with a plate or a
        // cover that has no text while the pages after it do.
        const probes = [...new Set([start + 1, 1, Math.ceil(total / 2), total])].filter(
          (p) => p >= 1 && p <= total,
        );
        let native = false;
        for (const page of probes) {
          const text = await client.text(page).catch(() => null);
          if (cancelled) return;
          if (text && hasTextLayer(text)) {
            native = true;
            break;
          }
        }
        setNativeText(native);
        latest.current.onReady(capsRef.current(total, native, false));
      })
      .catch((err) => {
        console.error("djvu failed", err);
        if (!cancelled) {
          latest.current.onError("This DjVu document could not be read. The file may be damaged.");
        }
      });

    return () => {
      cancelled = true;
      client.dispose();
      clientRef.current = null;
      for (const entry of store.values()) entry.bitmap.close();
      store.clear();
      aspectTable.clear();
      textTable.clear();
      failedPages.clear();
    };
  }, [file]);

  // Re-declare capabilities when the OCR opt-in flips.
  useEffect(() => {
    if (pageCount === 0) return;
    latest.current.onReady(capsFor(pageCount, nativeText, !!ocrEnabled));
  }, [ocrEnabled, pageCount, nativeText]);

  // The OCR client only exists while the fallback is opted in.
  useEffect(() => {
    if (!ocrEnabled) {
      ocrRef.current?.dispose();
      ocrRef.current = null;
      return;
    }
    ocrRef.current ??= new OcrClient();
    return () => {
      ocrRef.current?.dispose();
      ocrRef.current = null;
    };
  }, [ocrEnabled]);

  const across = settings.spread ? 2 : 1;
  const visible = useMemo(
    () => Array.from({ length: across }, (_, i) => index + 1 + i).filter((p) => p <= pageCount),
    [index, across, pageCount],
  );
  const windowPages = useMemo(
    () => renderWindow(index + 1, pageCount, across),
    [index, pageCount, across],
  );

  // Draw the visible pages first, then their neighbours, and release the rest.
  useEffect(() => {
    const client = clientRef.current;
    if (!client || pageCount === 0 || box.w === 0 || box.h === 0) return;
    let cancelled = false;
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const order = [
      ...visible,
      ...[...windowPages].filter((p) => !visible.includes(p)).sort((a, b) => a - b),
    ];

    void (async () => {
      for (const page of order) {
        if (cancelled) return;
        let aspect = aspects.current.get(page);
        if (aspect === undefined) {
          try {
            const size = await client.size(page);
            if (cancelled) return;
            aspect = size.width / size.height;
            aspects.current.set(page, aspect);
            bump();
          } catch {
            failed.current.add(page);
            bump();
            continue;
          }
        }
        const fit = fitPage(aspect, box, across);
        const asked = renderWidth(fit.w, ratio);
        const have = drawn.current.get(page);
        if (have && have.asked === asked) continue;
        try {
          const done = await client.render(page, asked);
          if (cancelled) {
            done.bitmap.close();
            return;
          }
          have?.bitmap.close();
          drawn.current.set(page, { bitmap: done.bitmap, asked });
          failed.current.delete(page);
          bump();
        } catch (err) {
          if (cancelled) return;
          console.error("djvu page failed", page, err);
          failed.current.add(page);
          bump();
        }
      }
      if (cancelled) return;
      for (const [page, entry] of [...drawn.current]) {
        if (!windowPages.includes(page)) {
          entry.bitmap.close();
          drawn.current.delete(page);
        }
      }
      bump();
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, windowPages, pageCount, box, across, bump]);

  // The text of the pages on screen, for a screen reader (when the scan has a text layer).
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !nativeText) return;
    let cancelled = false;
    void (async () => {
      for (const page of visible) {
        if (texts.current.has(page)) continue;
        const raw = await client.text(page).catch(() => null);
        if (cancelled) return;
        const text = raw ? normalizeDjvuText(raw) : "";
        texts.current.set(page, hasTextLayer(text) ? text.slice(0, SPOKEN_TEXT_LIMIT) : "");
        bump();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, nativeText, bump]);

  const step = across;
  useEffect(() => {
    navRef.current = {
      next: () => setIndex((i) => Math.min(pageCount - 1, i + step)),
      prev: () => setIndex((i) => Math.max(0, i - step)),
      goToFraction: (f) => setIndex(Math.round(f * Math.max(0, pageCount - 1))),
      goToPage: (page) => setIndex(Math.min(pageCount - 1, Math.max(0, Math.round(page) - 1))),
      goToHit: (hit) => {
        if (hit.target.kind !== "page") return;
        setIndex(Math.min(pageCount - 1, Math.max(0, hit.target.page - 1)));
      },
      // The scan's own text first; OCR only for a page that carries none.
      ...(nativeText || ocrEnabled
        ? {
            extractPageText: async (page: number) => {
              const client = clientRef.current;
              if (!client) return "";
              const raw = await client.text(page).catch(() => null);
              const native = raw ? normalizeDjvuText(raw) : "";
              if (hasTextLayer(native)) return native;
              const ocr = ocrRef.current;
              if (!ocr || !ocrEnabled) return native;
              return ocr.recognize(`djvu:${page}`, () => pageImage(client, page));
            },
          }
        : {}),
    };
    return () => {
      navRef.current = null;
    };
  }, [navRef, pageCount, step, nativeText, ocrEnabled]);

  useEffect(() => {
    if (pageCount === 0) return;
    latest.current.onProgress({
      fraction: pageCount > 1 ? index / (pageCount - 1) : 1,
      page: index + 1,
      totalPages: pageCount,
      label: `${index + 1} / ${pageCount}`,
    });
  }, [index, pageCount]);

  // A tap on either outer third turns the page; the middle is the shell's, for showing the bars.
  const onClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const zone = tapZone((e.clientX - rect.left) / rect.width);
    if (zone === "forward") navRef.current?.next();
    else if (zone === "back") navRef.current?.prev();
  };

  return (
    <div
      ref={surfaceRef}
      className="flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: theme.bg, padding: PAGE_PAD }}
      data-djvu-surface=""
      data-djvu-page={pageCount ? index + 1 : undefined}
      onClick={onClick}
    >
      {pageCount === 0 ? (
        <BookLoader label="Reading the document" />
      ) : (
        <div className="flex items-center justify-center" style={{ gap: PAGE_GAP }}>
          {visible.map((page) => {
            const aspect = aspects.current.get(page);
            const size = fitPage(aspect ?? 0.7, box, across);
            const entry = drawn.current.get(page);
            const label = `Page ${page} of ${pageCount}`;
            return (
              <div
                key={page}
                role="group"
                aria-label={label}
                className="flex items-center justify-center"
                style={{ width: size.w, height: size.h }}
              >
                {entry ? (
                  <>
                    <PageCanvas bitmap={entry.bitmap} label={`Scanned image of page ${page}`} />
                    {texts.current.get(page) ? (
                      <p className="sr-only">{texts.current.get(page)}</p>
                    ) : null}
                  </>
                ) : failed.current.has(page) ? (
                  <p
                    className="font-mono text-xs tracking-widest uppercase"
                    style={{ color: theme.sub }}
                  >
                    This page could not be drawn
                  </p>
                ) : (
                  <p
                    className="font-mono text-xs tracking-widest uppercase"
                    style={{ color: theme.sub }}
                  >
                    Drawing page {page}…
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A page, drawn once from the decoder's bitmap and then left alone. */
function PageCanvas({ bitmap, label }: { bitmap: ImageBitmap; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="h-full w-full select-none"
      style={{ background: "#fff" }}
    />
  );
}

/** One page as a PNG for OCR, drawn at a width Tesseract reads well. */
async function pageImage(client: DjvuClient, page: number): Promise<Blob | null> {
  const { bitmap, width, height } = await client.render(page, OCR_WIDTH);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    bitmap.close();
  }
}
