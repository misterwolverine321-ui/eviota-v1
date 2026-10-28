import { useEffect, useRef } from "react";
import type { Overlayer } from "foliate-js/overlayer.js";
import type {
  BookSection,
  CreateOverlayDetail,
  DrawAnnotationDetail,
  LastLocation,
  LoadDetail,
  ShowAnnotationDetail,
  View,
} from "foliate-js/view.js";
import type { BookProgress } from "@/lib/db";
import type { Annotation, SelectionEvent } from "@/lib/annotations";
import { annotationPaint, ANNOTATION_COLORS } from "@/lib/annotations";
import {
  buildDocTextMap,
  offsetsFromRange,
  rangeFromOffsets,
  type DocTextMap,
} from "@/lib/doc-text-map";
import { buildTextAnchor, resolveTextAnchor } from "@/lib/text-anchor";
import { confirmMatchStart } from "@/lib/hit-locate";
import { labelFromView } from "@/lib/section-labels";
import { paintSpoken } from "@/lib/spoken-highlight";
import { hitFill } from "@/lib/reader-highlight";
import {
  FONT_STACKS,
  type NavApi,
  type ProgressUpdate,
  type RendererCaps,
  type ReaderSettings,
  type ReaderTheme,
} from "@/lib/reader-settings";
import { guardBook } from "@/lib/guard-book";
import { REDUCED_MOTION_BOOK_CSS } from "@/lib/motion";
import { bookFontFaces } from "@/lib/book-fonts";
import { normalizeRange } from "@/lib/normalize-range";
import {
  guardAuxClick,
  recordSafeReport,
  requestExternalLink,
  resetSafeReport,
} from "@/lib/safe-report";

export interface RendererProps {
  file: Blob;
  fileName: string;
  settings: ReaderSettings;
  theme: ReaderTheme;
  progress?: BookProgress | null;
  onReady: (caps: RendererCaps) => void;
  onProgress: (p: ProgressUpdate) => void;
  onError: (message: string) => void;
  navRef: React.RefObject<NavApi | null>;
  /** Annotations for this book. Engines render them; the kernel owns them. */
  annotations?: Annotation[];
  /** Emitted when the user selects text or taps an existing mark. */
  onSelection?: (selection: SelectionEvent | null) => void;
  /**
   * A tap on the reading surface, as a fraction of the surface width.
   * Needed because book content renders inside iframes, so taps there
   * never reach the shell's own pointer handlers. The shell decides what
   * the tap means (center toggles chrome, edges are ignored).
   */
  onSurfaceTap?: (xFraction: number) => void;
  /**
   * Phase 4.3: a text anchor either re-resolved or could not be found on its
   * page. The kernel persists the `orphaned` flag; engines never write records.
   */
  onOrphanChange?: (id: string, orphaned: boolean) => void;
  /**
   * A text anchor that has no CFI of its own (an old mark whose wrong one was dropped by the
   * repair, or one made before a CFI could be derived) was resolved, and this is the CFI of
   * the range as it now sits in the section. The kernel keeps it as the jump hint.
   */
  onAnchorCfi?: (id: string, cfi: string) => void;

  /**
   * Request a zoom level (Phase 4). Engines never write settings themselves —
   * gesture handlers call this and the kernel persists `pdfScale`.
   */
  onZoom?: (scale: number | "fit") => void;

  /**
   * Phase 6.1: charset override for engines that decode raw bytes. When unset
   * the engine sniffs the encoding itself and reports it through `caps`.
   */
  encoding?: string | null;

  /**
   * Phase 6.2: render the extracted article body instead of the original
   * document. Only meaningful when the engine reports `caps.cleanView`.
   */
  cleanView?: boolean;

  /**
   * §6.4: OCR is opted in for this book, so an image-only engine may expose
   * `extractPageText` and declare `search`.
   */
  ocrEnabled?: boolean;
}

/** Stylesheet injected into every book document. */
const buildCss = (s: ReaderSettings, t: ReaderTheme) => `
@namespace epub "http://www.idpf.org/2007/ops";
${bookFontFaces()}
html, body {
  background: ${t.bg} !important;
  color: ${t.ink} !important;
}
body {
  font-family: ${FONT_STACKS[s.fontFamily]} !important;
  font-size: ${s.fontSize}px !important;
  line-height: ${s.lineHeight} !important;
  letter-spacing: ${(s.letterSpacing / 100).toFixed(3)}em !important;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  hanging-punctuation: first last;
}
* { background-color: transparent !important; }
p, li, blockquote, dd, dt, td, th, figcaption, span, div, section, article {
  color: ${t.ink} !important;
}
p, li, blockquote, dd, dt {
  font-family: ${FONT_STACKS[s.fontFamily]} !important;
  line-height: ${s.lineHeight} !important;
  text-align: ${s.textAlign === "justify" ? "justify" : "start"} !important;
  hyphens: ${s.hyphenate ? "auto" : "manual"} !important;
  -webkit-hyphens: ${s.hyphenate ? "auto" : "manual"} !important;
  overflow-wrap: break-word;
  orphans: 2;
  widows: 2;
}
p + p {
  margin-top: ${(s.paragraphSpacing / 10).toFixed(2)}em !important;
  text-indent: ${s.paragraphIndent && s.paragraphSpacing === 0 ? "1.2em" : "0"} !important;
}
h1, h2, h3, h4, h5, h6 {
  font-family: ${FONT_STACKS[s.fontFamily]} !important;
  color: ${t.ink} !important;
  line-height: 1.35 !important;
}
a { color: inherit !important; text-decoration: underline; }
img, svg { max-width: 100% !important; }
${REDUCED_MOTION_BOOK_CSS}`;

function applyLayout(view: View, s: ReaderSettings, t: ReaderTheme, host: HTMLElement | null) {
  if (host) {
    host.style.background = t.bg;
    host.classList.toggle("reader-invert", !!view.isFixedLayout && t.id === "dusk");
  }
  const r = view.renderer;
  if (!r || view.isFixedLayout) return;
  r.setAttribute("flow", s.flow);
  // Margins scale with the viewport so wide screens breathe and phones don't
  // lose half their width to gutters.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const margin = Math.round(Math.min(72, Math.max(20, vw * 0.045)));
  r.setAttribute("margin", `${margin}px`);
  r.setAttribute("gap", "8%");
  r.setAttribute("max-inline-size", `${s.maxWidth}px`);
  // "Two pages" in the Display tab maps to a two-column spread; paginated
  // flow only, since scrolled flow has no columns.
  const twoUp = s.spread && s.flow !== "scrolled";
  r.setAttribute("max-column-count", twoUp ? "2" : "1");
  r.setStyles?.(buildCss(s, t));
}

/**
 * foliate draws highlights into an empty `<svg>` laid over the page. Left alone, the browser lists
 * it as an unnamed image; it carries nothing a reader needs, so it is hidden from assistive
 * technology.
 */
function hideOverlays(view: {
  renderer?: { getContents?: () => { overlayer?: { element?: Element } }[] };
}) {
  try {
    for (const content of view.renderer?.getContents?.() ?? []) {
      content.overlayer?.element?.setAttribute("aria-hidden", "true");
    }
  } catch {
    /* the renderer is between sections */
  }
}

/** foliate-js engine: EPUB, MOBI, AZW/AZW3, FB2, CBZ. */
export function FoliateReader({
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
  onAnchorCfi,
  onSurfaceTap,
}: RendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const overlayerRef = useRef<typeof Overlayer | null>(null);
  /** Live annotation map keyed by the CFI foliate currently draws it under. */
  const annotRef = useRef<Map<string, Annotation>>(new Map());
  /** Text-anchored marks by id — resolved per section against the live DOM. */
  const textAnnotRef = useRef<Map<string, Annotation>>(new Map());
  /** id → CFI currently registered with foliate for a text anchor. */
  const resolvedRef = useRef<Map<string, string>>(new Map());
  /** Flattened text + node map per section index, built on section load. */
  const mapsRef = useRef<Map<number, DocTextMap>>(new Map());
  /** Document of the section foliate currently shows, for spoken highlighting. */
  const sectionDocRef = useRef<Document | null>(null);
  /** Section index of the document a selection is being made in. */
  const drawnRef = useRef<Set<string>>(new Set());
  const readyRef = useRef(false);
  const resolveSectionRef = useRef<((index: number) => void) | null>(null);
  /** Marks whose CFI was already reported this session, so each is reported once. */
  const reportedCfiRef = useRef<Set<string>>(new Set());
  const latest = useRef({
    onReady,
    onProgress,
    onError,
    onSelection,
    onOrphanChange,
    onAnchorCfi,
    onSurfaceTap,
  });
  latest.current = {
    onReady,
    onProgress,
    onError,
    onSelection,
    onOrphanChange,
    onAnchorCfi,
    onSurfaceTap,
  };
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    let cancelled = false;
    let createdView: View | undefined;
    let disposeGuard: (() => void) | undefined;

    (async () => {
      const mod = await import("foliate-js/view.js"); // registers <foliate-view>
      const { Overlayer } = await import("foliate-js/overlayer.js");
      overlayerRef.current = Overlayer;
      if (cancelled || !hostRef.current) return;
      const book = await mod.makeBook(file);
      // Safe mode: harden every section before an iframe can receive it. This
      // must be attached before `open`, which may load the first section.
      resetSafeReport();
      disposeGuard = guardBook(book as never, recordSafeReport);
      const view = document.createElement("foliate-view") as View;
      createdView = view;
      view.style.cssText = "display:block;width:100%;height:100%;";
      // foliate would call window.open() on any external link. Stop that and
      // ask the reader first.
      view.addEventListener("external-link", (e: Event) => {
        e.preventDefault();
        requestExternalLink((e as CustomEvent<{ href: string }>).detail.href);
      });
      hostRef.current.append(view);
      viewRef.current = view;
      await view.open(book);
      if (cancelled) return;

      const fixed = !!view.isFixedLayout;
      const sections: BookSection[] = book.sections ?? [];
      latest.current.onReady({
        toc: book.toc ?? [],
        paged: true,
        typography: !fixed,
        flowControl: !fixed,
        // Reflowable books can render one or two columns per screen.
        spread: !fixed,
        // CFI-anchored highlights, notes and bookmarks.
        annotations: "cfi",
        // Section-text search, streamed through foliate's matcher.
        search: true,
        // Phase 5: sections are the index unit. Deliberately NOT `pageCount`
        // — foliate has no thumbnails, so the Pages drawer stays off.
        indexUnits: sections.length,
        // Phase 12: sections give us plain text, so read-aloud works; a
        // fixed-layout book has no text layer to speak or to scroll.
        tts: !fixed,
        autoScroll: !fixed,
        language: readLanguage(book.metadata?.language),
      });

      /** Section text, normalized and memoized per section index. */
      const textCache = new Map<number, string>();
      const sectionText = async (unit: number): Promise<string> => {
        const i = Math.max(0, Math.min(sections.length - 1, Math.round(unit) - 1));
        const cached = textCache.get(i);
        if (cached != null) return cached;
        const section = sections[i];
        if (!section?.createDocument) return "";
        let text = "";
        try {
          const doc: Document = await section.createDocument();
          text = (doc?.body?.textContent ?? "").replace(/\s+/g, " ").trim();
        } catch {
          text = "";
        }
        textCache.set(i, text);
        return text;
      };

      const goToSection = (unit: number) => {
        if (!sections.length) return;
        const i = Math.max(0, Math.min(sections.length - 1, Math.round(unit) - 1));
        void view.goTo(i).catch(() => {});
      };

      /**
       * The outline drawn on the match a persisted-index hit jumped to. foliate keeps the outlines
       * of its own live search in a list it clears on `clearSearch()`; this one is ours, so we
       * remove it ourselves. It uses foliate's search prefix, which draws the same outline the live
       * search does.
       */
      let hitMark: string | null = null;
      const clearHitMark = () => {
        const value = hitMark;
        hitMark = null;
        if (value) void Promise.resolve(view.deleteAnnotation({ value })).catch(() => {});
      };
      /** Latest jump wins: a click on another result while the section is still loading. */
      let jumpSeq = 0;

      /**
       * Land on the match itself, not on the start of its section.
       *
       * A persisted-index hit is `{ page: <section number>, offset }`, where `offset` counts
       * characters into the section's whitespace-collapsed text — the string `buildDocTextMap`
       * flattens a loaded section into, so the two agree. A long single-section book (a novel in
       * one HTML file, a FictionBook, most MOBI) is one section, so jumping to the section alone
       * leaves the reader on its first page. The renderer calls `anchor` once the section is
       * loaded, and scrolls to the range it returns.
       */
      const goToMatch = async (unit: number, offset: number, match: string) => {
        if (!sections.length) return;
        const index = Math.max(0, Math.min(sections.length - 1, Math.round(unit) - 1));
        const seq = ++jumpSeq;
        clearHitMark();
        let cfi: string | undefined;
        const anchor = (doc: Document) => {
          let map = mapsRef.current.get(index);
          // The map built on `load` belongs to the document that fired it; build a fresh one if
          // the renderer hands over a different document.
          if (!map || (map.nodes[0] && map.nodes[0].ownerDocument !== doc)) {
            map = buildDocTextMap(doc.body ?? doc) ?? undefined;
            if (map) mapsRef.current.set(index, map);
          }
          if (!map || !match) return 0;
          // The loaded document's text can differ a little from the extracted one; the offset is
          // checked against the matched words, and the nearest occurrence is used if it is off.
          const start = confirmMatchStart(map.text, offset, match);
          if (start < 0) return 0;
          const range = rangeFromOffsets(map, start, start + match.length);
          if (!range) return 0;
          try {
            cfi = view.getCFI(index, range);
          } catch {
            cfi = undefined;
          }
          return range;
        };
        try {
          await view.renderer.goTo({ index, anchor });
        } catch {
          return;
        }
        if (seq !== jumpSeq || !cfi) return;
        try {
          view.history?.pushState?.(cfi);
        } catch {
          /* history is a convenience */
        }
        const value = `foliate-search:${cfi}`;
        hitMark = value;
        void Promise.resolve(view.addAnnotation({ value })).catch(() => {});
      };

      /** Sub-pixel debt for paginated auto-scroll, reset on every page turn. */
      let scrollCarry = 0;

      navRef.current = {
        next: () => void view.next(),
        prev: () => void view.prev(),
        goTo: (href) => void view.goTo(href).catch(() => {}),
        goToFraction: (f) => void view.goToFraction(Math.min(1, Math.max(0, f))).catch(() => {}),
        goToPage: (page) => goToSection(page),
        extractPageText: (page) => sectionText(page),
        // The table-of-contents entry a section falls under, as foliate's own live search labels a
        // hit, so an index hit reads "Chapter 3" and not "Page 7" (the seventh section).
        unitLabel: (unit) => labelFromView(view, unit),
        // The spoken sentence lives in the section document foliate last
        // loaded, which is a separate window from the app shell.
        highlightSpoken: (text) =>
          void paintSpoken(sectionDocRef.current?.body ?? sectionDocRef.current, text, {
            scrollIntoView: true,
          }),
        /**
         * Auto-scroll drive. Scrolled flow moves the renderer directly;
         * paginated flow has nothing to scroll, so the pixels accumulate and
         * turn the page once a screenful of reading has gone by.
         */
        scrollByPixels: (pixels) => {
          const r = view.renderer;
          if (!r) return;
          if (r.getAttribute?.("flow") === "scrolled" && typeof r.scrollBy === "function") {
            scrollCarry = 0;
            r.scrollBy(0, pixels);
            return;
          }
          const height = hostRef.current?.clientHeight || window.innerHeight;
          scrollCarry += pixels;
          if (scrollCarry >= height) {
            scrollCarry = 0;
            void view.next();
          }
        },

        goToAnchor: (anchor) => {
          if (anchor.kind === "cfi") {
            void view.goTo(anchor.cfi).catch(() => {});
          } else if (anchor.kind === "text") {
            // Prefer the live CFI if the mark is currently resolved, then the
            // creation-time hint, then the section itself.
            const live = [...resolvedRef.current.entries()].find(
              ([id]) => textAnnotRef.current.get(id)?.anchor === anchor,
            )?.[1];
            const target = live ?? anchor.cfi;
            if (target) void view.goTo(target).catch(() => goToSection(anchor.page));
            else {
              // No CFI hint and the section is not loaded: open the section, and once it has
              // loaded (which resolves its marks) go on to the mark itself.
              const record = [...textAnnotRef.current.values()].find((r) => r.anchor === anchor);
              void view
                .goTo(Math.max(0, anchor.page - 1))
                .then(() => {
                  const cfi = record ? resolvedRef.current.get(record.id) : undefined;
                  return cfi ? view.goTo(cfi) : undefined;
                })
                .catch(() => {});
            }
          }
        },

        currentAnchor: () => {
          const cfi = view.lastLocation?.cfi;
          return cfi ? { kind: "cfi" as const, cfi } : null;
        },
        search: async (query, run) => {
          try {
            view.clearSearch();
          } catch {
            /* nothing drawn yet */
          }
          let n = 0;
          for await (const result of view.search({
            query,
            scope: "book",
            matchCase: !!run.options?.matchCase,
            matchWholeWords: !!run.options?.wholeWord,
          })) {
            if (run.signal.aborted) {
              try {
                view.clearSearch();
              } catch {
                /* noop */
              }
              return;
            }
            if (result === "done") break;
            if (typeof result?.progress === "number") {
              run.onProgress(result.progress);
              continue;
            }
            const subitems = result?.subitems ?? [];
            if (!subitems.length) continue;
            run.onHits(
              subitems
                .filter((s) => s?.cfi)
                .map((s) => ({
                  id: `${s.cfi}-${n++}`,
                  excerpt: {
                    pre: s.excerpt?.pre ?? "",
                    match: s.excerpt?.match ?? query,
                    post: s.excerpt?.post ?? "",
                  },
                  label: result.label || undefined,
                  target: { kind: "cfi" as const, cfi: s.cfi },
                })),
            );
          }
          run.onProgress(1);
        },
        clearSearch: () => {
          clearHitMark();
          try {
            view.clearSearch();
          } catch {
            /* noop */
          }
        },
        goToHit: (hit) => {
          if (hit.target.kind === "cfi") void view.goTo(hit.target.cfi).catch(() => {});
          // Persisted-index hits are section-numbered, not CFI-anchored; the offset says where in
          // the section the match is.
          else if (hit.target.kind === "page") {
            if (hit.target.offset == null) goToSection(hit.target.page);
            else void goToMatch(hit.target.page, hit.target.offset, hit.excerpt.match);
          }
        },
      };

      /**
       * Phase 4.3 — re-resolve every text-anchored mark that belongs to a
       * section against the section's live text, and (re-)register it with
       * foliate under a freshly derived CFI. Marks whose quote has vanished
       * are reported as orphans instead of being dropped.
       */
      const resolveSection = (index: number) => {
        const map = mapsRef.current.get(index);
        if (!map) return;
        const page = index + 1;
        for (const record of textAnnotRef.current.values()) {
          if (record.anchor.kind !== "text" || record.anchor.page !== page) continue;
          const previous = resolvedRef.current.get(record.id);
          const hit = resolveTextAnchor(map.text, record.anchor);
          const range = hit ? rangeFromOffsets(map, hit.start, hit.end) : null;
          let cfi: string | undefined;
          if (range) {
            try {
              cfi = view.getCFI(index, range);
            } catch {
              cfi = undefined;
            }
          }
          if (!cfi) {
            if (previous) {
              annotRef.current.delete(previous);
              resolvedRef.current.delete(record.id);
              void view.deleteAnnotation({ value: previous }).catch(() => {});
            }
            if (!record.orphaned) latest.current.onOrphanChange?.(record.id, true);
            continue;
          }
          if (previous && previous !== cfi) {
            annotRef.current.delete(previous);
            void view.deleteAnnotation({ value: previous }).catch(() => {});
          }
          annotRef.current.set(cfi, record);
          resolvedRef.current.set(record.id, cfi);
          void view.addAnnotation({ value: cfi }).catch(() => {});
          if (record.orphaned) latest.current.onOrphanChange?.(record.id, false);
          if (!record.anchor.cfi && !reportedCfiRef.current.has(record.id)) {
            reportedCfiRef.current.add(record.id);
            latest.current.onAnchorCfi?.(record.id, cfi);
          }
        }
      };
      resolveSectionRef.current = resolveSection;

      // Draw requests come from foliate whenever an annotated section renders.
      view.addEventListener("draw-annotation", (e) => {
        const { draw, annotation } = (e as CustomEvent<DrawAnnotationDetail | null>).detail ?? {};
        const value: string = annotation?.value ?? "";
        if (!draw) return;
        // foliate marks its own search results with this prefix.
        if (value.startsWith("foliate-search:")) {
          draw(overlayerRef.current!.highlight, {
            color: hitFill(),
          });
          return;
        }
        const record = annotRef.current.get(value);
        if (!record) return;
        const color =
          record.type === "highlight"
            ? annotationPaint(record.color, themeRef.current.id === "dusk")
            : ANNOTATION_COLORS[record.color];
        const O = overlayerRef.current!;
        if (record.type === "underline") draw(O.underline, { color });
        else if (record.type === "strike") draw(O.strikethrough, { color });
        else draw(O.highlight, { color });
      });

      // Tapping an existing mark reopens the popover for it.
      view.addEventListener("show-annotation", (e) => {
        const { value, range } = (e as CustomEvent<ShowAnnotationDetail | null>).detail ?? {};
        const record = value === undefined ? undefined : annotRef.current.get(value);
        if (!record) return;
        latest.current.onSelection?.({
          // A text-anchored mark keeps its own anchor; the CFI is only how
          // foliate happens to be drawing it right now.
          anchor: record.anchor,
          text: record.text ?? "",
          rect: selectionRect(range) ?? { x: 0, y: 0, width: 0, height: 0 },
          existingId: record.id,
        });
      });

      // Re-draw marks each time a section mounts its overlay.
      view.addEventListener("create-overlay", (e) => {
        // foliate announces the overlay before it hands it to the renderer, so it is only found
        // once the current call has returned.
        queueMicrotask(() => hideOverlays(view));
        drawnRef.current.clear();
        for (const record of annotRef.current.values()) {
          if (record.anchor.kind !== "cfi") continue;
          void view
            .addAnnotation({ value: record.anchor.cfi })
            .then(() => drawnRef.current.add(record.anchor.kind === "cfi" ? record.anchor.cfi : ""))
            .catch(() => {});
        }
        const index = (e as CustomEvent<CreateOverlayDetail | null>).detail?.index;
        if (typeof index === "number") resolveSection(index);
      });

      view.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<LastLocation | null>).detail ?? {};
        let fraction = typeof d.fraction === "number" ? d.fraction : undefined;
        if (fraction == null && typeof d.index === "number" && book.sections?.length > 1) {
          fraction = d.index / (book.sections.length - 1);
        }
        latest.current.onProgress({
          fraction: Math.min(1, Math.max(0, fraction ?? 0)),
          cfi: d.cfi,
          label: d.pageItem?.label ? `Page ${d.pageItem.label}` : undefined,
        });
      });

      // arrow keys inside book documents + selection capture
      view.addEventListener("load", (e) => {
        const detail = (e as CustomEvent<LoadDetail | null>).detail;
        const doc = detail?.doc;
        const index = detail?.index as number;
        hideOverlays(view);
        if (doc) {
          // The section's frame is the book's text; without a title a screen reader says "frame".
          doc.defaultView?.frameElement?.setAttribute("title", "Book text");
          // foliate's own link handler only sees `click`; a middle click would
          // open a tab without asking. The listener dies with the document.
          doc.addEventListener("auxclick", guardAuxClick);
          // Keep the live section document for read-aloud highlighting.
          sectionDocRef.current = doc;
          // Flatten this section once; selections and stored anchors both
          // speak in offsets into this exact string.
          const map = buildDocTextMap(doc.body ?? doc);
          if (map) {
            mapsRef.current.set(index, map);
            resolveSection(index);
          }
          const emitSelection = () => {
            const sel = doc.getSelection();
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
            const range = normalizeRange(sel.getRangeAt(0));
            const text = sel.toString().trim();
            const rect = selectionRect(range);
            if (!text || !rect) return;
            let cfi: string | undefined;
            try {
              cfi = view.getCFI(index, range);
            } catch {
              cfi = undefined;
            }
            const sectionMap = mapsRef.current.get(index);
            const offsets = sectionMap ? offsetsFromRange(sectionMap, range) : null;
            if (sectionMap && offsets) {
              const anchor = buildTextAnchor(
                sectionMap.text,
                index + 1,
                offsets.start,
                offsets.end,
              );
              latest.current.onSelection?.({
                anchor: cfi ? { ...anchor, cfi } : anchor,
                text,
                rect,
              });
              return;
            }
            if (!cfi) return;
            latest.current.onSelection?.({
              anchor: { kind: "cfi", cfi },
              text,
              rect,
            });
          };
          // Tap forwarding: book content lives in this iframe document, so
          // taps never reach the shell's surface handler. Report quick,
          // still taps (not drags, not selections) with their x fraction.
          let downX = 0;
          let downY = 0;
          let downT = 0;
          doc.addEventListener("pointerdown", (ev) => {
            downX = ev.clientX;
            downY = ev.clientY;
            downT = ev.timeStamp;
          });
          doc.addEventListener("pointerup", (ev) => {
            setTimeout(emitSelection, 0);
            const sel = doc.getSelection();
            if (sel && !sel.isCollapsed) return;
            if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 12) return;
            if (ev.timeStamp - downT > 600) return;
            const frame = doc.defaultView?.frameElement as HTMLElement | null;
            const rect = frame?.getBoundingClientRect();
            if (rect && rect.width > 0) {
              const outer = frame?.ownerDocument?.defaultView?.innerWidth ?? rect.width;
              latest.current.onSurfaceTap?.(
                (rect.x + ev.clientX * (rect.width / (doc.defaultView?.innerWidth ?? rect.width))) /
                  outer,
              );
            }
          });
          doc.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            emitSelection();
          });
        }
        doc?.addEventListener("keydown", (ev) => {
          if (ev.key === "ArrowRight") {
            ev.preventDefault();
            navRef.current?.next();
          } else if (ev.key === "ArrowLeft") {
            ev.preventDefault();
            navRef.current?.prev();
          }
        });
      });

      applyLayout(view, settings, theme, hostRef.current);
      try {
        if (progress?.cfi) {
          await view.init({ lastLocation: progress.cfi });
        } else {
          await view.init({ showTextStart: true });
          if (progress?.fraction && progress.fraction > 0.001) {
            await view.goToFraction(progress.fraction);
          }
        }
      } catch {
        try {
          await view.init({ showTextStart: true });
        } catch {
          /* empty book */
        }
      }
      readyRef.current = true;
      for (const record of annotRef.current.values()) {
        if (record.anchor.kind !== "cfi") continue;
        void view.addAnnotation({ value: record.anchor.cfi }).catch(() => {});
      }
    })().catch((err) => {
      console.error("foliate failed", err);
      if (!cancelled)
        latest.current.onError(
          "This file could not be opened. It may be corrupted or DRM-protected.",
        );
    });

    return () => {
      cancelled = true;
      disposeGuard?.();
      try {
        createdView?.close();
        createdView?.remove();
      } catch {
        /* noop */
      }
      viewRef.current = null;
      navRef.current = null;
    };
    // mount once per file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewRef.current && hostRef.current) {
      applyLayout(viewRef.current, settings, theme, hostRef.current);
    }
  }, [settings, theme]);

  // Margins are viewport-scaled, so re-apply the layout when the window resizes.
  useEffect(() => {
    const onResize = () => {
      if (viewRef.current && hostRef.current) {
        applyLayout(viewRef.current, settings, theme, hostRef.current);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [settings, theme]);

  // Reconcile the drawn overlay with the kernel's annotation list.
  useEffect(() => {
    const marks = annotations.filter((a) => a.type !== "bookmark");
    // Text-anchored marks are resolved per section against the live DOM; CFI
    // marks are drawn directly under their stored CFI.
    const textNext = new Map<string, Annotation>();
    for (const a of marks) if (a.anchor.kind === "text") textNext.set(a.id, a);
    const textPrev = textAnnotRef.current;
    textAnnotRef.current = textNext;

    const next = new Map<string, Annotation>();
    for (const a of marks) if (a.anchor.kind === "cfi") next.set(a.anchor.cfi, a);
    // Keep already-resolved text marks drawn under their current CFI.
    for (const [id, cfi] of resolvedRef.current) {
      const record = textNext.get(id);
      if (record) next.set(cfi, record);
      else resolvedRef.current.delete(id);
    }
    const prev = annotRef.current;
    annotRef.current = next;
    const view = viewRef.current;
    if (!view || !readyRef.current) return;

    for (const [cfi, record] of prev) {
      const now = next.get(cfi);
      if (!now) {
        void view.deleteAnnotation({ value: cfi });
      } else if (now.color !== record.color || now.type !== record.type) {
        void view.addAnnotation({ value: cfi }).catch(() => {}); // re-draw
      }
    }
    for (const [cfi] of next) {
      if (!prev.has(cfi)) void view.addAnnotation({ value: cfi }).catch(() => {});
    }

    // Newly added text marks need a resolution pass on their loaded section.
    const dirty = new Set<number>();
    for (const [id, record] of textNext) {
      if (!textPrev.has(id) && record.anchor.kind === "text") {
        dirty.add(record.anchor.page - 1);
      }
    }
    for (const index of dirty) resolveSectionRef.current?.(index);
  }, [annotations]);

  return <div ref={hostRef} className="h-full w-full" />;
}

/** Range rect in top-window viewport coordinates (ranges live inside iframes). */
function selectionRect(range: Range | undefined | null) {
  if (!range) return null;

  const r = range.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement as
    HTMLElement | null | undefined;
  const off = frame?.getBoundingClientRect();
  return {
    x: r.x + (off?.x ?? 0),
    y: r.y + (off?.y ?? 0),
    width: r.width,
    height: r.height,
  };
}

/**
 * OPF `dc:language` is a single tag, an array of them, or a `{ value }` object
 * depending on the packer. Take the first usable tag, or null.
 */
function readLanguage(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const tag =
    typeof first === "string"
      ? first
      : first &&
          typeof first === "object" &&
          typeof (first as { value?: unknown }).value === "string"
        ? (first as { value: string }).value
        : "";
  return tag.trim() || null;
}
