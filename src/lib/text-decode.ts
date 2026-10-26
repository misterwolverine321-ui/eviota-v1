/**
 * Phase 6.1 — encoding detection for plain-text sources.
 *
 * `TextDecoder("utf-8")` silently produces mojibake for the Shift-JIS, GBK and
 * KOI8-R files that make up most legacy plain-text libraries. This module
 * sniffs BOMs, validates UTF-8 strictly, and otherwise scores a fixed set of
 * candidate labels by decoding with each and grading the resulting text.
 *
 * Pure and DOM-free: `TextDecoder` exists in browsers, workers and Node, so
 * this is unit-testable without a page.
 */

export interface EncodingGuess {
  /** WHATWG encoding label, ready for `new TextDecoder(label)`. */
  label: string;
  /** 0..1 — 1 means a BOM or pure-ASCII certainty. */
  confidence: number;
}

export interface DecodeResult extends EncodingGuess {
  text: string;
  /** What detection picked, even when an override produced `label`. */
  detected: string;
  /** True when `label` came from an explicit override rather than detection. */
  overridden: boolean;
}

/** Labels offered in the Display tab, in menu order. */
export const ENCODINGS: { label: string; name: string }[] = [
  { label: "utf-8", name: "Unicode (UTF-8)" },
  { label: "utf-16le", name: "Unicode (UTF-16 LE)" },
  { label: "utf-16be", name: "Unicode (UTF-16 BE)" },
  { label: "shift_jis", name: "Japanese (Shift-JIS)" },
  { label: "euc-jp", name: "Japanese (EUC-JP)" },
  { label: "gbk", name: "Chinese Simplified (GBK)" },
  { label: "big5", name: "Chinese Traditional (Big5)" },
  { label: "euc-kr", name: "Korean (EUC-KR)" },
  { label: "koi8-r", name: "Cyrillic (KOI8-R)" },
  { label: "windows-1251", name: "Cyrillic (Windows-1251)" },
  { label: "windows-1252", name: "Western (Windows-1252)" },
  { label: "iso-8859-2", name: "Central European (ISO-8859-2)" },
  { label: "iso-8859-7", name: "Greek (ISO-8859-7)" },
];

export function encodingName(label: string): string {
  return ENCODINGS.find((e) => e.label === label)?.name ?? label.toUpperCase();
}

/** Candidates tried when the bytes are neither BOM-marked nor valid UTF-8. */
const CANDIDATES = [
  "shift_jis",
  "euc-jp",
  "gbk",
  "big5",
  "euc-kr",
  "koi8-r",
  "windows-1251",
  "windows-1252",
  "iso-8859-2",
];

/** Bytes inspected by the statistical pass — enough signal, bounded cost. */
const SAMPLE = 64 * 1024;

/** Replacement-character ratio above which a decode is considered wrong. */
const REPLACEMENT_LIMIT = 0.002;

/** BOM sniff. Returns null when the bytes carry no byte-order mark. */
export function sniffBom(bytes: Uint8Array): { label: string; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { label: "utf-8", length: 3 };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return { label: "utf-16le", length: 2 };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return { label: "utf-16be", length: 2 };
  return null;
}

/** Strict UTF-8 structural validation (no replacement fallback). */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let min: number;
    let cp: number;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      min = 0x80;
      cp = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      min = 0x800;
      cp = b & 0x0f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      min = 0x10000;
      cp = b & 0x07;
    } else return false;
    if (i + need > bytes.length - 1) return false;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || c < 0x80 || c > 0xbf) return false;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    i += need + 1;
  }
  return true;
}

/** Detect the most likely encoding for `bytes`. */
export function detectEncoding(bytes: Uint8Array): EncodingGuess {
  const bom = sniffBom(bytes);
  if (bom) return { label: bom.label, confidence: 1 };

  const sample = bytes.length > SAMPLE ? bytes.subarray(0, SAMPLE) : bytes;

  // UTF-16 without a BOM: dense, regularly-spaced NUL bytes. Checked before
  // the ASCII shortcut, since ASCII-range UTF-16 is all low bytes plus NULs.
  const utf16 = sniffUtf16(sample);
  if (utf16) return { label: utf16, confidence: 0.9 };

  let high = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] >= 0x80 || sample[i] === 0) high++;
  if (high === 0) return { label: "utf-8", confidence: 1 };

  if (isValidUtf8(sample)) return { label: "utf-8", confidence: 0.95 };

  const scored = CANDIDATES.map((label) => ({
    label,
    score: scoreDecode(decodeWith(label, sample), sample.length),
  })).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runner = scored[1];
  const gap = runner ? Math.max(0, best.score - runner.score) : best.score;
  const confidence = Math.max(0.3, Math.min(0.9, 0.45 + gap * 4));
  return { label: best.label, confidence };
}

/**
 * Decode `bytes` to text. Pass `override` to force a label; otherwise the
 * detected label wins, with a UTF-8 result that is riddled with replacement
 * characters demoted to the best non-UTF-8 candidate.
 */
export function decodeText(bytes: Uint8Array, override?: string | null): DecodeResult {
  const detectedGuess = detectEncoding(bytes);
  let detected = detectedGuess.label;
  let confidence = detectedGuess.confidence;

  if (override) {
    return {
      text: strip(decodeWith(override, bytes), override),
      label: override,
      detected,
      confidence: 1,
      overridden: true,
    };
  }

  let text = strip(decodeWith(detected, bytes), detected);
  if (detected === "utf-8" && confidence < 1 && replacementRatio(text) > REPLACEMENT_LIMIT) {
    const sample = bytes.length > SAMPLE ? bytes.subarray(0, SAMPLE) : bytes;
    const runner = CANDIDATES.map((label) => ({
      label,
      score: scoreDecode(decodeWith(label, sample), sample.length),
    })).sort((a, b) => b.score - a.score)[0];
    if (runner) {
      detected = runner.label;
      confidence = 0.5;
      text = strip(decodeWith(detected, bytes), detected);
    }
  }

  return { text, label: detected, detected, confidence, overridden: false };
}

function strip(text: string, label: string): string {
  // TextDecoder keeps the UTF-8 BOM as U+FEFF; UTF-16 decoders consume theirs.
  return label === "utf-8" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeWith(label: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function replacementRatio(text: string): number {
  if (!text.length) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) n++;
  return n / text.length;
}

function sniffUtf16(bytes: Uint8Array): string | null {
  const n = Math.min(bytes.length, 2048);
  if (n < 16) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < n; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) evenNul++;
    else oddNul++;
  }
  const half = n / 2;
  if (oddNul > half * 0.3 && evenNul < half * 0.05) return "utf-16le";
  if (evenNul > half * 0.3 && oddNul < half * 0.05) return "utf-16be";
  return null;
}

/**
 * Grade a decoded string. Positive for coherent script runs and ASCII,
 * negative for replacement characters, controls and mixed high-Latin noise —
 * the signature of a wrong codec. Normalized by byte count so candidates
 * producing different character counts stay comparable.
 */
function scoreDecode(text: string, byteLength: number): number {
  if (!text.length) return -Infinity;
  let score = 0;
  let cyr = 0;
  let cyrUpper = 0;
  let cyrCommon = 0;

  const COMMON_CYR = "оаеинтсрвлкмдпуяызбгчйжхшюцщэфъь";

  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const prev = i > 0 ? text.charCodeAt(i - 1) : 32;

    if (c === 0xfffd) {
      score -= 30;
      continue;
    }
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) {
      score -= 30;
      continue;
    }
    if (c < 0x80) {
      score += 1;
      continue;
    }
    if (c >= 0x3040 && c <= 0x30ff) {
      score += 4; // kana — strong Japanese signal
      continue;
    }
    if (c >= 0x4e00 && c <= 0x9fff) {
      score += 3; // CJK ideographs
      continue;
    }
    if (c >= 0xac00 && c <= 0xd7a3) {
      score += 3; // Hangul syllables
      continue;
    }
    if (c >= 0x3000 && c <= 0x303f) {
      score += 2; // CJK punctuation — travels with the scripts above
      continue;
    }
    if (c >= 0xff01 && c <= 0xff60) {
      score += 1; // fullwidth forms
      continue;
    }
    if (c >= 0x0400 && c <= 0x04ff) {
      cyr++;
      const lower = String.fromCharCode(c).toLowerCase();
      if (COMMON_CYR.includes(lower)) cyrCommon++;
      if (lower !== String.fromCharCode(c)) cyrUpper++;
      score += 2;
      continue;
    }
    if (c >= 0x00c0 && c <= 0x024f) {
      // Accented Latin: normal inside words, suspicious in runs.
      const prevHigh = prev >= 0x00a0;
      score += prevHigh ? -3 : 1;
      continue;
    }
    if (c >= 0x2000 && c <= 0x206f) {
      score += 0.5; // general punctuation
      continue;
    }
    if (c >= 0xe000 && c <= 0xf8ff) {
      score -= 8; // private use — always garbage here
      continue;
    }
    score -= 2; // stray symbols, box drawing, dingbats
  }

  if (cyr > 20) {
    // Real Russian prose is mostly lowercase and mostly common letters.
    if (cyrUpper / cyr > 0.6) score -= cyr * 2;
    if (cyrCommon / cyr < 0.7) score -= cyr;
  }

  return score / Math.max(1, byteLength);
}
