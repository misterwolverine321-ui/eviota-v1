import { installPdfJsPolyfill } from "@/lib/pdfjs-polyfill";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TocItem } from "@/lib/reader-settings";
import {
  ANNOTATION_COLORS,
  isTextMark,
  type Annotation,
  type AnnotationAnchor,
  type NormRect,
} from "@/lib/annotations";
import { buildTextAnchor, resolveTextAnchor } from "@/lib/text-anchor";
import {
  buildPageTextMap,
  normalizedRects,
  offsetsFromRange,
  rangeFromOffsets,
} from "@/lib/pdf-text-map";
import { findMatches, normalizeText } from "@/lib/search";
import { occurrenceBefore, spansForOccurrence } from "@/lib/hit-locate";
import type { SearchHit } from "@/lib/reader-settings";
import type { RendererProps } from "./foliate-reader";
import { isPlainClick, markAt } from "@/lib/mark-hit";
import { smoothScroll } from "@/lib/motion";
import { guardAuxClick, requestExternalLink } from "@/lib/safe-report";

const FLASH_ATTR = "data-search-flash";

function clearFlash(hosts: (HTMLDivElement | null)[]) {
  for (const host of hosts) {
    host?.querySelectorAll<HTMLElement>(`[${FLASH_ATTR}]`).forEach((span) => {
      span.removeAttribute(FLASH_ATTR);
      span.style.background = "";
      span.style.borderRadius = "";
    });
  }
}

/** Effective page box in PDF units — the crop box when trimming is on. */
interface PageSlot {
  w: number;
  h: number;
}

interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A finished page render, kept in an LRU so zoom-back is instant. */
interface RenderedPage {
  key: string;
  bytes: number;
  nodes: HTMLElement[];
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const GUTTER = 48;
/** The usual margin below the last page, and the least there ever is (Tailwind's `py-20`). */
const TAIL_MIN = 80;
/** Byte budget for cached page canvases (§3.4 performance rules). */
const CACHE_BUDGET = 128 * 1024 * 1024;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Quantize the zoom so tiny scroll deltas don't invalidate every cache entry. */
const scaleKey = (cssScale: number, dpr: number, crop: boolean, invert: boolean) =>
  `${Math.round(cssScale * 100)}@${dpr}${crop ? "c" : ""}${invert ? "i" : ""}`;

/** Scan a rendered canvas for the ink bounding box, in 0..1 page units. */
function detectCrop(canvas: HTMLCanvasElement): CropBox | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 8 || height < 8) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const light = data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244;
      if (light) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  const pad = Math.round(Math.min(width, height) * 0.012);
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width, maxX + pad);
  const y1 = Math.min(height, maxY + pad);
  const box = {
    x: x0 / width,
    y: y0 / height,
    w: (x1 - x0) / width,
    h: (y1 - y0) / height,
  };
  // Not worth a second render if there's barely any margin to trim.
  if (box.w > 0.97 && box.h > 0.97) return null;
  return box;
}

/** pdf.js engine: continuous scroll, pinch zoom/pan, text + annotation layers. */
export function PdfReader({
  file,
  settings,
  theme,
  progress,
  onReady,
  onProgress,
  onError,
  navRef,
  annotations = [],
  onSelection,
  onOrphanChange,
  onZoom,
}: RendererProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<(HTMLDivElement | null)[]>([]);
  const hostsRef = useRef<(HTMLDivElement | null)[]>([]);
  const pagesRef = useRef<Map<number, PDFPageProxy>>(new Map());
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<{
    promise: Promise<PDFDocumentProxy>;
    destroy: () => Promise<void>;
  } | null>(null);
  const baseRef = useRef<Map<number, PageSlot>>(new Map());
  const cropRef = useRef<Map<number, CropBox | null>>(new Map());
  const cacheRef = useRef<Map<string, RenderedPage>>(new Map());
  const cacheBytes = useRef(0);
  const mountedKeys = useRef<Map<number, string>>(new Map());
  const inflight = useRef<Set<string>>(new Set());
  const thumbCache = useRef<Map<string, string>>(new Map());
  const restoredRef = useRef(false);
  const currentPageRef = useRef(1);
  const selectRef = useRef(onSelection);
  selectRef.current = onSelection;
  const orphanRef = useRef(onOrphanChange);
  orphanRef.current = onOrphanChange;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const gestureRef = useRef(false);

  /**
   * How many leading pages have their real size in `slots`. Until a page has rendered its slot is
   * page 1's box, so a PDF whose pages differ in size had every slot but the first wrong: a jump to
   * page 4 counted three guessed heights and landed somewhere else, and the layout then moved under
   * the reader as pages rendered. The sizes are read for every page right after the file opens.
   */
  const [sizedUpTo, setSizedUpTo] = useState(0);
  /** `sizedUpTo` as of the last commit: what the DOM actually reflects. */
  const sizedRef = useRef(0);
  /** Jumps that arrived before the pages above their target had real sizes. */
  const waitersRef = useRef<{ upTo: number; run: () => void }[]>([]);
  /** Scroll adjustment owed for pages above the reader that changed height while it read. */
  const shiftRef = useRef(0);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [slots, setSlots] = useState<PageSlot[]>([]);
  const [viewWidth, setViewWidth] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  /** Bumped whenever a page's text layer lands, so anchors re-resolve. */
  const [layerTick, setLayerTick] = useState(0);
  /** Rects resolved from text anchors, keyed by annotation id. */
  const [textRects, setTextRects] = useState<Map<string, NormRect[]>>(new Map());
  const textRectsRef = useRef(textRects);
  textRectsRef.current = textRects;

  const zoom = settings.pdfScale;
  const slotsStateRef = useRef<PageSlot[]>([]);
  slotsStateRef.current = slots;

  /** CSS pixel width for a page slot at the current zoom. */
  const pageWidth = useCallback(
    (slot: PageSlot | undefined) => {
      const available = Math.max(240, viewWidth - GUTTER);
      if (!slot) return available;
      if (zoom === "fit") return available;
      return Math.max(120, slot.w * zoom);
    },
    [viewWidth, zoom],
  );
  const pageWidthRef = useRef(pageWidth);
  pageWidthRef.current = pageWidth;

  // After a commit that taught the reader more page sizes: keep the reader where it was if pages
  // above it changed height, and run the jumps that were waiting for those sizes.
  useLayoutEffect(() => {
    sizedRef.current = sizedUpTo;
    const scroller = scrollRef.current;
    if (shiftRef.current && scroller) {
      scroller.scrollTop += shiftRef.current;
      shiftRef.current = 0;
    }
    const ready = waitersRef.current.filter((w) => w.upTo <= sizedUpTo);
    if (ready.length) {
      waitersRef.current = waitersRef.current.filter((w) => w.upTo > sizedUpTo);
      ready.forEach((w) => w.run());
    }
  }, [sizedUpTo]);

  // ---------------------------------------------------------------- cache ---

  const releaseCache = useCallback((key: string) => {
    const hit = cacheRef.current.get(key);
    if (!hit) return;
    cacheRef.current.delete(key);
    cacheBytes.current -= hit.bytes;
    hit.nodes.forEach((n) => n.remove());
  }, []);

  const trimCache = useCallback(() => {
    if (cacheBytes.current <= CACHE_BUDGET) return;
    const live = new Set(mountedKeys.current.values());
    for (const key of [...cacheRef.current.keys()]) {
      if (cacheBytes.current <= CACHE_BUDGET) break;
      if (live.has(key)) continue;
      releaseCache(key);
    }
  }, [releaseCache]);

  const clearCache = useCallback(() => {
    for (const key of [...cacheRef.current.keys()]) releaseCache(key);
    mountedKeys.current.clear();
    cacheBytes.current = 0;
  }, [releaseCache]);

  // --------------------------------------------------------------- render ---

  const renderPage = useCallback(
    async (pageNum: number, key: string, cssScale: number) => {
      const docNow = docRef.current;
      const host = hostsRef.current[pageNum - 1];
      if (!docNow || !host) return;
      const cached = cacheRef.current.get(key);
      if (cached) {
        host.replaceChildren(...cached.nodes);
        mountedKeys.current.set(pageNum, key);
        // refresh LRU recency
        cacheRef.current.delete(key);
        cacheRef.current.set(key, cached);
        setLayerTick((t) => t + 1);
        return;
      }

      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      try {
        const pdfjs = await import("pdfjs-dist");
        let page = pagesRef.current.get(pageNum);
        if (!page) {
          page = await docNow.getPage(pageNum);
          pagesRef.current.set(pageNum, page);
        }
        const s = settingsRef.current;
        const base = page.getViewport({ scale: 1 });
        baseRef.current.set(pageNum, { w: base.width, h: base.height });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = cssScale * dpr;
        const viewport = page.getViewport({ scale });
        const crop = s.pdfCrop ? (cropRef.current.get(pageNum) ?? null) : null;

        const cw = Math.max(1, Math.floor(viewport.width * (crop?.w ?? 1)));
        const ch = Math.max(1, Math.floor(viewport.height * (crop?.h ?? 1)));
        const offX = crop ? crop.x * viewport.width : 0;
        const offY = crop ? crop.y * viewport.height : 0;

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        if (!!s.pdfInvert) canvas.style.filter = "invert(1) hue-rotate(180deg) contrast(1.12)";
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cw, ch);
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: crop ? [1, 0, 0, 1, -offX, -offY] : undefined,
        } as never).promise;

        const nodes: HTMLElement[] = [canvas];

        // text layer — selection, copy, and search flashing
        try {
          const textViewport = page.getViewport({ scale: cssScale });
          const wrap = document.createElement("div");
          wrap.style.position = "absolute";
          wrap.style.inset = "0";
          wrap.style.overflow = "hidden";
          const container = document.createElement("div");
          container.className = "textLayer";
          container.style.setProperty("--scale-factor", String(cssScale));
          container.style.setProperty("--total-scale-factor", String(cssScale));
          container.style.position = "absolute";
          container.style.left = `${-(crop ? crop.x * textViewport.width : 0)}px`;
          container.style.top = `${-(crop ? crop.y * textViewport.height : 0)}px`;
          container.style.width = `${Math.floor(textViewport.width)}px`;
          container.style.height = `${Math.floor(textViewport.height)}px`;
          const textLayer = new (
            pdfjs as never as { TextLayer: new (o: unknown) => { render: () => Promise<void> } }
          ).TextLayer({
            textContentSource: page.streamTextContent(),
            container,
            viewport: textViewport,
          });
          await textLayer.render();
          wrap.appendChild(container);
          nodes.push(wrap);
        } catch (err) {
          console.warn("text layer failed", pageNum, err);
        }

        // link layer — internal destinations + external URLs
        try {
          const links = await buildLinkLayer(docNow, page, crop);
          if (links) nodes.push(links);
        } catch {
          /* link layer is best-effort */
        }

        const record: RenderedPage = { key, bytes: cw * ch * 4, nodes };
        cacheRef.current.set(key, record);
        cacheBytes.current += record.bytes;
        host.replaceChildren(...nodes);
        mountedKeys.current.set(pageNum, key);
        trimCache();
        // Text layer is live now — let stored text anchors resolve against it.
        setLayerTick((t) => t + 1);

        // First render of this page: learn its real box, and probe the crop.
        setSlots((prev) => {
          const next = [...prev];
          const effW = base.width * (crop?.w ?? 1);
          const effH = base.height * (crop?.h ?? 1);
          const cur = next[pageNum - 1];
          if (!cur || Math.abs(cur.w - effW) > 0.5 || Math.abs(cur.h - effH) > 0.5) {
            next[pageNum - 1] = { w: effW, h: effH };
            return next;
          }
          return prev;
        });

        if (s.pdfCrop && !cropRef.current.has(pageNum)) {
          const box = detectCrop(canvas);
          cropRef.current.set(pageNum, box);
          if (box) {
            mountedKeys.current.delete(pageNum);
            setRenderTick((t) => t + 1);
          }
        }
      } finally {
        inflight.current.delete(key);
      }
    },
    [trimCache],
  );

  // ----------------------------------------------------------------- load ---

  useEffect(() => {
    let cancelled = false;
    (async () => {
      installPdfJsPolyfill();
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

      const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
      taskRef.current = loadingTask;
      const doc = await loadingTask.promise;
      if (cancelled) {
        await loadingTask.destroy().catch(() => {});
        return;
      }
      docRef.current = doc;
      setDoc(doc);
      setNumPages(doc.numPages);

      const first = await doc.getPage(1);
      pagesRef.current.set(1, first);
      const vp = first.getViewport({ scale: 1 });
      baseRef.current.set(1, { w: vp.width, h: vp.height });
      setSlots(Array.from({ length: doc.numPages }, () => ({ w: vp.width, h: vp.height })));
      setSizedUpTo(1);

      // Learn every other page's real size now, in order and in batches, so a jump or a restored
      // position never counts a guessed height (see `sizedUpTo`).
      void (async () => {
        const BATCH = 48;
        for (let from = 2; from <= doc.numPages; from += BATCH) {
          if (cancelled) return;
          const to = Math.min(doc.numPages, from + BATCH - 1);
          const found = await Promise.all(
            Array.from({ length: to - from + 1 }, async (_, i) => {
              const n = from + i;
              try {
                const cached = pagesRef.current.get(n);
                const page = cached ?? (await doc.getPage(n));
                const box = page.getViewport({ scale: 1 });
                if (!cached) page.cleanup?.();
                return { n, w: box.width, h: box.height };
              } catch {
                return null; // keep the guess for this page; the render corrects it later
              }
            }),
          );
          if (cancelled) return;
          const current = slotsStateRef.current;
          const updates: { n: number; slot: PageSlot }[] = [];
          let shift = 0;
          for (const f of found) {
            if (!f) continue;
            baseRef.current.set(f.n, { w: f.w, h: f.h });
            const crop = settingsRef.current.pdfCrop ? (cropRef.current.get(f.n) ?? null) : null;
            const slot = { w: f.w * (crop?.w ?? 1), h: f.h * (crop?.h ?? 1) };
            const old = current[f.n - 1];
            if (old && Math.abs(old.w - slot.w) <= 0.5 && Math.abs(old.h - slot.h) <= 0.5) continue;
            updates.push({ n: f.n, slot });
            // A page above the one being read changing height would push the text away.
            if (restoredRef.current && f.n < currentPageRef.current) {
              const heightOf = (box: PageSlot) =>
                Math.round((pageWidthRef.current(box) * box.h) / (box.w || 1));
              shift += heightOf(slot) - (old ? heightOf(old) : 0);
            }
          }
          shiftRef.current += shift;
          if (updates.length) {
            setSlots((prev) => {
              const next = prev.slice();
              for (const u of updates) next[u.n - 1] = u.slot;
              return next;
            });
          }
          setSizedUpTo(to);
        }
      })();

      // outline → toc
      let toc: TocItem[] = [];
      try {
        const outline = await doc.getOutline();
        const mapItems = async (items: unknown[]): Promise<TocItem[]> =>
          Promise.all(
            (items ?? []).map(async (raw) => {
              const it = raw as {
                title?: string;
                dest?: unknown;
                items?: unknown[];
              };
              let href = "";
              try {
                let dest = it.dest;
                if (typeof dest === "string") dest = await doc.getDestination(dest);
                if (Array.isArray(dest) && dest[0]) {
                  const idx = await doc.getPageIndex(dest[0]);
                  href = `#page-${idx + 1}`;
                }
              } catch {
                /* dest unresolvable */
              }
              return {
                label: it.title ?? "Untitled",
                href,
                subitems: it.items?.length ? await mapItems(it.items) : undefined,
              };
            }),
          );
        toc = await mapItems((outline ?? []) as unknown[]);
      } catch {
        /* no outline */
      }
      if (cancelled) return;

      const scrollToPage = (page: number, smooth = false) => {
        const clamped = Math.min(doc.numPages, Math.max(1, Math.round(page)));
        const go = () => {
          const el = slotsRef.current[clamped - 1];
          const scroller = scrollRef.current;
          if (!el || !scroller) return;
          scroller.scrollTo({
            top: el.offsetTop - 16,
            behavior: smooth ? smoothScroll() : "auto",
          });
        };
        // Where page n sits is the sum of the heights above it, so wait for those to be real.
        if (sizedRef.current >= clamped - 1) go();
        else waitersRef.current.push({ upTo: clamped - 1, run: go });
      };

      onReady({
        toc,
        paged: true,
        typography: false,
        flowControl: false,
        // Normalized page rects survive zoom, DPR and re-render.
        annotations: "page-rect",
        // Text layer search across every page.
        search: true,
        // Phase 4: rotate / reorder / delete / extract / merge / split / export.
        pageOps: true,
        // Night mode for scans + auto-trim margins.
        imageAdjust: true,
        zoom: true,
        thumbnails: true,

        pageCount: doc.numPages,
      });

      /** One page's text, normalised: what the persisted index holds for it. */
      const extractText = async (p: number) => {
        if (p < 1 || p > doc.numPages) return "";
        const cached = pagesRef.current.get(p);
        const page = cached ?? (await doc.getPage(p));
        try {
          const content = await page.getTextContent();
          return normalizeText(
            content.items
              .map((it) =>
                typeof (it as { str?: unknown }).str === "string"
                  ? (it as { str: string }).str
                  : "",
              )
              .join(" "),
          );
        } finally {
          if (!cached) page.cleanup?.();
        }
      };

      /**
       * Tint the `occurrence`-th appearance of `match` on a page and bring it into view. False while
       * the page's text layer has not been drawn yet.
       *
       * The view goes to the top of the page, which keeps the "Page n of N" label true, unless the
       * match is below the fold of a page taller than the window: then it goes to the match.
       */
      const revealMatch = (page: number, match: string, occurrence: number): boolean => {
        const host = hostsRef.current[page - 1];
        const slot = slotsRef.current[page - 1];
        const scroller = scrollRef.current;
        if (!host || !slot || !scroller) return false;
        const leaves = Array.from(host.querySelectorAll<HTMLElement>(".textLayer span")).filter(
          (span) => !span.querySelector("span"),
        );
        if (!leaves.length) return false;
        const chosen = spansForOccurrence(
          leaves.map((span) => span.textContent ?? ""),
          match,
          occurrence,
        ).map((i) => leaves[i]);
        for (const span of chosen) {
          span.setAttribute(FLASH_ATTR, "1");
          span.style.background = "var(--reader-hit-strong)";
          span.style.borderRadius = "2px";
        }
        // The page's top edge goes 38px below the window's top: low enough that the bar over the
        // top of the window (56px) does not hide a match near the top of the page, and still above
        // the +40px line the current-page label is read from, so the label names this page.
        const pageTop = slot.offsetTop - 38;
        let top = pageTop;
        let left: number | undefined;
        const first = chosen[0];
        if (first) {
          const at = first.getBoundingClientRect();
          const box = scroller.getBoundingClientRect();
          const matchTop = slot.offsetTop + (at.top - slot.getBoundingClientRect().top);
          if (matchTop + at.height > pageTop + scroller.clientHeight - 24) {
            top = matchTop + at.height / 2 - scroller.clientHeight / 2;
          }
          // A zoomed page is wider than the window: bring the match across as well.
          if (at.left < box.left + 8 || at.right > box.right - 8) {
            left = scroller.scrollLeft + (at.left + at.width / 2) - (box.left + box.width / 2);
          }
        }
        scroller.scrollTo({
          top: Math.max(0, top),
          ...(left !== undefined ? { left: Math.max(0, left) } : {}),
          behavior: smoothScroll(),
        });
        return true;
      };
      /** The latest jump wins: a click on another result while this one is still waiting. */
      let hitSeq = 0;

      navRef.current = {
        next: () => scrollToPage(currentPageRef.current + 1, true),
        prev: () => scrollToPage(currentPageRef.current - 1, true),
        goTo: (href) => {
          const m = /^#page-(\d+)$/.exec(href);
          if (m) scrollToPage(parseInt(m[1], 10), true);
        },
        goToPage: (page) => scrollToPage(page, true),
        goToFraction: (f) => {
          const scroller = scrollRef.current;
          if (!scroller) return;
          scroller.scrollTo({
            top: f * (scroller.scrollHeight - scroller.clientHeight),
          });
        },
        goToAnchor: (anchor) => {
          if (anchor.kind !== "cfi") scrollToPage(anchor.page, true);
        },
        currentAnchor: () => ({
          kind: "rect" as const,
          page: currentPageRef.current,
          rects: [],
        }),
        extractPageText: extractText,
        search: async (query, run) => {
          const total = doc.numPages;
          for (let p = 1; p <= total; p++) {
            if (run.signal.aborted) return;
            let page = pagesRef.current.get(p);
            const cached = !!page;
            try {
              if (!page) page = await doc.getPage(p);
              const content = await page.getTextContent();
              const text = normalizeText(
                content.items
                  .map((it) =>
                    typeof (it as { str?: unknown }).str === "string"
                      ? (it as { str: string }).str
                      : "",
                  )
                  .join(" "),
              );
              const hits = findMatches(
                text,
                query,
                (offset) => ({ kind: "page" as const, page: p, offset }),
                `p${p}`,
                `Page ${p}`,
                run.options,
              );
              if (hits.length) run.onHits(hits);
            } catch {
              /* unreadable page — skip */
            } finally {
              // Don't grow the page cache just because we searched.
              if (!cached) page?.cleanup?.();
            }
            run.onProgress(p / total);
            // yield to the compositor so the drawer keeps painting
            await new Promise((r) => setTimeout(r, 0));
          }
        },
        clearSearch: () => {
          hitSeq++;
          clearFlash(hostsRef.current);
        },
        goToHit: (hit) => {
          if (hit.target.kind !== "page") return;
          const { page, offset } = hit.target;
          const match = hit.excerpt.match;
          const seq = ++hitSeq;
          clearFlash(hostsRef.current);
          void (async () => {
            // Which appearance of the phrase on the page this hit is: the offset says how far in,
            // and the page's text says how many came before.
            let occurrence = 0;
            if (offset != null) {
              try {
                occurrence = occurrenceBefore(await extractText(page), match, offset);
              } catch {
                /* the first appearance will do */
              }
            }
            if (seq !== hitSeq) return;
            // Already drawn: go straight to the match, with no stop at the top of the page.
            if (revealMatch(page, match, occurrence)) return;
            // Otherwise bring the page up and wait for its text layer.
            scrollToPage(page, true);
            for (let tries = 0; tries < 40 && seq === hitSeq; tries++) {
              await new Promise((r) => setTimeout(r, 160));
              if (seq === hitSeq && revealMatch(page, match, occurrence)) return;
            }
          })();
        },
        renderThumbnail: async (page, width) => {
          const key = `${page}@${width}`;
          const hit = thumbCache.current.get(key);
          if (hit) return hit;
          const docNow = docRef.current;
          if (!docNow || page < 1 || page > docNow.numPages) return null;
          try {
            const pdfPage = await docNow.getPage(page);
            const base = pdfPage.getViewport({ scale: 1 });
            const viewport = pdfPage.getViewport({ scale: width / base.width });
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await pdfPage.render({ canvas, canvasContext: ctx, viewport } as never).promise;
            const url = canvas.toDataURL("image/jpeg", 0.72);
            thumbCache.current.set(key, url);
            if (!pagesRef.current.has(page)) pdfPage.cleanup?.();
            return url;
          } catch {
            return null;
          }
        },
      };
    })().catch((err) => {
      console.error("pdf failed", err);
      if (!cancelled) onError("This PDF could not be opened. It may be corrupted or encrypted.");
    });

    return () => {
      cancelled = true;
      navRef.current = null;
      void taskRef.current?.destroy().catch(() => {});
      taskRef.current = null;
      docRef.current = null;
      pagesRef.current.clear();
      thumbCache.current.clear();
      clearCache();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the scroller width so "fit" and pan bounds stay correct.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => {
      setViewWidth(scroller.clientWidth);
      setViewHeight(scroller.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);

  // Crop toggled off → forget probes so pages render full-bleed again.
  useEffect(() => {
    if (!settings.pdfCrop) cropRef.current.clear();
    setRenderTick((t) => t + 1);
  }, [settings.pdfCrop, !!settings.pdfInvert]);

  // ------------------------------------------------------- render windowing --

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!doc || !scroller || slots.length === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const wanted = (pageNum: number) => {
      const slot = slots[pageNum - 1] ?? slots[0];
      const cssScale = pageWidth(slot) / (slot?.w || 1);
      return {
        cssScale,
        key: `${pageNum}:${scaleKey(cssScale, dpr, settings.pdfCrop, !!settings.pdfInvert)}`,
      };
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLDivElement;
          const pageNum = Number(el.dataset.page);
          if (!pageNum || !entry.isIntersecting) continue;
          const { key, cssScale } = wanted(pageNum);
          if (mountedKeys.current.get(pageNum) === key) continue;
          void renderPage(pageNum, key, cssScale).catch((err) =>
            console.warn("page render failed", pageNum, err),
          );
        }
      },
      { root: scroller, rootMargin: "800px 0px" },
    );

    slotsRef.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, slots, viewWidth, zoom, settings.pdfCrop, !!settings.pdfInvert, renderTick, renderPage]);

  // ------------------------------------------------------------ zoom/pan ----

  /**
   * Commit a zoom change while keeping the point under the cursor fixed.
   * The kernel owns settings, so the engine *requests* a zoom via `onZoom`.
   */
  const zoomAt = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const scroller = scrollRef.current;
      if (!scroller || !onZoom) return;
      const target = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const box = scroller.getBoundingClientRect();
      const px = (clientX ?? box.left + box.width / 2) - box.left;
      const py = (clientY ?? box.top + box.height / 2) - box.top;
      const cx = (scroller.scrollLeft + px) / Math.max(1, scroller.scrollWidth);
      const cy = (scroller.scrollTop + py) / Math.max(1, scroller.scrollHeight);
      onZoom(target);
      requestAnimationFrame(() => {
        const s = scrollRef.current;
        if (!s) return;
        s.scrollLeft = cx * s.scrollWidth - px;
        s.scrollTop = cy * s.scrollHeight - py;
      });
    },
    [onZoom],
  );

  const zoomRef = useRef<(z: number, x?: number, y?: number) => void>(zoomAt);
  zoomRef.current = zoomAt;

  // wheel + pinch gestures (non-passive, so the page never scrolls behind us)
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const currentScale = () => {
      const slot = slots[currentPageRef.current - 1] ?? slots[0];
      return zoom === "fit" ? pageWidth(slot) / (slot?.w || 1) : (zoom as number);
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomRef.current(currentScale() * Math.exp(-dy * 0.0018), e.clientX, e.clientY);
    };

    const points = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let startScale = 1;
    let center = { x: 0, y: 0 };

    const dist = () => {
      const [a, b] = [...points.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 2) {
        startDist = dist();
        startScale = currentScale();
        const [a, b] = [...points.values()];
        center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gestureRef.current = true;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size !== 2 || !startDist) return;
      e.preventDefault();
      const k = clamp(dist() / startDist, 0.2, 8);
      const content = contentRef.current;
      if (content) {
        // Cheap CSS preview during the gesture; the real re-render lands on end.
        const box = scroller.getBoundingClientRect();
        content.style.transformOrigin = `${center.x - box.left + scroller.scrollLeft}px ${
          center.y - box.top + scroller.scrollTop
        }px`;
        content.style.transform = `scale(${k})`;
      }
    };

    const endGesture = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return;
      const had = points.size === 2 && startDist > 0;
      const k = had ? clamp(dist() / startDist, 0.2, 8) : 1;
      points.delete(e.pointerId);
      if (!had) return;
      const content = contentRef.current;
      if (content) {
        content.style.transform = "";
        content.style.transformOrigin = "";
      }
      startDist = 0;
      gestureRef.current = false;
      zoomRef.current(startScale * k, center.x, center.y);
    };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("pointerdown", onDown);
    scroller.addEventListener("pointermove", onMove, { passive: false });
    scroller.addEventListener("pointerup", endGesture);
    scroller.addEventListener("pointercancel", endGesture);
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("pointerdown", onDown);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerup", endGesture);
      scroller.removeEventListener("pointercancel", endGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, zoom, viewWidth]);

  // Restore position once, after first layout
  useEffect(() => {
    if (!doc || restoredRef.current || slots.length === 0) return;
    // "Page n" is only a scroll offset once the pages above it have their real heights.
    const wantPage = progress?.page ? Math.min(progress.page, slots.length) : 1;
    if (sizedUpTo < wantPage - 1) return;
    restoredRef.current = true;
    requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      if (progress?.page) {
        const el = slotsRef.current[Math.min(progress.page, slots.length) - 1];
        if (el) scroller.scrollTop = el.offsetTop - 16;
      } else if (progress?.fraction) {
        scroller.scrollTop = progress.fraction * (scroller.scrollHeight - scroller.clientHeight);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, slots.length, sizedUpTo]);

  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller || !restoredRef.current) return;
    const mid = scroller.scrollTop + 40;
    let page = 1;
    for (let i = 0; i < slotsRef.current.length; i++) {
      const el = slotsRef.current[i];
      if (el && el.offsetTop <= mid) page = i + 1;
      else break;
    }
    currentPageRef.current = page;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const fraction = max > 0 ? scroller.scrollTop / max : 0;
    onProgress({
      fraction: Math.min(1, Math.max(0, fraction)),
      page,
      totalPages: numPages,
      label: `Page ${page} of ${numPages}`,
    });
  };

  /**
   * Convert the live text selection into an anchor.
   *
   * Preferred shape is a **text anchor** (page text offsets + quote/context),
   * which survives rotate, reorder and re-flatten. Rects are still computed for
   * the popover, and a rect anchor is the fallback when the page has no usable
   * text layer (pure scans).
   */
  const emitSelection = () => {
    const emit = selectRef.current;
    if (!emit || gestureRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const node =
      range.startContainer.nodeType === 1
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;
    const slot = node?.closest<HTMLElement>("[data-page]");
    const page = Number(slot?.dataset.page);
    if (!slot || !page) return;
    const box = slot.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const rects = normalizedRects(range, box);
    if (!rects.length) return;

    const map = buildPageTextMap(hostsRef.current[page - 1]);
    const offsets = map ? offsetsFromRange(map, range) : null;
    const anchor: AnnotationAnchor =
      map && offsets
        ? buildTextAnchor(map.text, page, offsets.start, offsets.end)
        : { kind: "rect", page, rects };

    const bounds = range.getBoundingClientRect();
    emit({
      anchor,
      text,
      rect: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    });
  };

  // ------------------------------------------------- text anchor → rects ----

  /**
   * Resolve stored text anchors against the page text of the *current* file.
   *
   * Runs after every page mount (layerTick) and after layout changes, so a
   * highlight re-finds itself even if the page was rotated, reordered or
   * re-saved. Failures report `orphaned: true` upward instead of vanishing.
   */
  useEffect(() => {
    const wanted = annotations.filter((a) => a.anchor.kind === "text" && isTextMark(a.type));
    if (!wanted.length) {
      if (textRects.size) setTextRects(new Map());
      return;
    }
    const frame = requestAnimationFrame(() => {
      const next = new Map<string, NormRect[]>();
      const orphanChanges: { id: string; orphaned: boolean }[] = [];
      for (const a of wanted) {
        if (a.anchor.kind !== "text") continue;
        const idx = a.anchor.page - 1;
        const host = hostsRef.current[idx];
        const slot = slotsRef.current[idx];
        const map = buildPageTextMap(host);
        // Page not rendered yet: keep whatever we had, decide nothing.
        if (!map || !slot) {
          const prev = textRectsRef.current.get(a.id);
          if (prev) next.set(a.id, prev);
          continue;
        }
        const resolved = resolveTextAnchor(map.text, a.anchor);
        const range = resolved ? rangeFromOffsets(map, resolved.start, resolved.end) : null;
        const rects = range ? normalizedRects(range, slot.getBoundingClientRect()) : [];
        if (rects.length) {
          next.set(a.id, rects);
          if (a.orphaned) orphanChanges.push({ id: a.id, orphaned: false });
        } else if (!a.orphaned) {
          orphanChanges.push({ id: a.id, orphaned: true });
        }
      }
      setTextRects(next);
      const report = orphanRef.current;
      if (report) for (const c of orphanChanges) report(c.id, c.orphaned);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, layerTick, slots, viewWidth, zoom, renderTick]);

  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);

  // Space after the last page: the window's height less the page's, so that page can be scrolled
  // to the top; never less than the usual bottom margin.
  const lastSlot = slots[slots.length - 1];
  const lastHeight = lastSlot
    ? Math.round((pageWidth(lastSlot) * lastSlot.h) / (lastSlot.w || 1))
    : 0;
  const tailPadding = Math.max(TAIL_MIN, viewHeight - lastHeight - 16);

  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations) {
    if (!isTextMark(a.type)) continue;
    if (a.anchor.kind === "rect") {
      const list = byPage.get(a.anchor.page) ?? [];
      list.push(a);
      byPage.set(a.anchor.page, list);
    } else if (a.anchor.kind === "text" && textRects.has(a.id)) {
      const list = byPage.get(a.anchor.page) ?? [];
      list.push(a);
      byPage.set(a.anchor.page, list);
    }
  }

  /**
   * Highlights sit under the text layer, which covers the whole page, so a click
   * never reaches a highlight's own element. Find the mark under the pointer by
   * geometry and open it the way its own element would. Only a plain single
   * click counts: the click that ends a drag, and a double or triple click, are
   * text selection. (The selection itself is not a test: the word just
   * highlighted is still selected when the reader clicks it to edit.)
   */
  const openMarkUnder = (e: React.MouseEvent) => {
    if (!isPlainClick({ detail: e.detail, x: e.clientX, y: e.clientY }, pointerDownAt.current)) {
      return;
    }
    const slot = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
    const page = Number(slot?.dataset.page);
    if (!slot || !page) return;
    const box = slot.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const onPage = byPage.get(page) ?? [];
    const hit = markAt(
      onPage.map((a) => ({
        id: a.id,
        rects: a.anchor.kind === "rect" ? a.anchor.rects : (textRects.get(a.id) ?? []),
      })),
      (e.clientX - box.left) / box.width,
      (e.clientY - box.top) / box.height,
    );
    const mark = hit && onPage.find((a) => a.id === hit.id);
    if (!hit || !mark) return;
    selectRef.current?.({
      anchor: mark.anchor,
      text: mark.text ?? "",
      rect: {
        x: box.left + hit.rect.x * box.width,
        y: box.top + hit.rect.y * box.height,
        width: hit.rect.w * box.width,
        height: hit.rect.h * box.height,
      },
      existingId: mark.id,
    });
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onPointerDown={(e) => {
        pointerDownAt.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => setTimeout(emitSelection, 0)}
      onClick={(e) => {
        const external = (e.target as HTMLElement).closest<HTMLElement>("a[data-external]");
        if (external) {
          e.preventDefault();
          requestExternalLink(external.getAttribute("href") ?? "");
          return;
        }
        const target = (e.target as HTMLElement).closest<HTMLElement>("[data-internal-page]");
        if (!target) {
          openMarkUnder(e);
          return;
        }
        e.preventDefault();
        const page = Number(target.dataset.internalPage);
        if (page) navRef.current?.goToPage?.(page);
      }}
      // A middle click raises auxclick, not click, and would open a tab unasked.
      onAuxClick={(e) => guardAuxClick(e.nativeEvent)}
      className="h-full w-full overflow-auto overscroll-contain"
      style={{ background: theme.bg, touchAction: "pan-x pan-y" }}
    >
      <div
        ref={contentRef}
        className="mx-auto flex w-max min-w-full flex-col items-center gap-4 px-4 py-20"
        // Room after the last page for it to be scrolled to the top of the window. Without it a page
        // shorter than the window (every page of a PDF on a phone) could not reach the top at the end
        // of the file, so the label stayed on the page before and "next page" did nothing visible.
        style={{ paddingBottom: tailPadding }}
      >
        {slots.map((slot, i) => {
          const w = pageWidth(slot);
          return (
            <div
              key={i}
              data-page={i + 1}
              ref={(el) => {
                slotsRef.current[i] = el;
              }}
              className="cover-shadow relative bg-white"
              style={{
                width: `${Math.round(w)}px`,
                height: `${Math.round((w * slot.h) / (slot.w || 1))}px`,
              }}
            >
              <div
                ref={(el) => {
                  hostsRef.current[i] = el;
                }}
                className="absolute inset-0 overflow-hidden"
              />
              <div className="pointer-events-none absolute inset-0">
                {(byPage.get(i + 1) ?? []).map((a) => {
                  const rects =
                    a.anchor.kind === "rect" ? a.anchor.rects : (textRects.get(a.id) ?? []);
                  return rects.map((r, ri) => (
                    <MarkRect
                      key={`${a.id}-${ri}`}
                      annotation={a}
                      rect={r}
                      onSelect={(clientRect) =>
                        selectRef.current?.({
                          anchor: a.anchor,
                          text: a.text ?? "",
                          rect: clientRect,
                          existingId: a.id,
                        })
                      }
                    />
                  ));
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Clickable internal destinations + external URLs for one page. */
async function buildLinkLayer(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  crop: CropBox | null,
): Promise<HTMLDivElement | null> {
  const raw = (await page.getAnnotations()) as unknown[];
  const items = raw.filter((a) => {
    const it = a as { subtype?: string };
    return it.subtype === "Link";
  });
  if (!items.length) return null;
  const view = page.getViewport({ scale: 1 });
  const layer = document.createElement("div");
  layer.style.position = "absolute";
  layer.style.inset = "0";
  // The text layer covers the whole page at z-index 2, so a link layer left at
  // the default level was never under the pointer: a click or tap landed on the
  // text, and only the keyboard reached a link. Sit above it, but let every
  // point outside an anchor fall through so text can still be selected.
  layer.style.zIndex = "3";
  layer.style.pointerEvents = "none";

  for (const raw of items) {
    const it = raw as {
      rect?: number[];
      url?: string;
      dest?: unknown;
      unsafeUrl?: string;
    };
    if (!it.rect) continue;
    const [x1, y1, x2, y2] = it.rect;
    const left = Math.min(x1, x2) / view.width;
    const right = Math.max(x1, x2) / view.width;
    const top = 1 - Math.max(y1, y2) / view.height;
    const bottom = 1 - Math.min(y1, y2) / view.height;
    const box = crop
      ? {
          x: (left - crop.x) / crop.w,
          y: (top - crop.y) / crop.h,
          w: (right - left) / crop.w,
          h: (bottom - top) / crop.h,
        }
      : { x: left, y: top, w: right - left, h: bottom - top };
    if (box.w <= 0 || box.h <= 0) continue;

    const el = document.createElement("a");
    el.style.position = "absolute";
    el.style.left = `${box.x * 100}%`;
    el.style.top = `${box.y * 100}%`;
    el.style.width = `${box.w * 100}%`;
    el.style.height = `${box.h * 100}%`;
    el.style.cursor = "pointer";
    el.style.pointerEvents = "auto";

    if (it.url) {
      el.href = it.url;
      el.target = "_blank";
      el.rel = "noreferrer noopener";
      // Opened only after the reader confirms (see the click handler).
      el.dataset.external = "1";
      el.setAttribute("aria-label", "External link");
    } else if (it.dest !== undefined && it.dest !== null) {
      try {
        let dest: unknown = it.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);

        if (Array.isArray(dest) && dest[0]) {
          const idx = await doc.getPageIndex(dest[0]);
          el.dataset.internalPage = String(idx + 1);
          el.href = `#page-${idx + 1}`;
          el.setAttribute("aria-label", `Go to page ${idx + 1}`);
        } else continue;
      } catch {
        continue;
      }
    } else continue;

    layer.appendChild(el);
  }
  return layer.childElementCount ? layer : null;
}

function MarkRect({
  annotation,
  rect,
  onSelect,
}: {
  annotation: Annotation;
  rect: NormRect;
  onSelect: (clientRect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const color = ANNOTATION_COLORS[annotation.color];
  const base: React.CSSProperties = {
    position: "absolute",
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
    pointerEvents: "auto",
    cursor: "pointer",
  };
  if (annotation.type === "highlight") {
    base.background = color;
    base.opacity = 0.38;
    base.mixBlendMode = "multiply";
  } else if (annotation.type === "underline") {
    base.borderBottom = `2px solid ${color}`;
  } else {
    base.backgroundImage = `linear-gradient(${color}, ${color})`;
    base.backgroundSize = "100% 2px";
    base.backgroundPosition = "0 50%";
    base.backgroundRepeat = "no-repeat";
  }
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`${annotation.type} annotation`}
      style={base}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onSelect({ x: r.x, y: r.y, width: r.width, height: r.height });
      }}
    />
  );
}
