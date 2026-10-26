/**
 * CFIs generated from element-boundary selections (e.g. selecting a whole
 * paragraph, or double-click select) can resolve to a zero-width range, which
 * draws nothing. Re-anchor both edges onto text nodes with character offsets.
 */
export function normalizeRange(range: Range): Range {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return range;
  const firstText = (node: Node, last: boolean): Text | null => {
    if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.trim() ? (node as Text) : null;
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let found: Text | null = null;
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (!t.data.trim()) continue;
      found = t;
      if (!last) break;
    }
    return found;
  };
  /** The last non-blank text that comes before `node` in document order. */
  const lastTextBefore = (node: Node): Text | null => {
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    while (walker.previousNode()) {
      const t = walker.currentNode as Text;
      if (t.data.trim()) return t;
    }
    return null;
  };
  /** The first non-blank text that comes after `node` (and everything inside it). */
  const firstTextAfter = (node: Node): Text | null => {
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (node.contains(t)) continue;
      if (t.data.trim()) return t;
    }
    return null;
  };
  const out = range.cloneRange();
  if (out.startContainer.nodeType !== Node.TEXT_NODE) {
    const el = out.startContainer as Element;
    // The mirror of the end below: (el, childCount) is a boundary *after* the
    // last child, so the selection begins with the next text, not with el's own.
    // A child with no text of its own (an image, or the blank text between blocks) does not
    // begin the selection either: the first text after it does.
    const child = el.childNodes[out.startOffset];
    const t = child ? (firstText(child, false) ?? firstTextAfter(child)) : firstTextAfter(el);
    if (t) out.setStart(t, 0);
  }
  if (out.endContainer.nodeType !== Node.TEXT_NODE) {
    const el = out.endContainer as Element;
    // Offset 0 is a boundary *before* `el`, not inside it. A triple-click on a
    // paragraph ends at (next block, 0); the selection stops with the paragraph,
    // so take the last text before `el` rather than the last text inside it.
    // Likewise a child with no text of its own before the boundary (an image, or the blank text
    // between blocks, which is where a triple click ends when an image follows) ends the
    // selection with the last text before it.
    const child = out.endOffset > 0 ? el.childNodes[out.endOffset - 1] : undefined;
    const t = child ? (firstText(child, true) ?? lastTextBefore(child)) : lastTextBefore(el);
    if (t) out.setEnd(t, t.data.length);
  }
  return out.collapsed ? range : out;
}
