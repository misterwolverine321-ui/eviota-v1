/**
 * Bridge between a rendered pdf.js text layer and text anchors.
 *
 * `text-anchor.ts` is pure offsets; this module is the DOM half. It flattens a
 * page's text layer into one string plus a node/offset map, so a live
 * selection becomes character offsets, and stored offsets become a DOM range
 * (and from there, normalized rects for the highlight layer).
 */

import type { NormRect } from "./annotations";

interface MapEntry {
  node: Text;
  /** Offset of this node's first character in `text`. */
  start: number;
  end: number;
}

export interface PageTextMap {
  text: string;
  entries: MapEntry[];
}

/**
 * Flatten the text layer inside a rendered page host.
 *
 * Text nodes are concatenated in document order; a single space is inserted
 * between nodes that belong to different spans, mirroring how pdf.js text
 * items are joined when a page's text is extracted for search.
 */
export function buildPageTextMap(host: HTMLElement | null): PageTextMap | null {
  const layer = host?.querySelector<HTMLElement>(".textLayer");
  if (!layer) return null;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const entries: MapEntry[] = [];
  let text = "";
  let lastParent: Node | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const data = node.data;
    if (data) {
      if (entries.length && node.parentNode !== lastParent && !/\s$/.test(text)) {
        text += " ";
      }
      const start = text.length;
      text += data;
      entries.push({ node, start, end: text.length });
      lastParent = node.parentNode;
    }
    node = walker.nextNode() as Text | null;
  }
  if (!entries.length) return null;
  return { text, entries };
}

/** Character offsets for a live selection range, or null if it's off-layer. */
export function offsetsFromRange(
  map: PageTextMap,
  range: Range,
): { start: number; end: number } | null {
  const start = offsetOf(map, range.startContainer, range.startOffset);
  const end = offsetOf(map, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function offsetOf(map: PageTextMap, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const hit = map.entries.find((e) => e.node === container);
    if (!hit) return null;
    return hit.start + Math.min(offset, hit.node.data.length);
  }
  // Element container: offset indexes child nodes — clamp to the nearest text.
  const child = container.childNodes[Math.min(offset, container.childNodes.length - 1)];
  const idx = map.entries.findIndex((e) => e.node === child || child?.contains(e.node));
  if (idx >= 0) return map.entries[idx]!.start;
  return null;
}

/** Turn resolved offsets back into a DOM range inside the text layer. */
export function rangeFromOffsets(map: PageTextMap, start: number, end: number): Range | null {
  const from = locate(map, start, false);
  const to = locate(map, end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

function locate(
  map: PageTextMap,
  offset: number,
  isEnd: boolean,
): { node: Text; offset: number } | null {
  for (const entry of map.entries) {
    if (isEnd ? offset > entry.start && offset <= entry.end : offset < entry.end) {
      return {
        node: entry.node,
        offset: Math.max(0, Math.min(entry.node.data.length, offset - entry.start)),
      };
    }
  }
  const last = map.entries[map.entries.length - 1];
  if (!last) return null;
  return isEnd
    ? { node: last.node, offset: last.node.data.length }
    : { node: map.entries[0]!.node, offset: 0 };
}

/** Client rects of a range, normalized to a page box (0..1 of width/height). */
export function normalizedRects(range: Range, box: DOMRect): NormRect[] {
  if (box.width === 0 || box.height === 0) return [];
  return Array.from(range.getClientRects())
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({
      x: (r.x - box.x) / box.width,
      y: (r.y - box.y) / box.height,
      w: r.width / box.width,
      h: r.height / box.height,
    }));
}
