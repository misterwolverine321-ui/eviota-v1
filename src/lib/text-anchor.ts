/**
 * Phase 4.3 — self-healing text-offset anchors.
 *
 * A rect anchor pins a highlight to pixels, so it breaks as soon as a page is
 * rotated, reordered or re-flattened. A text anchor pins it to the page's text
 * instead: character offsets for the fast path, plus the quote and 32 chars of
 * surrounding context so the highlight can re-find itself when the offsets
 * drift.
 *
 * This module is pure (no DOM, no pdf.js) so the resolution ladder is unit
 * testable; the engine owns turning a resolved range back into rects.
 */

export const ANCHOR_CONTEXT = 32;

/** How far from the recorded offsets we look before searching the whole page. */
export const ANCHOR_NEAR = 200;

export interface TextAnchorData {
  kind: "text";
  page: number;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  /**
   * Reflowable engines (foliate) keep the CFI captured at creation time as a
   * fast-path hint. Offsets + quote remain the source of truth.
   */
  cfi?: string;
}

export interface ResolvedRange {
  start: number;
  end: number;
  /** How the range was recovered — surfaced for debugging / telemetry. */
  how: "exact" | "near" | "quote" | "context" | "loose";
}

/** Capture offsets plus context from the page text the selection came from. */
export function buildTextAnchor(
  pageText: string,
  page: number,
  start: number,
  end: number,
): TextAnchorData {
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.min(pageText.length, Math.max(start, end));
  return {
    kind: "text",
    page,
    start: lo,
    end: hi,
    quote: pageText.slice(lo, hi),
    prefix: pageText.slice(Math.max(0, lo - ANCHOR_CONTEXT), lo),
    suffix: pageText.slice(hi, hi + ANCHOR_CONTEXT),
  };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Resolution ladder: exact offsets → quote near the offsets → quote anywhere
 * on the page → prefix/suffix context → whitespace-insensitive match. Returns
 * null when the text is gone, which the caller reports as an orphan rather
 * than silently dropping the annotation.
 */
export function resolveTextAnchor(pageText: string, anchor: TextAnchorData): ResolvedRange | null {
  const quote = anchor.quote;
  if (!quote) return null;

  // 1. exact offsets still hold
  if (pageText.slice(anchor.start, anchor.end) === quote) {
    return { start: anchor.start, end: anchor.end, how: "exact" };
  }

  // 2. the quote moved a little
  const from = Math.max(0, anchor.start - ANCHOR_NEAR);
  const window = pageText.slice(from, anchor.start + quote.length + ANCHOR_NEAR);
  const near = window.indexOf(quote);
  if (near >= 0) {
    const start = from + near;
    return { start, end: start + quote.length, how: "near" };
  }

  // 3. the quote is somewhere else on the page — take the closest occurrence
  const all = indicesOf(pageText, quote);
  if (all.length) {
    const start = all.reduce((best, i) =>
      Math.abs(i - anchor.start) < Math.abs(best - anchor.start) ? i : best,
    );
    return { start, end: start + quote.length, how: "quote" };
  }

  // 4. the quote itself changed but its context survives
  const ctx = byContext(pageText, anchor);
  if (ctx) return ctx;

  // 5. last resort: ignore whitespace differences
  const loose = looseFind(pageText, quote);
  if (loose) return { ...loose, how: "loose" };

  return null;
}

function indicesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = haystack.indexOf(needle, i + Math.max(1, needle.length));
  }
  return out;
}

function byContext(pageText: string, anchor: TextAnchorData): ResolvedRange | null {
  const prefix = anchor.prefix.trim();
  const suffix = anchor.suffix.trim();
  if (prefix.length >= 4) {
    const at = pageText.indexOf(prefix);
    if (at >= 0) {
      const start = at + prefix.length;
      const end = suffix.length >= 4 ? pageText.indexOf(suffix, start) : -1;
      return {
        start,
        end: end > start ? end : Math.min(pageText.length, start + anchor.quote.length),
        how: "context",
      };
    }
  }
  if (suffix.length >= 4) {
    const at = pageText.indexOf(suffix);
    if (at > 0) {
      return {
        start: Math.max(0, at - anchor.quote.length),
        end: at,
        how: "context",
      };
    }
  }
  return null;
}

/** Match ignoring runs of whitespace, mapping back to real page offsets. */
function looseFind(pageText: string, quote: string): { start: number; end: number } | null {
  const target = squash(quote).toLocaleLowerCase();
  if (target.length < 3) return null;
  const map: number[] = [];
  let flat = "";
  let space = true;
  for (let i = 0; i < pageText.length; i++) {
    const ch = pageText[i]!;
    if (/\s/.test(ch)) {
      if (space) continue;
      space = true;
      map.push(i);
      flat += " ";
      continue;
    }
    space = false;
    map.push(i);
    flat += ch.toLocaleLowerCase();
  }
  const at = flat.indexOf(target);
  if (at < 0) return null;
  const start = map[at] ?? 0;
  const endIdx = at + target.length - 1;
  const end = (map[endIdx] ?? pageText.length - 1) + 1;
  return { start, end };
}
