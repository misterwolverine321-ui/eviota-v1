import { useCallback, useEffect, useRef, useState } from "react";
import { findMatches, normalizeText } from "@/lib/search";
import { FONT_STACKS, type TocItem } from "@/lib/reader-settings";
import { annotateHeadings } from "@/lib/markdown";
import { blockTextsOfBody, collectBlockElements, prepareRawView } from "@/lib/html-blocks";
import { buildTextUnits, unitPercentLabel, type TextUnits } from "@/lib/text-units";
import { isTallBlock, paintHit, rangeInBlock } from "@/lib/hit-locate";
import { hitFill } from "@/lib/reader-highlight";
import { buildDocTextMap, type DocTextMap } from "@/lib/doc-text-map";
import { extractCleanArticle } from "@/lib/clean-view";
import {
  anchorAtPoint,
  clearMarks,
  markIdAt,
  paintMarks,
  readSelection,
  selectionForMark,
  type MarkContext,
} from "./layers/text-marks";
import type { RendererProps } from "./foliate-reader";
import { paintSpoken } from "@/lib/spoken-highlight";
import { typographyCss } from "@/lib/typography";
import { REDUCED_MOTION_BOOK_CSS, smoothScroll } from "@/lib/motion";
import { pressStart, surfaceFraction, tapFraction, type PressStart } from "@/lib/tap-gesture";
import { CSP_META_HTML, hardenFragment } from "@/lib/safe-document";
import {
  guardAuxClick,
  recordSafeReport,
  requestExternalLink,
  resetSafeReport,
} from "@/lib/safe-report";

interface View {
  html: string;
  toc: TocItem[];
}

/** HTML / HTM engine: sandboxed iframe with injected reading typography. */
export function HtmlReader({
  file,
  fileName,
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
  onSurfaceTap,
  cleanView,
}: RendererProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const restored = useRef(false);
  /** Last reported reading fraction, so a view swap lands where you were. */
  const fractionRef = useRef(progress?.fraction ?? 0);
  const [raw, setRaw] = useState<View | null>(null);
  const [clean, setClean] = useState<View | null>(null);
  /** Bumped on every iframe load, so annotation painting re-runs. */
  const [loadTick, setLoadTick] = useState(0);
  const markCtx = useRef<MarkContext | null>(null);
  /** The raw document's blocks cut into index units (see `text-units.ts`); set once it is read. */
  const unitsRef = useRef<TextUnits | null>(null);

  const latest = useRef({
    onReady,
    onProgress,
    onError,
    onSelection,
    onOrphanChange,
    onSurfaceTap,
  });
  latest.current = { onReady, onProgress, onError, onSelection, onOrphanChange, onSurfaceTap };
  const dark = theme.id === "dusk";

  const active = cleanView && clean ? clean : raw;
  /** True while the page on screen is the document the search index was built from. */
  const rawActiveRef = useRef(true);
  rawActiveRef.current = active === raw;

  // ------------------------------------------------------------- load ----

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text = await file.text();
      if (cancelled) return;
      // Markdown rides the HTML engine: convert first, then treat it as a document like any
      // other. Safe mode: parse the whole page, remove scripts/handlers/remote references, and
      // keep only the body for our own shell. The shelf indexer calls the same function, so the
      // blocks it numbers are the blocks numbered here.
      const view = prepareRawView(text, fileName);
      const source = view.source;
      resetSafeReport();
      recordSafeReport("document", view.report);
      const { html, toc } = view;
      unitsRef.current = buildTextUnits(blockTextsOfBody(html));
      setRaw({ html, toc });

      // Extraction needs a real DOM and is synchronous once it starts, so it
      // runs only after the raw document has been handed to React — the page
      // is readable immediately and the clean version swaps in when ready.
      const article = await extractCleanArticle(source);
      if (cancelled || !article) return;
      // Re-run heading annotation on the extracted body so the TOC and the
      // search index describe whichever document is actually on screen.
      // Derived from the same source, so anything blocked here was already
      // counted for the document; it only needs cleaning, not reporting.
      const annotated = annotateHeadings(hardenFragment(article.html).html);
      setClean({ html: annotated.html, toc: annotated.toc });
    })().catch(() => latest.current.onError("This page could not be opened."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capabilities follow the active document: the TOC changes with the view,
  // and `cleanView` only becomes available once extraction succeeded.
  useEffect(() => {
    if (!active) return;
    latest.current.onReady({
      toc: active.toc,
      paged: false,
      typography: true,
      flowControl: false,
      annotations: "text",
      search: true,
      // The persisted search index describes the raw document, whichever view is showing.
      indexUnits: unitsRef.current?.count,
      indexKey: unitsRef.current?.signature,
      tts: true,
      autoScroll: true,
      cleanView: !!clean,
    });
  }, [active, clean]);

  const css = `
    @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
    ${REDUCED_MOTION_BOOK_CSS}
    body {
      margin: 0 auto; padding: 56px 24px; max-width: ${settings.maxWidth}px;
      touch-action: manipulation;
      background: ${theme.bg}; color: ${theme.ink};
      font-family: ${FONT_STACKS[settings.fontFamily]};
      font-size: ${settings.fontSize}px; line-height: ${settings.lineHeight};
      word-wrap: break-word;
    }
    ::highlight(eviota-hit) { background-color: ${hitFill()}; color: inherit; }
    img, svg, video, table { max-width: 100%; height: auto; }
    a { color: inherit; }
    pre { overflow-x: auto; }
    pre, code, kbd, samp { letter-spacing: normal; hyphens: manual; text-align: start; }
    ${typographyCss(settings)}
  `;

  const srcDoc =
    active === null
      ? null
      : `<!doctype html><html><head><meta charset="utf-8">${CSP_META_HTML}<base target="_blank"><style>${css}</style></head><body>${active.html}</body></html>`;

  // -------------------------------------------------------- annotations ---

  const frameOffset = useCallback(() => {
    const rect = frameRef.current?.getBoundingClientRect();
    return { x: rect?.left ?? 0, y: rect?.top ?? 0 };
  }, []);

  /** Rebuild the text map and repaint marks whenever the document changes. */
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    const body = doc?.body;
    if (!doc || !body) return;
    let map: DocTextMap | null;
    try {
      map = buildDocTextMap(body);
    } catch {
      map = null;
    }
    const ctx: MarkContext = { doc, host: body, map, frameOffset, dark };
    markCtx.current = ctx;
    paintMarks(ctx, annotations, latest.current.onOrphanChange);

    const emit = (event: Event) => {
      const id = markIdAt(event.target);
      if (id) {
        const record = annotations.find((a) => a.id === id);
        if (record) {
          latest.current.onSelection?.(selectionForMark(ctx, record, event.target as HTMLElement));
          return;
        }
      }
      // Give the browser a tick to finalize the selection after pointer-up.
      setTimeout(() => latest.current.onSelection?.(readSelection(ctx)), 0);
    };
    doc.addEventListener("pointerup", emit);

    const repaint = () => paintMarks(ctx, annotations, latest.current.onOrphanChange);
    const win = doc.defaultView;
    win?.addEventListener("resize", repaint);

    return () => {
      doc.removeEventListener("pointerup", emit);
      win?.removeEventListener("resize", repaint);
      clearMarks(ctx);
      markCtx.current = null;
    };
  }, [
    annotations,
    dark,
    loadTick,
    frameOffset,
    settings.fontSize,
    settings.lineHeight,
    settings.maxWidth,
    settings.fontFamily,
  ]);

  // ------------------------------------------------- scroll tracking + nav --

  const attach = () => {
    setLoadTick((t) => t + 1);
    const win = frameRef.current?.contentWindow;
    const doc = frameRef.current?.contentDocument;
    if (!win || !doc) return;

    const report = () => {
      const max = doc.documentElement.scrollHeight - win.innerHeight;
      const fraction = max > 0 ? Math.min(1, win.scrollY / max) : 0;
      fractionRef.current = fraction;
      onProgress({ fraction });
    };
    win.addEventListener("scroll", report, { passive: true });

    // Links never navigate the frame or open a window on their own: in-page
    // anchors scroll, anything external waits for the reader's confirmation.
    doc.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        let id = href.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          /* keep the raw fragment */
        }
        doc.getElementById(id)?.scrollIntoView({ behavior: smoothScroll(), block: "start" });
        return;
      }
      requestExternalLink(href);
    });
    // A middle click raises auxclick, not click, and would open a tab unasked.
    doc.addEventListener("auxclick", guardAuxClick);

    // Tap forwarding, as in the e-book engine: the page's taps never reach the
    // shell, so they are classified here and the shell decides what they do.
    let press: PressStart | null = null;
    doc.addEventListener("pointerdown", (ev) => {
      press = pressStart(ev);
    });
    doc.addEventListener("pointerup", (ev) => {
      const sel = doc.getSelection();
      const fraction = tapFraction(
        press,
        { x: ev.clientX, y: ev.clientY, time: ev.timeStamp },
        win.innerWidth,
        !!sel && !sel.isCollapsed,
      );
      press = null;
      if (fraction === null) return;
      const surface = surfaceFraction(win.frameElement, fraction);
      if (surface !== null) latest.current.onSurfaceTap?.(surface, ev.pointerType);
    });

    /** Index every text-bearing block once, so hits get stable node targets. */
    const indexBlocks = () =>
      collectBlockElements(doc).map((el) => ({ el, text: normalizeText(el.textContent ?? "") }));

    navRef.current = {
      next: () => win.scrollBy({ top: win.innerHeight * 0.9, behavior: smoothScroll() }),
      prev: () => win.scrollBy({ top: -win.innerHeight * 0.9, behavior: smoothScroll() }),
      // Auto-scroll drive: instant, un-animated nudges inside the iframe.
      scrollByPixels: (pixels) => win.scrollBy(0, pixels),
      // The document is one read-aloud unit; use whichever view is on screen.
      extractPageText: async () => (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim(),
      // The search index cuts the raw document into smaller units (see `text-units.ts`).
      extractIndexText: async (unit) => unitsRef.current?.texts[Math.round(unit) - 1] ?? "",
      unitLabel: (unit) => (unitsRef.current ? unitPercentLabel(unitsRef.current, unit) : ""),
      // The index describes the raw document; the extracted article has other blocks.
      indexUsable: () => rawActiveRef.current,
      // A shelf hit opens the book at the unit the index found it in.
      goToPage: (unit) => {
        const block = unitsRef.current?.firstBlock(unit);
        if (block != null && rawActiveRef.current) jumpToBlock(doc, block, undefined, "", "start");
      },
      // Sentence painting happens inside the iframe document.
      highlightSpoken: (text) => void paintSpoken(doc.body ?? doc, text, { scrollIntoView: true }),
      goToFraction: (f) => {
        const max = doc.documentElement.scrollHeight - win.innerHeight;
        win.scrollTo({ top: Math.max(0, max) * f });
      },

      // Contents entries are "#<heading id>" anchors inside the iframe.
      goTo: (href) => {
        const id = href.replace(/^.*#/, "");
        const el = id ? doc.getElementById(id) : null;
        el?.scrollIntoView({ behavior: smoothScroll(), block: "start" });
      },
      goToAnchor: (anchor) => {
        const ctx = markCtx.current;
        if (anchor.kind !== "text" || !ctx?.map) return;
        scrollToOffsets(ctx, anchor);
      },
      currentAnchor: () => {
        const ctx = markCtx.current;
        if (!ctx) return null;
        return anchorAtPoint(ctx, win.innerWidth / 2, 8);
      },
      search: async (query, run) => {
        const blocks = indexBlocks();
        for (let i = 0; i < blocks.length; i++) {
          if (run.signal.aborted) return;
          const hits = findMatches(
            blocks[i].text,
            query,
            (offset) => ({ kind: "node" as const, index: i, offset }),
            `h${i}`,
            undefined,
            run.options,
          );
          if (hits.length) run.onHits(hits);
          if (i % 64 === 0) {
            run.onProgress((i + 1) / blocks.length);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        run.onProgress(1);
      },
      clearSearch: () => clearFlash(doc),
      goToHit: (hit) => {
        const target = hit.target;
        const match = hit.excerpt.match;
        if (target.kind === "node") {
          jumpToBlock(doc, target.index, target.offset, match);
        } else if (target.kind === "page") {
          // A persisted-index hit: unit + offset into the unit's text -> block + offset.
          if (rawActiveRef.current) {
            const at = unitsRef.current?.locate(target.page, target.offset ?? 0);
            if (at) {
              jumpToBlock(doc, at.block, target.offset == null ? undefined : at.offset, match);
            }
          } else {
            // The extracted article has other blocks than the document the index was built from:
            // go to the first block that holds the words.
            const want = match.toLowerCase();
            const blocks = collectBlockElements(doc);
            const found = blocks.findIndex((b) =>
              (b.textContent ?? "").toLowerCase().includes(want),
            );
            if (found >= 0) jumpToBlock(doc, found, undefined, match);
          }
        }
      },
    };

    // First load restores stored progress; later loads (a clean-view swap)
    // restore whatever the reader was last looking at.
    const f = restored.current ? fractionRef.current : (progress?.fraction ?? 0);
    restored.current = true;
    if (f > 0.001) navRef.current.goToFraction?.(f);
  };

  return (
    <div className="h-full w-full" style={{ background: theme.bg }}>
      {srcDoc && (
        <iframe
          ref={frameRef}
          title="Document"
          srcDoc={srcDoc}
          onLoad={attach}
          sandbox="allow-same-origin allow-popups"
          className="h-full w-full border-0"
        />
      )}
    </div>
  );
}

/** Bring a resolved text anchor into view inside the iframe. */
function scrollToOffsets(
  ctx: MarkContext,
  anchor: Extract<import("@/lib/annotations").AnnotationAnchor, { kind: "text" }>,
): void {
  const map = ctx.map;
  if (!map) return;
  const index = Math.max(0, Math.min(map.text.length - 1, anchor.start));
  const node = map.nodes[map.owner[index]!];
  const el = node?.parentElement;
  el?.scrollIntoView({ behavior: smoothScroll(), block: "center" });
}

/** Drop the tint applied to the last jumped-to block, and the mark on the last match. */
function clearFlash(doc: Document | null) {
  doc?.querySelectorAll<HTMLElement>("[data-search-flash]").forEach((el) => {
    delete el.dataset.searchFlash;
    el.style.background = "";
  });
  if (doc) paintHit(doc, null);
}

/**
 * Bring block `index` into view, and show where the match is.
 *
 * An ordinary block is centred and tinted whole. A block taller than the window (a page that is one
 * long `<pre>` or paragraph) is no use to centre: the match could be anywhere in it, so the view
 * goes to the match's own line and only the matched words are marked.
 *
 * The tint is a literal colour, not `var(--reader-hit)`: this document is an iframe, and custom
 * properties set on the app's document do not reach into it.
 */
function jumpToBlock(
  doc: Document,
  index: number,
  offset: number | undefined,
  match: string,
  align: "center" | "start" = "center",
): boolean {
  const win = doc.defaultView;
  const el = collectBlockElements(doc)[index];
  if (!win || !el) return false;
  clearFlash(doc);
  if (align === "start") {
    // A unit start (a deep link), not a match: no tint.
    el.scrollIntoView({ behavior: "auto", block: "start" });
    return true;
  }
  if (offset != null && match && isTallBlock(el.getBoundingClientRect().height, win.innerHeight)) {
    const range = rangeInBlock(el, offset, match);
    const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
    if (range && rect) {
      win.scrollTo({
        top: Math.max(0, win.scrollY + rect.top - win.innerHeight * 0.4),
        behavior: smoothScroll(),
      });
      paintHit(doc, range);
      return true;
    }
  }
  el.scrollIntoView({ behavior: smoothScroll(), block: "center" });
  el.dataset.searchFlash = "1";
  el.style.background = hitFill();
  return true;
}
