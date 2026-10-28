/**
 * Bridge between a book section's DOM and text
 * anchors.
 *
 * `text-anchor.ts` is pure offsets; `pdf-text-map.ts` is the pdf.js text-layer
 * half. This is the same idea for reflowable documents: flatten a section
 * document into exactly the string the search index sees (whitespace collapsed
 * to single spaces, trimmed), and keep a per-character map back to the text
 * node it came from, so a live selection becomes offsets and stored offsets
 * become a DOM range the engine can turn into a CFI.
 *
 * A per-character map costs one small-int array per character, which for a
 * typical EPUB section (tens of KB) is cheaper than the tree walks it saves,
 * and it is the only representation that stays correct under collapsing —
 * a node's characters do not map linearly onto the flattened text.
 */

export interface DocTextMap {
  /** Whitespace-collapsed section text, identical to the indexed text. */
  text: string;
  nodes: Text[];
  /** For each character in `text`: index into `nodes`. */
  owner: Int32Array;
  /** For each character in `text`: offset within that node's data. */
  offset: Int32Array;
  /** First flat index contributed by each node, for reverse lookups. */
  firstIndex: Map<Text, number>;
}

/** Flatten a section document (or any subtree) into text plus a node map. */
export function buildDocTextMap(root: Node | null | undefined): DocTextMap | null {
  if (!root) return null;
  const doc = root.ownerDocument ?? (root as Document);
  if (!doc?.createTreeWalker) return null;

  const walker = doc.createTreeWalker(root, 0x4 /* SHOW_TEXT */);
  const nodes: Text[] = [];
  const owner: number[] = [];
  const offset: number[] = [];
  const firstIndex = new Map<Text, number>();
  let text = "";
  let pendingSpace = false;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const data = node.data;
    if (data) {
      const nodeIndex = nodes.length;
      let used = false;
      for (let i = 0; i < data.length; i++) {
        const ch = data[i]!;
        if (/\s/.test(ch)) {
          pendingSpace = true;
          continue;
        }
        if (pendingSpace && text.length > 0) {
          text += " ";
          owner.push(nodeIndex);
          offset.push(i);
        }
        pendingSpace = false;
        if (!used) {
          used = true;
          nodes.push(node);
          firstIndex.set(node, text.length);
        }
        text += ch;
        owner.push(nodeIndex);
        offset.push(i);
      }
      // A node made only of whitespace still separates words, but owns no
      // characters, so it never enters `nodes`.
    }
    node = walker.nextNode() as Text | null;
  }

  if (!text) return null;
  return {
    text,
    nodes,
    owner: Int32Array.from(owner),
    offset: Int32Array.from(offset),
    firstIndex,
  };
}

/** Character offsets for a live selection range, or null when off-map. */
export function offsetsFromRange(
  map: DocTextMap,
  range: Range,
): { start: number; end: number } | null {
  const start = flatIndex(map, range.startContainer, range.startOffset, false);
  const end = flatIndex(map, range.endContainer, range.endOffset, true);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** Build a DOM range covering `[start, end)` of the flattened text. */
export function rangeFromOffsets(map: DocTextMap, start: number, end: number): Range | null {
  const lo = Math.max(0, Math.min(start, map.text.length - 1));
  const hi = Math.max(lo + 1, Math.min(end, map.text.length));
  const startNode = map.nodes[map.owner[lo]!];
  const endNode = map.nodes[map.owner[hi - 1]!];
  if (!startNode || !endNode) return null;
  const doc = startNode.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  try {
    range.setStart(startNode, Math.min(map.offset[lo]!, startNode.data.length));
    range.setEnd(endNode, Math.min(map.offset[hi - 1]! + 1, endNode.data.length));
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

/**
 * Map a (container, offset) DOM position onto the flattened text.
 *
 * `atEnd` picks the last character owned by the position rather than the
 * first, which is what a range's end boundary means.
 *
 * A text node that owns characters is read exactly. Every other boundary (between the children
 * of an element, or in or next to text that owns nothing, such as the blank text between
 * blocks) lies BETWEEN mapped text, and is resolved by where it falls in the document: an end
 * is the end of the last mapped text before it, a start is the start of the first mapped text
 * after it. Reading `children[offset - 1]` for an end instead is wrong at offset 0, which is
 * where a triple click on a paragraph ends (before the NEXT block), and mapped it to the end
 * of the next block's text.
 */
function flatIndex(
  map: DocTextMap,
  container: Node,
  domOffset: number,
  atEnd: boolean,
): number | null {
  if (container.nodeType === 3 /* TEXT_NODE */) {
    const exact = indexInNode(map, container as Text, domOffset, atEnd);
    if (exact !== null) return exact;
  }
  return boundaryIndex(map, container, domOffset, atEnd);
}

function boundaryIndex(
  map: DocTextMap,
  container: Node,
  domOffset: number,
  atEnd: boolean,
): number | null {
  const doc = container.ownerDocument;
  if (!doc) return null;
  try {
    const at = doc.createRange();
    at.setStart(container, domOffset);
    at.collapse(true);
    if (atEnd) {
      for (let i = map.nodes.length - 1; i >= 0; i--) {
        const node = map.nodes[i]!;
        // comparePoint: -1 the point is before `at`, 0 it is `at`, 1 it is after.
        if (at.comparePoint(node, node.data.length) <= 0) {
          return indexInNode(map, node, node.data.length, true);
        }
      }
      return null;
    }
    for (const node of map.nodes) {
      if (at.comparePoint(node, 0) >= 0) return map.firstIndex.get(node) ?? null;
    }
    return null;
  } catch {
    // A node from another document or an offset past the end of the container.
    return null;
  }
}

function indexInNode(
  map: DocTextMap,
  node: Text,
  domOffset: number,
  atEnd: boolean,
): number | null {
  const from = map.firstIndex.get(node);
  if (from == null) {
    // Whitespace-only or detached node: fall back to the nearest mapped node.
    return null;
  }
  const nodeIndex = map.owner[from]!;
  let best: number | null = null;
  for (let i = from; i < map.text.length && map.owner[i] === nodeIndex; i++) {
    const off = map.offset[i]!;
    if (atEnd) {
      if (off < domOffset) best = i + 1;
    } else if (off >= domOffset) {
      return i;
    }
  }
  return atEnd ? best : null;
}
