import { assetUrl } from "@/lib/asset-url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RendererProps } from "./foliate-reader";
import type { RendererCaps } from "@/lib/reader-settings";
import type { ComicArchiveItem } from "@/lib/comic-cover";
import {
  AdjustCache,
  buildPanelsForEntry,
  enhanceTarget,
  isIdentityAdjust,
  SPREAD_ASPECT,
  type ComicPanel,
} from "@/lib/comic-image";
import { OcrClient } from "@/lib/ocr";
import {
  detectPanels,
  grayscaleFor,
  orderPanels,
  panelView,
  type PanelRect,
} from "@/lib/guided-view";
import { BookLoader } from "@/components/loading-book";
import { useComicZoom } from "@/hooks/use-comic-zoom";

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

/** Pages extracted before the reader starts batching state updates. */
const FAST_BATCH = 50;
/** Gap between the two halves of a spread, in px. */
const GAP = 6;
/**
 * Overflow-safe centring for the page row: the scroll surface is a grid, and
 * `margin: auto` on a max-content box centres it on both axes while the pages
 * fit, then collapses to 0 once they overflow — so a zoomed page can still be
 * scrolled all the way to its left and top edges (flex `justify-center` clips
 * that overflow away instead). Vertical `auto` margins only resolve inside a
 * grid/flex container, hence the `grid` on the surface.
 */
const centredContent: React.CSSProperties = {
  gap: GAP,
  width: "max-content",
  margin: "auto",
};

/**
 * Comic engine (CBZ / CBR / CB7): libarchive.js extraction plus a Phase 5
 * viewer — smart fit, spread splitting, manga (RTL) order and a worker-backed
 * brightness / contrast / sharpen pass. The kernel owns every setting; this
 * component only reads them.
 */
export function ComicReader({
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
  const [panels, setPanels] = useState<ComicPanel[]>([]);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const urlsRef = useRef<string[]>([]);
  const cacheRef = useRef(new AdjustCache());
  /** §6.4: OCR client + its per-page text cache, alive for this book only. */
  const ocrRef = useRef<OcrClient | null>(null);
  /** Read inside the extraction loop without re-running it. */
  const ocrOnRef = useRef(!!ocrEnabled);
  ocrOnRef.current = !!ocrEnabled;
  const [adjusted, setAdjusted] = useState<Record<string, string>>({});
  const latest = useRef({ onReady, onProgress, onError });
  latest.current = { onReady, onProgress, onError };

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  /**
   * The centring wrapper around the page(s). The zoom hook measures it to keep
   * the point under the cursor still, so it must be the element that actually
   * grows with the zoom.
   */
  const contentRef = useRef<HTMLDivElement | null>(null);
  const zoomer = useComicZoom(surfaceRef, contentRef);

  /**
   * Capabilities for a comic. `search` is only reachable when OCR is opted in:
   * the archive itself carries no text layer (§6.4).
   */
  const capsFor = (pageCount: number, ocr: boolean): RendererCaps => ({
    paged: true,
    typography: false,
    flowControl: false,
    annotations: false as const,
    search: ocr,
    spread: true,
    // Phase 5: worker-backed brightness/contrast/sharpen + manga RTL.
    imageAdjust: true,
    rtl: true,
    // §6.4: the engine can build a text layer from the pixels on request.
    ocr: true,
    pageCount,
  });

  const capsRef = useRef(capsFor);
  capsRef.current = capsFor;

  const adjust = useMemo(
    () => ({
      brightness: settings.brightness,
      contrast: settings.contrast,
      sharpen: settings.sharpen,
    }),
    [settings.brightness, settings.contrast, settings.sharpen],
  );

  // Track the untransformed surface size; panel layout is computed from it.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Archive } = await import("libarchive.js");
      Archive.init({
        workerUrl: assetUrl("vendor/libarchive/worker-bundle.js"),
      });
      // libarchive.js declares `open` for a File; it reads only the bytes, so the stored Blob works.
      const archive = await Archive.open(file as File);
      const flat: ComicArchiveItem[] = await archive.getFilesArray();
      const items = flat
        .map((item) => ({
          name: `${item.path ?? ""}${item.file?.name ?? ""}`,
          file: item.file,
        }))
        .filter((it) => IMAGE_RE.test(it.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      if (cancelled) return;
      if (items.length === 0) {
        latest.current.onError("No readable images were found in this archive.");
        return;
      }
      setTotal(items.length);

      // Publish panels as they are extracted so page 1 renders immediately and
      // the rest of the archive streams in behind it. The first FAST_BATCH
      // pages publish one at a time (instant first paint, fast early paging);
      // after that we commit in chunks so a 900-page archive doesn't spend its
      // time re-rendering React instead of decoding.
      const built: ComicPanel[] = [];
      let startApplied = false;
      let sinceCommit = 0;
      for (const item of items) {
        const blob: Blob = await item.file.extract();
        if (cancelled) return;
        const made = await buildPanelsForEntry(
          { name: item.name, blob },
          { split: settings.splitSpreads, track: (url: string) => urlsRef.current.push(url) },
        );
        if (cancelled) return;
        built.push(...made);
        sinceCommit += made.length;
        const chunk = built.length <= FAST_BATCH ? 1 : 16;
        if (sinceCommit >= chunk) {
          sinceCommit = 0;
          setPanels([...built]);
        }
        if (!startApplied) {
          startApplied = true;
          latest.current.onReady(capsRef.current(items.length, ocrOnRef.current));
          // Hand the frame back so the first page actually paints.
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (cancelled) return;
      setPanels([...built]);
      const start = Math.min(
        built.length - 1,
        Math.round((progress?.fraction ?? 0) * (built.length - 1)),
      );
      setIndex(Math.max(0, start));
      latest.current.onReady(capsRef.current(built.length, ocrOnRef.current));
    })().catch((err) => {
      console.error("comic failed", err);
      if (!cancelled)
        latest.current.onError(
          "This archive could not be opened. It may use an unsupported compression method.",
        );
    });

    return () => {
      cancelled = true;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
    };
    // Re-extract when spread splitting changes the panel model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.splitSpreads]);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => cache.dispose();
  }, []);

  // §6.4: re-declare capabilities when the OCR opt-in flips, so the kernel
  // starts (or stops) treating this book as searchable without a remount.
  useEffect(() => {
    if (panels.length === 0) return;
    latest.current.onReady(capsFor(panels.length, !!ocrEnabled));
  }, [ocrEnabled, panels.length]);

  // The OCR client (and its page-text cache) only exists while OCR is on.
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

  const step = settings.spread ? 2 : 1;

  // ---------------------------------------------------- guided view (§15.4) --
  // Panels are detected on the page currently on screen; stepping walks them in
  // reading order, and the step after the last one returns to the fitted page
  // before the next tap turns it. Only in single-page mode: a spread has two
  // independent panel grids and no sensible single reading order.
  const guidedOn = settings.guidedView && !settings.spread;
  const [rects, setRects] = useState<PanelRect[]>([]);
  const [panelIdx, setPanelIdx] = useState(-1);
  const pageElRef = useRef<HTMLElement | null>(null);
  /** The page currently on screen — its pixel size drives the panel zoom. */
  const currentPanel = settings.spread ? null : (panels[index] ?? null);
  const panelRef = useRef<ComicPanel | null>(currentPanel);
  panelRef.current = currentPanel;
  /** Read by the nav callbacks without re-creating them on every step. */
  const guidedRef = useRef({ on: false, rects: [] as PanelRect[], idx: -1, fromEnd: false });
  guidedRef.current.on = guidedOn;
  guidedRef.current.rects = rects;
  guidedRef.current.idx = panelIdx;

  const boxRef = useRef(box);
  boxRef.current = box;
  const fitRef = useRef(settings.comicFit);
  fitRef.current = settings.comicFit;
  const focusOn = zoomer.focusOn;

  /** Zoom to panel `i` of the current page, or back to the fitted page. */
  const showPanel = useCallback(
    (i: number) => {
      const list = guidedRef.current.rects;
      const rect = list[i];
      const pageEl = pageElRef.current;
      const panel = panelRef.current;
      setPanelIdx(i);
      if (!rect || !pageEl || !panel) {
        zoomer.reset();
        return;
      }
      const fit = fittedSize(fitRef.current, panel, boxRef.current, 1, 1);
      if (!fit) return;
      const view = { w: Math.max(1, boxRef.current.w - 24), h: Math.max(1, boxRef.current.h - 24) };
      const { zoom } = panelView(rect, fit, view);
      focusOn(zoom, (el) => {
        const target = pageElRef.current;
        if (!target) return null;
        const r = target.getBoundingClientRect();
        const c = el.getBoundingClientRect();
        return {
          x: el.scrollLeft + (r.left - c.left) + (rect.x + rect.w / 2) * r.width,
          y: el.scrollTop + (r.top - c.top) + (rect.y + rect.h / 2) * r.height,
        };
      });
    },
    [focusOn, zoomer],
  );

  const showPanelRef = useRef(showPanel);
  showPanelRef.current = showPanel;

  useEffect(() => {
    navRef.current = {
      next: () => {
        const g = guidedRef.current;
        if (g.on && g.rects.length > 1 && g.idx < g.rects.length) {
          // …last panel → fitted page → only then the page turns.
          showPanelRef.current(g.idx + 1);
          return;
        }
        g.fromEnd = false;
        setIndex((i) => Math.min(panels.length - 1, i + step));
      },
      prev: () => {
        const g = guidedRef.current;
        if (g.on && g.rects.length > 1 && g.idx > 0) {
          showPanelRef.current(g.idx - 1);
          return;
        }
        // Stepping back off the first panel lands on the previous page's last.
        g.fromEnd = g.on;
        setIndex((i) => Math.max(0, i - step));
      },
      goToFraction: (f) => setIndex(Math.round(f * Math.max(0, panels.length - 1))),
      goToPage: (page) => setIndex(Math.min(panels.length - 1, Math.max(0, Math.round(page) - 1))),
      goToHit: (hit) => {
        if (hit.target.kind !== "page") return;
        setIndex(Math.min(panels.length - 1, Math.max(0, hit.target.page - 1)));
      },
      // §6.4: the kernel's index builder pulls page text from here. One page at
      // a time, cached per panel — recognition is minutes of CPU for a book.
      ...(ocrEnabled
        ? {
            extractPageText: async (page: number) => {
              const panel = panels[page - 1];
              const client = ocrRef.current;
              if (!panel || !client) return "";
              return client.recognize(
                panel.id,
                async () => (await fetch(panel.url)).blob(),
                panel.part,
              );
            },
          }
        : {}),
    };
    return () => {
      navRef.current = null;
    };
  }, [navRef, panels, step, ocrEnabled]);

  // Scan the page on screen for panels whenever guided view is on (or the page
  // turns). Detection runs on a downscaled grayscale copy, so it is cheap; when
  // it is unavailable (no OffscreenCanvas) the reader silently keeps paging
  // whole pages. A page turn starts on the first panel — or the last one, when
  // the reader stepped backwards onto the page.
  useEffect(() => {
    if (!guidedOn || !currentPanel) {
      setRects([]);
      setPanelIdx(-1);
      return;
    }
    let cancelled = false;
    void (async () => {
      const crop = currentPanel.part ? { x: currentPanel.part === "l" ? 0 : 0.5, w: 0.5 } : null;
      const scan = await grayscaleFor(currentPanel.url, crop);
      if (cancelled) return;
      if (!scan) {
        setRects([]);
        setPanelIdx(-1);
        return;
      }
      const found = orderPanels(detectPanels(scan.gray, scan.width, scan.height), settings.manga);
      if (cancelled) return;
      setRects(found);
      guidedRef.current.rects = found;
      const fromEnd = guidedRef.current.fromEnd;
      guidedRef.current.fromEnd = false;
      if (found.length > 1) showPanelRef.current(fromEnd ? found.length - 1 : 0);
      else setPanelIdx(-1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedOn, currentPanel, settings.manga]);

  useEffect(() => {
    if (panels.length === 0) return;
    onProgress({
      fraction: panels.length > 1 ? index / (panels.length - 1) : 1,
      page: index + 1,
      totalPages: panels.length,
      label: `${index + 1} / ${panels.length}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, panels.length]);

  const visible = useMemo(
    () => (settings.spread ? panels.slice(index, index + 2) : panels.slice(index, index + 1)),
    [panels, index, settings.spread],
  );

  // A page turn — or a new fit mode, which re-lays out the page at a different
  // base size — returns to the fitted view.
  const resetZoom = zoomer.reset;
  useEffect(() => {
    resetZoom();
  }, [index, settings.comicFit, resetZoom]);

  // Adjust the visible window (plus one page ahead) in the worker.
  useEffect(() => {
    if (isIdentityAdjust(adjust)) {
      setAdjusted({});
      return;
    }
    let cancelled = false;
    const window = panels.slice(index, index + step + 1);
    void (async () => {
      for (const panel of window) {
        const url = await cacheRef.current.request(panel, adjust);
        if (cancelled || !url) continue;
        setAdjusted((prev) => ({ ...prev, [panel.id]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panels, index, step, adjust]);

  // Phase 15 — sharp zoom. Once the zoom settles we re-render the visible
  // pages at their true device-pixel size with a Lanczos resample + unsharp
  // pass, so magnified text keeps hard edges instead of the browser's blur.
  const [sharp, setSharp] = useState<Record<string, string>>({});
  const sharpCacheRef = useRef(new AdjustCache());
  useEffect(() => {
    const cache = sharpCacheRef.current;
    return () => cache.dispose();
  }, []);

  useEffect(() => {
    // Back at fit the browser's own downscale is already correct, and the
    // enhanced render is both pointless and the heaviest image in memory — drop
    // it so a fitted page is never the sharpened one.
    if (!settings.enhance || box.w === 0 || zoomer.zoom <= 1.01) {
      setSharp({});
      return;
    }
    let cancelled = false;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const window_ = panels.slice(index, index + step);
    const timer = setTimeout(() => {
      void (async () => {
        for (const panel of window_) {
          const size = fittedSize(settings.comicFit, panel, box, window_.length, zoomer.zoom);
          if (!size) continue;
          const target = enhanceTarget(panel, size, dpr);
          if (!target) continue;
          const url = await sharpCacheRef.current.request(panel, {
            ...adjust,
            scaleTo: target,
            enhance: settings.enhanceAmount,
          });
          if (cancelled || !url) continue;
          setSharp((prev) => ({ ...prev, [panel.id]: url }));
        }
      })();
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    panels,
    index,
    step,
    box,
    adjust,
    zoomer.zoom,
    settings.enhance,
    settings.enhanceAmount,
    settings.comicFit,
  ]);

  // A page turn drops the previous page's sharp renders from the DOM.
  useEffect(() => {
    setSharp({});
  }, [index]);

  // Manga mode reverses the visual order of a spread; indices stay LTR.
  const ordered = settings.manga ? [...visible].reverse() : visible;

  // Single tap turns the page, but only after a double-tap window has passed
  // (a double tap is a zoom gesture, not two page turns).
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTap = () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = null;
  };
  useEffect(() => clearTap, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (zoomer.dragged() || zoomer.pinching()) return;
      // A manual zoom turns taps into panning only; guided view is different —
      // it is *always* zoomed into a panel, and a tap is how you step to the
      // next one.
      const guidedActive = guidedRef.current.on && guidedRef.current.rects.length > 1;
      if (zoomer.zoomed && !guidedActive) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const rightHalf = e.clientX - rect.left > rect.width / 2;
      // In manga mode the left half advances.
      const forward = settings.manga ? !rightHalf : rightHalf;
      clearTap();
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        if (forward) navRef.current?.next();
        else navRef.current?.prev();
      }, 230);
    },
    [navRef, settings.manga, zoomer],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      clearTap();
      zoomer.toggleAt(e.clientX, e.clientY);
    },
    [zoomer],
  );

  const sizes = ordered.map((p) =>
    fittedSize(settings.comicFit, p, box, ordered.length, zoomer.zoom),
  );

  return (
    <div
      ref={surfaceRef}
      className={`grid h-full w-full overflow-auto overscroll-contain p-3 ${
        zoomer.zoomed ? "cursor-grab" : ""
      }`}
      // touch-action: none — the zoom hook owns every touch gesture itself
      // (one-finger pan, two-finger pinch), so the browser must not claim them.
      style={{ background: theme.bg, touchAction: "none" }}
      data-comic-fit={settings.comicFit}
      data-comic-manga={settings.manga ? "true" : "false"}
      data-comic-zoom={zoomer.zoom.toFixed(2)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...zoomer.panHandlers}
    >
      {panels.length === 0 ? (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ color: theme.sub }}
        >
          <BookLoader label="Extracting pages" sub={total ? `0 / ${total}` : undefined} />
        </div>
      ) : (
        <div ref={contentRef} className="flex items-center" style={centredContent}>
          {ordered.map((p, i) => {
            const size = sizes[i];
            const style = size
              ? { width: `${size.w}px`, height: `${size.h}px` }
              : { aspectRatio: `${p.width} / ${p.height}` };
            // Guided view aims the zoom at a rect inside the page box, so the
            // element showing the current page reports its own geometry.
            const pageRef = (el: HTMLElement | null) => {
              if (p.id === currentPanel?.id) pageElRef.current = el;
            };
            return p.part ? (
              // Split spread: crop with CSS instead of re-encoding the half.
              // The wrapper shows one half of a double-width image, so there
              // is still exactly one <img> per panel.
              <div
                key={p.id}
                ref={pageRef}
                className="relative shrink-0 overflow-hidden"
                style={style}
              >
                <img
                  src={sharp[p.id] ?? adjusted[p.id] ?? p.url}
                  alt={`Page ${panels.indexOf(p) + 1} of ${panels.length}, ${
                    p.part === "l" ? "left" : "right"
                  } half`}
                  className="absolute inset-y-0 h-full w-auto max-w-none select-none"
                  style={{ left: p.part === "l" ? 0 : "-100%" }}
                  draggable={false}
                />
              </div>
            ) : (
              <img
                key={p.id}
                ref={pageRef}
                src={sharp[p.id] ?? adjusted[p.id] ?? p.url}
                alt={`Page ${panels.indexOf(p) + 1} of ${panels.length}`}
                className="shrink-0 select-none object-contain"
                style={style}
                draggable={false}
              />
            );
          })}
        </div>
      )}
      {panels.length > 0 && total > 0 && panels.length < total && (
        <div className="pointer-events-none fixed right-4 bottom-16 flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] tabular-nums backdrop-blur">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          {panels.length} / {total}
        </div>
      )}
    </div>
  );
}

/**
 * Layout size (CSS px) for one panel at the current fit and zoom level.
 *
 * The panel is *laid out* at this size rather than transform-scaled, so the
 * browser resamples the source bitmap at the displayed resolution and zooming
 * sharpens instead of blurring. Returns null until the surface is measured, so
 * the first paint can fall back to aspect-ratio sizing.
 */
export function fittedSize(
  fit: string,
  panel: { width: number; height: number },
  box: { w: number; h: number },
  count: number,
  zoom: number,
): { w: number; h: number } | null {
  if (!box.w || !box.h || !panel.width || !panel.height) return null;
  const pad = 24; // p-3 on both sides
  const availW = (box.w - pad - GAP * (count - 1)) / count;
  const availH = box.h - pad;
  const ar = panel.width / panel.height;
  const landscape = ar >= SPREAD_ASPECT;
  const resolved = fit === "smart" ? (landscape ? "width" : "height") : fit;

  let w: number;
  let h: number;
  switch (resolved) {
    case "width":
      w = availW;
      h = w / ar;
      break;
    case "height":
      h = availH;
      w = h * ar;
      break;
    case "original":
      w = panel.width;
      h = panel.height;
      break;
    case "screen":
    default: {
      const k = Math.min(availW / panel.width, availH / panel.height);
      w = panel.width * k;
      h = panel.height * k;
    }
  }
  // Smart fit must never overflow the frame: a wide double-page scan fitted to
  // the width would otherwise start taller than the screen and read as if it
  // were already zoomed in. Shrink it so the whole page is visible at zoom 1.
  if (fit === "smart") {
    const k = Math.min(1, availW / w, availH / h);
    w *= k;
    h *= k;
  }
  return { w: Math.round(w * zoom), h: Math.round(h * zoom) };
}

/**
 * Fit strategy → image sizing classes. `smart` fits height for portrait pages
 * and width for landscape ones, so split spreads and normal pages both fill
 * the frame.
 */
export function fitClass(fit: string, panel: { width: number; height: number }): string {
  const base = "object-contain select-none";
  const landscape =
    panel.width > 0 && panel.height > 0 && panel.width / panel.height >= SPREAD_ASPECT;
  const resolved = fit === "smart" ? (landscape ? "width" : "height") : fit;
  switch (resolved) {
    case "width":
      return `w-full h-auto max-w-full ${base}`;
    case "height":
      return `h-full w-auto ${base}`;
    case "original":
      return `max-w-none max-h-none ${base}`;
    case "screen":
    default:
      return `max-h-full max-w-full ${base}`;
  }
}

/**
 * Sizing for the CSS-clip wrapper around a split spread half. The wrapper
 * carries the half's aspect ratio, so one axis is enough to size it.
 */
export function clipWrapperClass(fit: string): string {
  switch (fit) {
    case "width":
      return "w-full h-auto max-w-full";
    case "original":
      return "h-auto w-auto";
    case "height":
    case "smart":
    case "screen":
    default:
      return "h-full w-auto max-w-full";
  }
}
