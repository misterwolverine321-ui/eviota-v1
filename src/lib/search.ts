import type { SearchHit, SearchTarget } from "./reader-settings";

/**
 * Plain-text search helpers shared by the PDF, text and HTML engines.
 *
 * foliate-js brings its own segmenter-based matcher for reflowable books; the
 * engines that own their DOM/text use these instead. Matching is
 * whitespace-normalized so hits survive re-wrapping, and case-insensitive
 * unless `matchCase` is set.
 */

const CONTEXT = 48;

export const MAX_HITS = 500;

/**
 * Matching mode shared by live engine search and the persisted index, so both
 * agree on what counts as a hit.
 */
export interface MatchOptions {
  /** Case-sensitive comparison (default: false). */
  matchCase?: boolean;
  /** Require word boundaries around the match (default: false). */
  wholeWord?: boolean;
}

/** Characters that count as "inside a word" for whole-word matching. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

const isWordChar = (ch: string | undefined) => !!ch && WORD_CHAR.test(ch);

/** True when `[start, end)` in `haystack` is bounded by non-word characters. */
export function isWholeWordMatch(haystack: string, start: number, end: number): boolean {
  return !isWordChar(haystack[start - 1]) && !isWordChar(haystack[end]);
}

export function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** All matches of `query` in an already normalized string. */
export function findMatches(
  haystack: string,
  query: string,
  makeTarget: (offset: number) => SearchTarget,
  idPrefix: string,
  label?: string,
  options: MatchOptions = {},
): SearchHit[] {
  const raw = query.trim();
  if (!raw) return [];
  const needle = options.matchCase ? raw : raw.toLocaleLowerCase();
  const lower = options.matchCase ? haystack : haystack.toLocaleLowerCase();
  const hits: SearchHit[] = [];
  let index = lower.indexOf(needle);
  while (index !== -1 && hits.length < MAX_HITS) {
    const end = index + needle.length;
    if (!options.wholeWord || isWholeWordMatch(haystack, index, end)) {
      const preRaw = haystack.slice(Math.max(0, index - CONTEXT), index);
      const postRaw = haystack.slice(end, end + CONTEXT);
      hits.push({
        id: `${idPrefix}:${index}`,
        excerpt: {
          pre: (index > CONTEXT ? "…" : "") + preRaw,
          match: haystack.slice(index, end),
          post: postRaw + (end + CONTEXT < haystack.length ? "…" : ""),
        },
        label,
        target: makeTarget(index),
      });
    }
    // Advance by one so overlapping candidates aren't skipped when a
    // whole-word rejection happens mid-word.
    index = lower.indexOf(needle, index + 1);
  }
  return hits;
}
