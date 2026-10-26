/**
 * Phase 12 polish — painting the sentence being read aloud.
 *
 * The DOM engines and foliate all render ordinary documents, so the spoken
 * sentence is located by flattening the document's text (whitespace collapsed,
 * exactly like the engines' `extractPageText`) and mapping the match back onto
 * a live `Range`. Painting uses the CSS Custom Highlight API, which needs no
 * DOM surgery and therefore can't disturb annotations, selections or reflow.
 * Platforms without the API simply get no underline; speech still works.
 */

import { hitFill, onReaderHighlightTheme, readerHighlightTheme } from "./reader-highlight";
import { smoothScroll } from "./motion";

const HIGHLIGHT_NAME = "eviota-spoken";
const STYLE_ID = "eviota-spoken-style";

interface Flat {
  text: string;
  /** For each character of `text`, the node and offset it came from. */
  nodes: Text[];
  offsets: number[];
}

type HighlightRegistry = Map<string, unknown> & { delete(k: string): boolean };

interface HighlightWindow {
  CSS?: { highlights?: HighlightRegistry };
  Highlight?: new (...ranges: Range[]) => unknown;
}

/**
 * The highlight registry is per-window, and iframe content (html-reader,
 * foliate sections) lives in another one — so both the registry and the
 * `Highlight` constructor must come from the document being painted, not from
 * the top-level `globalThis`.
 */
function windowFor(node: Node | null | undefined): HighlightWindow | null {
  if (!node) return (globalThis as unknown as HighlightWindow) ?? null;
  const doc = (node.ownerDocument ?? node) as Document;
  return (doc.defaultView as unknown as HighlightWindow | null) ?? null;
}

function registry(view: HighlightWindow | null): HighlightRegistry | null {
  return view?.CSS?.highlights ?? null;
}

function supported(view: HighlightWindow | null): boolean {
  return typeof view?.Highlight === "function" && !!registry(view);
}

/**
 * Every registry we have painted into, so a clear reaches the iframe that was
 * last painted even after the caller has lost the node.
 */
const painted = new Set<HighlightRegistry>();

/** Inject the highlight paint rule into a document once. */
function ensureStyle(doc: Document): void {
  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  style.textContent = `::highlight(${HIGHLIGHT_NAME}){background:${hitFill()};text-decoration:underline;text-decoration-color:${readerHighlightTheme() === "dusk" ? "#ff5541" : "#de2d1e"};text-decoration-thickness:2px;text-underline-offset:3px;}`;
  if (!trackedDocuments.has(doc)) {
    trackedDocuments.add(doc);
    onReaderHighlightTheme(() => {
      if (doc.defaultView) ensureStyle(doc);
    });
  }
}

const trackedDocuments = new WeakSet<Document>();

/** Collapse whitespace the way the engines do when they extract text. */
export function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Flatten a root's text nodes into one whitespace-collapsed string. */
function flatten(root: Node): Flat {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chars: string[] = [];
  const nodes: Text[] = [];
  const offsets: number[] = [];
  let pendingSpace = false;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const parent = node.parentElement;
    const tag = parent?.tagName;
    if (parent && tag !== "SCRIPT" && tag !== "STYLE") {
      const raw = node.data;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]!;
        if (/\s/.test(ch)) {
          pendingSpace = chars.length > 0;
          continue;
        }
        if (pendingSpace) {
          chars.push(" ");
          nodes.push(node);
          offsets.push(i);
          pendingSpace = false;
        }
        chars.push(ch);
        nodes.push(node);
        offsets.push(i);
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return { text: chars.join(""), nodes, offsets };
}

/** Locate `sentence` inside `root`, returning a live range or null. */
export function rangeForSentence(root: Node, sentence: string): Range | null {
  const needle = normalizeForMatch(sentence);
  if (needle.length < 2) return null;
  const flat = flatten(root);
  let at = flat.text.indexOf(needle);
  if (at < 0) {
    // Segmentation may have trimmed punctuation or a quote mark; retry on a
    // slightly shorter probe before giving up.
    const probe = needle.slice(0, Math.max(12, Math.floor(needle.length * 0.6)));
    at = probe.length >= 12 ? flat.text.indexOf(probe) : -1;
    if (at < 0) return null;
  }
  const end = Math.min(flat.text.length, at + needle.length) - 1;
  const startNode = flat.nodes[at];
  const endNode = flat.nodes[end];
  if (!startNode || !endNode) return null;
  const doc = startNode.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  range.setStart(startNode, flat.offsets[at]!);
  range.setEnd(endNode, Math.min(endNode.data.length, flat.offsets[end]! + 1));
  return range;
}

/**
 * Paint (or clear, with `null`) the spoken sentence inside `root`.
 * Returns true when something was painted.
 */
export function paintSpoken(
  root: Node | null | undefined,
  sentence: string | null,
  opts: { scrollIntoView?: boolean } = {},
): boolean {
  const view = windowFor(root);
  if (!supported(view) || !view) return false;
  const reg = registry(view);
  if (!reg) return false;
  if (!sentence || !root) {
    clearSpoken();
    return false;
  }
  const doc = (root.ownerDocument ?? root) as Document;
  const range = rangeForSentence(root, sentence);
  if (!range) {
    clearSpoken();
    return false;
  }
  ensureStyle(doc);
  const Ctor = view.Highlight!;
  reg.set(HIGHLIGHT_NAME, new Ctor(range));
  painted.add(reg);

  if (opts.scrollIntoView) {
    const rect = range.getBoundingClientRect();
    const win = doc.defaultView;
    const height = win?.innerHeight ?? 0;
    if (win && height && (rect.top < height * 0.1 || rect.bottom > height * 0.9)) {
      const target = range.startContainer.parentElement;
      target?.scrollIntoView({ block: "center", behavior: smoothScroll() });
    }
  }
  return true;
}

/** Drop any painted sentence, in whichever document it was painted into. */
export function clearSpoken(): void {
  for (const reg of painted) {
    try {
      reg.delete(HIGHLIGHT_NAME);
    } catch {
      // The frame it belonged to is gone; nothing left to unpaint.
    }
  }
  painted.clear();
  registry(globalThis as unknown as HighlightWindow)?.delete(HIGHLIGHT_NAME);
}
