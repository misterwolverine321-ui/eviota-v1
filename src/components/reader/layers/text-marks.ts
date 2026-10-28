/**
 * Text-anchored marks for the DOM engines (TXT / RTF / HTML / MD).
 *
 * foliate owns its own Overlayer and pdf.js draws into the canvas layer, but
 * the plain-DOM engines render ordinary elements, so highlights are painted as
 * absolutely-positioned rectangles derived from a live `Range`. The anchor
 * model is the same self-healing text anchor used everywhere else: offsets
 * into the flattened document text plus quote and context, so a mark survives
 * re-flow, font changes and the HTML clean-view swap.
 *
 * The helpers are deliberately framework-free and take an explicit `Document`
 * so the HTML engine can drive them inside its sandboxed iframe.
 */
import {
  ANNOTATION_COLORS,
  annotationPaint,
  isTextMark,
  type Annotation,
  type SelectionEvent,
} from "@/lib/annotations";
import { offsetsFromRange, rangeFromOffsets, type DocTextMap } from "@/lib/doc-text-map";
import { buildTextAnchor, resolveTextAnchor, type TextAnchorData } from "@/lib/text-anchor";

/** Every DOM engine is a single continuous document, so one "page". */
export const DOM_PAGE = 1;

const LAYER_CLASS = "eviota-mark-layer";

export interface MarkContext {
  doc: Document;
  /** Positioning container the overlay rectangles are placed inside. */
  host: HTMLElement;
  map: DocTextMap | null;
  /** Viewport offset of the surface, for engines rendering inside an iframe. */
  frameOffset?: () => { x: number; y: number };
  /**
   * Which text unit this document represents. Single-document engines leave it
   * at `DOM_PAGE`; an engine that swaps one section at a time passes the
   * 1-based section number so marks stay scoped to their own page.
   */
  page?: number;
  /** The page is the dark reading theme (Dusk): highlight fills are drawn lighter on it. */
  dark?: boolean;
}

const pageOf = (ctx: MarkContext) => ctx.page ?? DOM_PAGE;

/** Create (or reuse) the overlay element the rectangles live in. */
function ensureLayer(ctx: MarkContext): HTMLElement {
  const { doc, host } = ctx;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  let layer = host.querySelector<HTMLElement>(`.${LAYER_CLASS}`);
  if (!layer) {
    layer = doc.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText =
      "position:absolute;inset:0;pointer-events:none;z-index:1;overflow:visible;";
    host.appendChild(layer);
  }
  return layer;
}

const offsetOf = (ctx: MarkContext) => ctx.frameOffset?.() ?? { x: 0, y: 0 };

/**
 * Repaint every text-anchored mark that belongs to this document.
 *
 * Marks whose quote can no longer be found are reported through
 * `onOrphanChange` rather than dropped — the kernel keeps the record so the
 * Notes tab can still show the passage.
 */
export function paintMarks(
  ctx: MarkContext,
  annotations: Annotation[],
  onOrphanChange?: (id: string, orphaned: boolean) => void,
): void {
  const { map, host } = ctx;
  if (!host.isConnected) return;
  const layer = ensureLayer(ctx);
  layer.textContent = "";
  if (!map) return;

  const base = host.getBoundingClientRect();

  for (const record of annotations) {
    if (record.anchor.kind !== "text") continue;
    if (record.anchor.page !== pageOf(ctx)) continue;
    if (!isTextMark(record.type)) continue;

    const hit = resolveTextAnchor(map.text, record.anchor);
    const range = hit ? rangeFromOffsets(map, hit.start, hit.end) : null;
    if (!range) {
      if (!record.orphaned) onOrphanChange?.(record.id, true);
      continue;
    }
    if (record.orphaned) onOrphanChange?.(record.id, false);

    const color = ANNOTATION_COLORS[record.color];
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      const el = ctx.doc.createElement("div");
      el.dataset.annotId = record.id;
      const style: string[] = [
        "position:absolute",
        `left:${rect.left - base.left}px`,
        `top:${rect.top - base.top}px`,
        `width:${rect.width}px`,
        `height:${rect.height}px`,
        "pointer-events:auto",
        "cursor:pointer",
      ];
      if (record.type === "underline") {
        style.push(`border-bottom:2px solid ${color}`, "background:transparent");
      } else if (record.type === "strike") {
        style.push(
          "background:transparent",
          `background-image:linear-gradient(${color},${color})`,
          "background-size:100% 2px",
          "background-position:0 50%",
          "background-repeat:no-repeat",
        );
      } else {
        style.push(
          `background:${annotationPaint(record.color, ctx.dark === true)}`,
          "border-radius:2px",
        );
      }
      el.style.cssText = style.join(";");
      layer.appendChild(el);
    }
  }
}

/** Remove every painted rectangle (used on teardown / view swaps). */
export function clearMarks(ctx: MarkContext): void {
  ctx.host.querySelector(`.${LAYER_CLASS}`)?.remove();
}

/** Annotation id under a pointer event target, when a mark was tapped. */
export function markIdAt(target: EventTarget | null): string | null {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return null;
  return el.closest<HTMLElement>("[data-annot-id]")?.dataset.annotId ?? null;
}

/** Selection event for the current live selection, or null when collapsed. */
export function readSelection(ctx: MarkContext): SelectionEvent | null {
  const { doc, map } = ctx;
  if (!map) return null;
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  const offsets = offsetsFromRange(map, range);
  if (!offsets) return null;
  const anchor = buildTextAnchor(map.text, pageOf(ctx), offsets.start, offsets.end);
  if (!anchor.quote.trim()) return null;
  const rect = range.getBoundingClientRect();
  const shift = offsetOf(ctx);
  return {
    anchor,
    text: anchor.quote,
    rect: {
      x: rect.left + shift.x,
      y: rect.top + shift.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

/** Selection event describing an existing mark the user tapped. */
export function selectionForMark(
  ctx: MarkContext,
  record: Annotation,
  el: HTMLElement,
): SelectionEvent {
  const rect = el.getBoundingClientRect();
  const shift = offsetOf(ctx);
  return {
    anchor: record.anchor,
    text: record.text ?? "",
    rect: {
      x: rect.left + shift.x,
      y: rect.top + shift.y,
      width: rect.width,
      height: rect.height,
    },
    existingId: record.id,
  };
}

/**
 * Text anchor for whatever is at a viewport point — used for bookmarks, which
 * pin "where I am" rather than a selection.
 */
export function anchorAtPoint(ctx: MarkContext, x: number, y: number): TextAnchorData | null {
  const { doc, map } = ctx;
  if (!map) return null;
  const range = caretRange(doc, x, y);
  if (!range) return null;
  const offsets = offsetsFromRange(map, expand(doc, range, map.text.length));
  const start = offsets?.start ?? null;
  if (start == null) return null;
  const end = Math.min(map.text.length, start + 64);
  return buildTextAnchor(map.text, pageOf(ctx), start, end);
}

/** Collapsed caret ranges carry no offsets — widen by one character. */
function expand(doc: Document, range: Range, max: number): Range {
  const out = range.cloneRange();
  try {
    const node = out.startContainer;
    if (node.nodeType === 3) {
      const text = node as Text;
      const end = Math.min(text.data.length, out.startOffset + 1);
      if (end > out.startOffset) out.setEnd(text, end);
    }
  } catch {
    /* keep the collapsed range; offsetsFromRange will reject it */
  }
  void doc;
  void max;
  return out;
}

/** `caretRangeFromPoint` is WebKit/Blink; `caretPositionFromPoint` is Gecko. */
function caretRange(doc: Document, x: number, y: number): Range | null {
  const anyDoc = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  try {
    if (typeof anyDoc.caretRangeFromPoint === "function") {
      return anyDoc.caretRangeFromPoint(x, y);
    }
    const pos = anyDoc.caretPositionFromPoint?.(x, y);
    if (!pos) return null;
    const range = doc.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
}
