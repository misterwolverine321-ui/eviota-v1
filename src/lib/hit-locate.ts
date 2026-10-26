import { buildDocTextMap, rangeFromOffsets } from "./doc-text-map";

/**
 * Walking a search hit back to the place it came from.
 *
 * A hit from the persisted index carries an offset into the unit's whitespace-collapsed text, and a
 * live hit carries one into its block's text. Both are offsets into text the reader may no longer
 * hold in exactly that shape (a section reloaded, a document re-parsed), so the offset is checked
 * against the matched words before it is trusted.
 */

/**
 * Where the hit's match starts in `text`: at `offset` when the text there agrees with the match, else
 * the nearest occurrence at or after a small window before `offset`, else -1.
 */
export function confirmMatchStart(text: string, offset: number, match: string): number {
  const want = match.toLowerCase();
  if (!want) return -1;
  if (offset >= 0 && text.slice(offset, offset + want.length).toLowerCase() === want) return offset;
  return text.toLowerCase().indexOf(want, Math.max(0, offset - 200));
}

/**
 * A DOM range over the match, `offset` characters into a block's whitespace-collapsed text (the text
 * `buildDocTextMap` produces for the block). Null when the block no longer holds the match.
 */
export function rangeInBlock(block: HTMLElement, offset: number, match: string): Range | null {
  const map = buildDocTextMap(block);
  if (!map) return null;
  const start = confirmMatchStart(map.text, offset, match);
  if (start < 0) return null;
  return rangeFromOffsets(map, start, start + match.length);
}

/** The name the match highlight is registered under (see `paintHit`). */
export const HIT_HIGHLIGHT = "eviota-hit";

interface HighlightHost {
  CSS?: {
    highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void };
  };
  Highlight?: new (...ranges: Range[]) => unknown;
}

/**
 * Mark exactly the matched words, for a block too long to tint as a whole. It uses the CSS Custom
 * Highlight API, which paints a range without touching the page's DOM; a browser without it paints
 * nothing, and the scroll still lands on the match. The `::highlight(eviota-hit)` rule has to be in
 * the document the range belongs to. Pass `null` to remove the mark.
 */
export function paintHit(doc: Document, range: Range | null): void {
  const win = doc.defaultView as (Window & HighlightHost) | null;
  const registry = win?.CSS?.highlights;
  if (!registry || !win?.Highlight) return;
  try {
    if (range) registry.set(HIT_HIGHLIGHT, new win.Highlight(range));
    else registry.delete(HIT_HIGHLIGHT);
  } catch {
    /* a highlight is decoration */
  }
}

/** True when a block is too tall to tint whole: more than most of the reading area. */
export function isTallBlock(blockHeight: number, viewportHeight: number): boolean {
  return viewportHeight > 0 && blockHeight > viewportHeight * 0.8;
}

/**
 * How many times `match` occurs in `text` before `offset`, counting every start position (the way
 * the search does, so overlapping candidates count). It is the hit's place among the occurrences of
 * the phrase on the page, and survives the page's text being laid out differently on screen.
 */
export function occurrenceBefore(text: string, match: string, offset: number): number {
  const want = match.toLowerCase();
  if (!want) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  let at = lower.indexOf(want);
  while (at !== -1 && at < offset) {
    count++;
    at = lower.indexOf(want, at + 1);
  }
  return count;
}

/**
 * Which of a page's text pieces hold the `occurrence`-th (0-based) occurrence of `match`.
 *
 * The pieces are the text layer's spans in order. They are joined the way the index text is made
 * (one space between pieces, whitespace collapsed) so occurrences line up with the index's. If the
 * page shows fewer occurrences than the index counted, the last one found is used; with none, the
 * result is empty. Returns piece indexes, ascending.
 */
export function spansForOccurrence(pieces: readonly string[], match: string, occurrence: number) {
  const want = match.toLowerCase();
  if (!want) return [];
  let joined = "";
  const owner: number[] = [];
  pieces.forEach((piece, index) => {
    const run = ` ${piece}`;
    // By UTF-16 unit, so `owner` stays the same length as `joined`.
    for (let k = 0; k < run.length; k++) {
      const ch = run[k];
      if (/\s/.test(ch)) {
        if (joined && !joined.endsWith(" ")) {
          joined += " ";
          owner.push(index);
        }
      } else {
        joined += ch;
        owner.push(index);
      }
    }
  });
  const lower = joined.toLowerCase();
  const starts: number[] = [];
  for (let at = lower.indexOf(want); at !== -1; at = lower.indexOf(want, at + 1)) starts.push(at);
  if (!starts.length) return [];
  const start = starts[Math.min(Math.max(0, occurrence), starts.length - 1)];
  const found = new Set<number>();
  for (let i = start; i < start + want.length; i++) {
    const piece = owner[i];
    if (piece !== undefined) found.add(piece);
  }
  return [...found].sort((a, b) => a - b);
}
