import { useEffect, useRef, useState } from "react";
import { readTextDocument } from "@/lib/text-document";
import { buildTextToc } from "@/lib/chapters";
import { findMatches, normalizeText } from "@/lib/search";
import { buildTextUnits, unitPercentLabel, type TextUnits } from "@/lib/text-units";
import { isTallBlock, paintHit, rangeInBlock } from "@/lib/hit-locate";
import { FONT_STACKS } from "@/lib/reader-settings";
import { buildDocTextMap, type DocTextMap } from "@/lib/doc-text-map";
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
import { smoothScroll } from "@/lib/motion";
import { paragraphStyle, textBlockStyle } from "@/lib/typography";

/** TXT / RTF engine: continuous scroll with full typography control. */
export function TextReader({
  file,
  fileName,
  settings,
  theme,
  progress,
  onReady,
  onProgress,
  onError,
  navRef,
  encoding,
  annotations = [],
  onSelection,
  onOrphanChange,
}: RendererProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const markCtx = useRef<MarkContext | null>(null);
  const restored = useRef(false);
  const [paras, setParas] = useState<string[] | null>(null);
  const parasRef = useRef<string[]>([]);
  /** The paragraphs cut into index units (see `text-units.ts`); set once the file is read. */
  const unitsRef = useRef<TextUnits | null>(null);
  /** A `?page=` deep link that arrived before the paragraphs were on screen. */
  const pendingPageRef = useRef<number | null>(null);
  const latest = useRef({ onReady, onProgress, onError, onSelection, onOrphanChange });
  latest.current = { onReady, onProgress, onError, onSelection, onOrphanChange };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (cancelled) return;
      const { paras: parts, decoded } = readTextDocument(bytes, fileName, encoding ?? null);
      const units = buildTextUnits(parts);
      parasRef.current = parts;
      unitsRef.current = units;
      setParas(parts);
      latest.current.onReady({
        toc: buildTextToc(parts),
        paged: false,
        typography: true,
        flowControl: false,
        annotations: "text",
        search: true,
        // The persisted search index: this file, cut into units, so the shelf can find it later.
        indexUnits: units.count,
        indexKey: units.signature,
        tts: true,
        autoScroll: true,
        encoding: {
          label: decoded.label,
          detected: decoded.detected,
          confidence: decoded.confidence,
        },
      });
    })().catch(() => {
      latest.current.onError("This text file could not be read.");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoding]);

  // navigation = page-height jumps
  useEffect(() => {
    navRef.current = {
      next: () => {
        const el = scrollRef.current;
        el?.scrollBy({ top: el.clientHeight * 0.9, behavior: smoothScroll() });
      },
      prev: () => {
        const el = scrollRef.current;
        el?.scrollBy({ top: -el.clientHeight * 0.9, behavior: smoothScroll() });
      },
      // Auto-scroll drive: raw scrollTop, no smooth behavior — the rAF loop
      // supplies the animation and `smooth` would fight it.
      scrollByPixels: (pixels) => {
        const el = scrollRef.current;
        if (el) el.scrollTop += pixels;
      },
      // The whole file is one read-aloud unit.
      extractPageText: async () => parasRef.current.join("\n\n"),
      // The search index cuts the file into smaller units (see `text-units.ts`).
      extractIndexText: async (unit) => unitsRef.current?.texts[Math.round(unit) - 1] ?? "",
      // "47%" for a hit that sits 47% of the way into the file: there are no pages to name.
      unitLabel: (unit) => (unitsRef.current ? unitPercentLabel(unitsRef.current, unit) : ""),
      // A shelf hit opens the book at the unit the index found it in.
      goToPage: (unit) => {
        const block = unitsRef.current?.firstBlock(unit);
        if (block == null || !jumpToBlock(scrollRef.current, block, undefined, "", "start")) {
          // The file is still being read or drawn: apply it once the paragraphs are on screen.
          pendingPageRef.current = unit;
        }
      },
      // Read-aloud sentence painting, inside the rendered paragraph column.
      highlightSpoken: (text) =>
        void paintSpoken(contentRef.current, text, { scrollIntoView: true }),
      goToFraction: (f) => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * f });
      },

      // Synthetic chapters address paragraphs as "#p<index>".
      goTo: (href) => {
        const m = /^#p(\d+)$/.exec(href);
        if (!m) return;
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-para="${m[1]}"]`);
        el?.scrollIntoView({ behavior: smoothScroll(), block: "start" });
      },
      search: async (query, run) => {
        const list = parasRef.current;
        for (let i = 0; i < list.length; i++) {
          if (run.signal.aborted) return;
          const hits = findMatches(
            normalizeText(list[i]),
            query,
            (offset) => ({ kind: "node" as const, index: i, offset }),
            `t${i}`,
            undefined,
            run.options,
          );
          if (hits.length) run.onHits(hits);
          if (i % 64 === 0) {
            run.onProgress((i + 1) / list.length);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        run.onProgress(1);
      },
      goToAnchor: (anchor) => {
        const ctx = markCtx.current;
        if (anchor.kind !== "text" || !ctx?.map) return;
        const index = Math.max(0, Math.min(ctx.map.text.length - 1, anchor.start));
        const node = ctx.map.nodes[ctx.map.owner[index]!];
        node?.parentElement?.scrollIntoView({ behavior: smoothScroll(), block: "center" });
      },
      currentAnchor: () => {
        const ctx = markCtx.current;
        const box = scrollRef.current?.getBoundingClientRect();
        if (!ctx || !box) return null;
        return anchorAtPoint(ctx, box.left + box.width / 2, box.top + 8);
      },
      clearSearch: () => clearFlash(scrollRef.current),
      goToHit: (hit) => {
        const target = hit.target;
        if (target.kind === "node") {
          jumpToBlock(scrollRef.current, target.index, target.offset, hit.excerpt.match);
        } else if (target.kind === "page") {
          // A persisted-index hit: unit + offset into the unit's text -> paragraph + offset.
          const at = unitsRef.current?.locate(target.page, target.offset ?? 0);
          if (at) {
            jumpToBlock(
              scrollRef.current,
              at.block,
              target.offset == null ? undefined : at.offset,
              hit.excerpt.match,
            );
          }
        }
      },
    };
    return () => {
      navRef.current = null;
    };
  }, [navRef]);

  // restore position once content is laid out
  useEffect(() => {
    if (!paras || restored.current) return;
    restored.current = true;
    const f = progress?.fraction ?? 0;
    const pending = pendingPageRef.current;
    pendingPageRef.current = null;
    if (pending != null) {
      // A deep link names where to open; it wins over the stored position.
      requestAnimationFrame(() => navRef.current?.goToPage?.(pending));
    } else if (f > 0.001) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paras]);

  // ------------------------------------------------------- annotations ----

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  /**
   * Selection trigger.
   *
   * The listener lives on the owning document, not on the text column: a drag
   * routinely ends in the page margins, in the gap between two lines, or over
   * the scroll gutter, and a content-only `pointerup` handler drops exactly
   * those selections — the popover then never opens even though the range is
   * live. Releases outside the reading surface (chrome, drawer, the popover
   * itself) are ignored so the popover isn't dismissed by its own buttons.
   * Keyed selection (⌘/Ctrl+A, shift-extend) is picked up on keyup; the plain
   * arrow keys stay page-turn keys, so they never build a range.

   */
  useEffect(() => {
    if (paras === null) return;

    const emitFrom = (target: EventTarget | null) => {
      const ctx = markCtx.current;
      if (!ctx) return;
      const id = markIdAt(target);
      const record = id ? annotationsRef.current.find((a) => a.id === id) : undefined;
      if (record) {
        latest.current.onSelection?.(selectionForMark(ctx, record, target as HTMLElement));
        return;
      }
      // Let the browser finalize the selection before we read it.
      setTimeout(() => {
        const live = markCtx.current;
        if (live) latest.current.onSelection?.(readSelection(live));
      }, 0);
    };

    const onPointerUp = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !scrollRef.current?.contains(target)) return;
      emitFrom(target);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const selectAll = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a";
      if (!event.shiftKey && !selectAll) return;
      emitFrom(null);
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [paras]);

  /** Rebuild the text map and repaint marks whenever the document changes. */
  useEffect(() => {
    const host = contentRef.current;
    if (!host || paras === null) return;
    let map: DocTextMap | null = null;
    try {
      map = buildDocTextMap(host);
    } catch {
      map = null;
    }
    const ctx: MarkContext = { doc: host.ownerDocument, host, map };
    markCtx.current = ctx;
    paintMarks(ctx, annotations, latest.current.onOrphanChange);

    const repaint = () => paintMarks(ctx, annotations, latest.current.onOrphanChange);
    window.addEventListener("resize", repaint);
    return () => {
      window.removeEventListener("resize", repaint);
      clearMarks(ctx);
      markCtx.current = null;
    };
  }, [
    annotations,
    paras,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.maxWidth,
  ]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    onProgress({ fraction: max > 0 ? Math.min(1, el.scrollTop / max) : 0 });
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full w-full overflow-y-auto"
      style={{ background: theme.bg, color: theme.ink }}
    >
      <div
        ref={contentRef}
        className="relative mx-auto px-6 py-16"
        style={{
          maxWidth: settings.maxWidth,
          fontFamily: FONT_STACKS[settings.fontFamily],
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          ...textBlockStyle(settings),
        }}
      >
        {paras === null ? (
          <p style={{ color: theme.sub }}>Loading…</p>
        ) : (
          paras.map((p, i) => (
            <p
              key={i}
              data-para={i}
              className="whitespace-pre-wrap"
              style={paragraphStyle(settings, i === 0)}
            >
              {p}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

/** Drop the tint applied to the last jumped-to paragraph, and the mark on the last match. */
function clearFlash(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLElement>("[data-search-flash]").forEach((el) => {
    delete el.dataset.searchFlash;
    el.style.background = "";
  });
  if (root) paintHit(root.ownerDocument, null);
}

/**
 * Bring paragraph `index` into view, and show where the match is.
 *
 * An ordinary paragraph is centred and tinted whole. A paragraph taller than the reading area (a
 * file with no blank lines is one paragraph) is no use to centre: the match could be anywhere in it,
 * so the view goes to the match's own line and only the matched words are marked.
 */
function jumpToBlock(
  scroller: HTMLElement | null,
  index: number,
  offset: number | undefined,
  match: string,
  align: ScrollLogicalPosition = "center",
): boolean {
  const el = scroller?.querySelector<HTMLElement>(`[data-para="${index}"]`);
  if (!scroller || !el) return false;
  clearFlash(scroller);
  if (align === "start") {
    // A unit start (a deep link), not a match: no tint.
    el.scrollIntoView({ behavior: "auto", block: "start" });
    return true;
  }
  if (
    offset != null &&
    match &&
    isTallBlock(el.getBoundingClientRect().height, scroller.clientHeight)
  ) {
    const range = rangeInBlock(el, offset, match);
    const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
    if (range && rect) {
      const box = scroller.getBoundingClientRect();
      scroller.scrollTo({
        top: Math.max(0, scroller.scrollTop + (rect.top - box.top) - scroller.clientHeight * 0.4),
        behavior: smoothScroll(),
      });
      paintHit(el.ownerDocument, range);
      return true;
    }
  }
  el.scrollIntoView({ behavior: smoothScroll(), block: "center" });
  el.dataset.searchFlash = "1";
  el.style.background = "var(--reader-hit)";
  return true;
}
