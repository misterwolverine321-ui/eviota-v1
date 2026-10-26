import { normalizeText } from "./search";

/**
 * Index units for documents that are one long run of blocks (plain text, RTF, Markdown, HTML).
 *
 * EPUB has sections and PDF has pages, so the persisted search index gets a natural unit from the
 * file. A text file has neither, and used to get no index at all: it was searched live while it was
 * open and never found from the shelf. This module cuts such a document into units of at most
 * `UNIT_CHARS` characters (a single longer block is a unit of its own), always on a block boundary, so the index builds in steps, the hit list can
 * say roughly where in the document a match is, and a hit can be walked back to the block it is in.
 *
 * Pure: the reader and the shelf indexer both call it on the same block list, so unit n means the
 * same text in both, and a test can check that without a DOM.
 */

/** The most characters one unit holds. A block longer than this is a unit of its own. */
export const UNIT_CHARS = 24_000;

export interface BlockPosition {
  /** Index into the block list the units were built from. */
  block: number;
  /** Characters into that block's whitespace-collapsed text. */
  offset: number;
}

export interface TextUnits {
  /** Whitespace-collapsed text of each unit (blocks joined by one space); unit n is `texts[n - 1]`. */
  texts: string[];
  count: number;
  /** Where unit `unit` starts in the document, 0..1 (by characters). */
  startFraction: (unit: number) => number;
  /** The first block of a unit, or null for a unit that does not exist. */
  firstBlock: (unit: number) => number | null;
  /** The block that holds `offset` characters into a unit, or null for a unit that does not exist. */
  locate: (unit: number, offset: number) => BlockPosition | null;
  /** Changes whenever the text the units hold changes, so a stored index can tell it is stale. */
  signature: string;
}

interface UnitLayout {
  /** Block index of each block in the unit. */
  ids: number[];
  /** Offset of each block's text inside the unit text. */
  starts: number[];
  lens: number[];
}

/** FNV-1a over UTF-16 code units: cheap, and enough to notice that the text has changed. */
function hash32(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Cut a block list into units.
 *
 * Blocks that are empty once whitespace is collapsed are skipped but still count in the block
 * numbering, so `BlockPosition.block` is always an index into the list passed in.
 */
export function buildTextUnits(blocks: readonly string[], unitChars = UNIT_CHARS): TextUnits {
  const texts: string[] = [];
  const layouts: UnitLayout[] = [];
  const startChars: number[] = [];
  let parts: string[] = [];
  let layout: UnitLayout | null = null;
  let length = 0;
  let total = 0;
  let hash = 0x811c9dc5;

  const flush = () => {
    if (layout) {
      texts.push(parts.join(" "));
      layouts.push(layout);
    }
    parts = [];
    layout = null;
    length = 0;
  };

  blocks.forEach((raw, index) => {
    const text = normalizeText(raw);
    if (!text) return;
    // A unit stops short of overflowing, so a block longer than the unit size ends up alone.
    if (layout && length + 1 + text.length > unitChars) flush();
    if (!layout) {
      layout = { ids: [], starts: [], lens: [] };
      startChars.push(total);
    }
    if (parts.length) length += 1; // the joining space
    layout.ids.push(index);
    layout.starts.push(length);
    layout.lens.push(text.length);
    parts.push(text);
    length += text.length;
    total += text.length;
    hash = hash32(hash, text);
    hash = hash32(hash, "\n");
  });
  flush();

  const at = (unit: number): UnitLayout | null => layouts[Math.round(unit) - 1] ?? null;

  return {
    texts,
    count: texts.length,
    startFraction: (unit) => {
      const start = startChars[Math.round(unit) - 1];
      return start === undefined || total === 0 ? 0 : start / total;
    },
    firstBlock: (unit) => at(unit)?.ids[0] ?? null,
    locate: (unit, offset) => {
      const u = at(unit);
      if (!u) return null;
      // Last block that starts at or before the offset.
      let lo = 0;
      let hi = u.starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (u.starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return {
        block: u.ids[lo],
        offset: Math.max(0, Math.min(offset - u.starts[lo], u.lens[lo])),
      };
    },
    signature: `${texts.length}:${total}:${hash.toString(16)}`,
  };
}

/**
 * A short hit-list label for a unit: the stretch of the document it covers, as percentages ("57–100%").
 * A hit is labelled by its unit and not by its own place, so the label says where the match can be
 * and does not claim more than that; a unit is a few screens long, so the stretch is narrow.
 */
export function unitPercentLabel(units: TextUnits, unit: number): string {
  const from = Math.round(units.startFraction(unit) * 100);
  const next = Math.round(unit) + 1;
  const to = next > units.count ? 100 : Math.round(units.startFraction(next) * 100);
  return `${from}–${Math.max(from, to)}%`;
}
