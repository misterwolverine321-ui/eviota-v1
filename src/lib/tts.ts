/**
 * Read-aloud text plumbing (Phase 12).
 *
 * Pure helpers only: sentence segmentation, rate clamping and voice choice.
 * The `speechSynthesis` driver lives in `use-tts.ts` so this module stays
 * testable in a plain Node environment.
 */

/** Speech rate bounds. Below 0.75 voices slur; above 2 they turn to noise. */
export const TTS_RATE_MIN = 0.75;
export const TTS_RATE_MAX = 2;
export const TTS_RATE_STEP = 0.05;

/** Longest utterance we hand to the synthesizer before splitting it. */
export const MAX_UTTERANCE = 240;

/**
 * Words that end in a period without ending a sentence. Stored without the
 * dots so "e.g." and "eg" both match.
 */
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "jr",
  "sr",
  "vs",
  "etc",
  "eg",
  "ie",
  "fig",
  "figs",
  "no",
  "nos",
  "approx",
  "inc",
  "ltd",
  "co",
  "corp",
  "dept",
  "est",
  "al",
  "cf",
  "ca",
  "ave",
  "rd",
  "blvd",
  "mt",
  "sgt",
  "capt",
  "gen",
  "rev",
  "hon",
  "col",
  "lt",
  "messrs",
  "phd",
  "md",
  "vol",
  "vols",
  "pp",
  "ed",
  "eds",
  "chap",
  "trans",
]);

const TERMINATORS = /[.!?…]/;
const CLOSERS = /["'”’»)\]]/;

/** Clamp a requested speech rate into the usable range. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, Math.round(rate * 100) / 100));
}

/**
 * Split prose into speakable sentences.
 *
 * Breaks on `. ! ? …` followed by whitespace, but keeps abbreviations
 * ("Dr. Watson"), initials ("J. R. R. Tolkien") and decimal-ish runs joined.
 * Sentences longer than `maxLen` are cut at clause boundaries so the
 * synthesizer never swallows a whole page-long paragraph in one utterance.
 */
export function segmentSentences(input: string, maxLen: number = MAX_UTTERANCE): string[] {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!TERMINATORS.test(ch)) continue;

    // Swallow runs of terminators ("?!", "...") and any closing punctuation.
    let end = i;
    while (end + 1 < text.length && TERMINATORS.test(text[end + 1])) end++;
    while (end + 1 < text.length && CLOSERS.test(text[end + 1])) end++;

    const gap = text[end + 1];
    // Not a boundary unless whitespace follows; the tail push handles the end.
    if (gap === undefined || gap !== " ") {
      i = end;
      continue;
    }
    const next = text.slice(end + 2).trimStart()[0];
    if (!next) {
      i = end;
      continue;
    }

    // A lone "." needs the abbreviation / initial checks; "?", "!", "…" and
    // runs like "..." always end a sentence.
    if (ch === "." && end === i) {
      const word = /([A-Za-z.]+)$/.exec(text.slice(start, i))?.[1] ?? "";
      const bare = word.replace(/\./g, "").toLowerCase();
      if (bare.length === 1 || ABBREVIATIONS.has(bare)) {
        i = end;
        continue;
      }
      // Numbered runs ("1. 2. 3.") and lowercase continuations aren't breaks.
      if (/[a-z]/.test(next)) {
        i = end;
        continue;
      }
    }

    const piece = text.slice(start, end + 1).trim();
    if (piece) parts.push(piece);
    start = end + 1;
    i = end;
  }

  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);

  return parts.flatMap((p) => splitLong(p, maxLen));
}

/** Cut an over-long sentence at the latest clause break that fits. */
function splitLong(sentence: string, maxLen: number): string[] {
  if (maxLen < 40 || sentence.length <= maxLen) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = Math.max(
      window.lastIndexOf("; "),
      window.lastIndexOf(", "),
      window.lastIndexOf(": "),
      window.lastIndexOf("— "),
      window.lastIndexOf("– "),
    );
    if (cut < maxLen * 0.4) cut = window.lastIndexOf(" ");
    if (cut < 1) cut = maxLen - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** Minimal shape of a platform voice, so tests need no browser globals. */
export interface VoiceLike {
  name: string;
  lang: string;
  default?: boolean;
}

/**
 * Choose a voice: the saved one if it still exists, else the best match for
 * the book's language, else whatever the platform calls default.
 */
export function pickVoice<T extends VoiceLike>(
  voices: readonly T[],
  wanted?: string | null,
  lang?: string | null,
): T | null {
  if (!voices.length) return null;
  if (wanted) {
    const exact = voices.find((v) => v.name === wanted);
    if (exact) return exact;
  }
  const tag = (lang ?? "").replace("_", "-").toLowerCase();
  if (tag) {
    const full = voices.find((v) => v.lang?.toLowerCase() === tag);
    if (full) return full;
    const base = tag.split("-")[0];
    const family = voices.filter((v) => v.lang?.toLowerCase().split("-")[0] === base);
    if (family.length) return family.find((v) => v.default) ?? family[0];
  }
  return voices.find((v) => v.default) ?? voices[0];
}

// ------------------------------------------------ read-aloud position ----

/** Where read-aloud stopped inside a book: `unit` plus the sentence index. */
export interface TtsPosition {
  unit: number;
  index: number;
}

const POSITION_PREFIX = "nawiri-tts-position:";

function positionKey(bookId: string): string {
  return `${POSITION_PREFIX}${bookId}`;
}

/** Read the persisted read-aloud position for a book, if any is stored. */
export function loadTtsPosition(bookId: string): TtsPosition | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(positionKey(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TtsPosition>;
    const unit = Number(parsed?.unit);
    const index = Number(parsed?.index);
    if (!Number.isFinite(unit) || !Number.isFinite(index)) return null;
    return { unit: Math.max(1, Math.floor(unit)), index: Math.max(0, Math.floor(index)) };
  } catch {
    return null;
  }
}

/** Persist the read-aloud position for a book. */
export function saveTtsPosition(bookId: string, position: TtsPosition): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      positionKey(bookId),
      JSON.stringify({
        unit: Math.max(1, Math.floor(position.unit)),
        index: Math.max(0, Math.floor(position.index)),
      }),
    );
  } catch {
    // Private mode or a full quota — losing the bookmark is not worth a throw.
  }
}

/** Forget the stored read-aloud position (used when playback finishes). */
export function clearTtsPosition(bookId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(positionKey(bookId));
  } catch {
    // Nothing to do.
  }
}
