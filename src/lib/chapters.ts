import type { TocItem } from "./reader-settings";

/**
 * Synthetic chapter detection for structureless text.
 *
 * Plain text carries no navigation document, so we infer one. A ladder of
 * patterns is tried in order of confidence; the first that yields enough
 * well-spaced matches wins. Below that bar the book stays single-chapter —
 * a noisy TOC is worse than none.
 *
 * Pure module (no DOM), so the ladder is unit testable.
 */

/** Minimum number of matches before a pattern is trusted. */
export const MIN_CHAPTERS = 3;

/** Headings closer together than this (in paragraphs) are treated as noise. */
const MIN_GAP = 1;

/** Longest a paragraph can be and still plausibly be a heading. */
const MAX_HEADING_LEN = 90;

export interface DetectedChapter {
  /** Index of the paragraph that starts the chapter. */
  index: number;
  title: string;
  /** 1 = top level, 2 = sub-heading. */
  level: number;
}

interface Rule {
  id: string;
  /** Returns the heading title when the paragraph is a heading. */
  match: (para: string) => { title: string; level: number } | null;
}

const ROMAN = "[IVXLCDM]+";
const EN_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";

const RULES: Rule[] = [
  // Markdown ATX headings: "# Title", "## Title"
  {
    id: "md-atx",
    match: (p) => {
      const m = /^(#{1,4})\s+(.+)$/.exec(p);
      if (!m) return null;
      return { title: clean(m[2]), level: Math.min(2, m[1].length) };
    },
  },
  // Markdown setext headings: title on one line, ===/--- under it
  {
    id: "md-setext",
    match: (p) => {
      const lines = p.split("\n");
      if (lines.length < 2) return null;
      const rule = lines[1].trim();
      if (!/^(={3,}|-{3,})$/.test(rule)) return null;
      const title = clean(lines[0]);
      if (!title || title.length > MAX_HEADING_LEN) return null;
      return { title, level: rule.startsWith("=") ? 1 : 2 };
    },
  },
  // English: "Chapter 12", "CHAPTER XIV — The Road", "Part 3", "Book Two"
  {
    id: "en-chapter",
    match: (p) => {
      const head = firstLine(p);
      const re = new RegExp(
        `^\\s*(chapter|part|book|section|prologue|epilogue|interlude)\\b[\\s.:—–-]*` +
          `(\\d{1,3}|${ROMAN}|${EN_WORDS})?\\b[\\s.:—–-]*(.{0,60})$`,
        "i",
      );
      const m = re.exec(head);
      if (!m) return null;
      const kind = m[1].toLowerCase();
      // "Chapter" with neither number nor title is probably prose.
      if (!m[2] && !["prologue", "epilogue", "interlude"].includes(kind)) return null;
      return { title: clean(head), level: kind === "part" || kind === "book" ? 1 : 2 };
    },
  },
  // CJK: 第十二章 / 第3回 / 第五節
  {
    id: "cjk-chapter",
    match: (p) => {
      const head = firstLine(p);
      if (!/^\s*第\s*[0-9０-９一二三四五六七八九十百千]+\s*[章回節部篇卷]/.test(head)) return null;
      if (head.length > MAX_HEADING_LEN) return null;
      return { title: clean(head), level: 2 };
    },
  },
  // Cyrillic: Глава 4 / ЧАСТЬ ВТОРАЯ
  {
    id: "ru-chapter",
    match: (p) => {
      const head = firstLine(p);
      // \b is ASCII-only, so it never fires after a Cyrillic letter — use an
      // explicit "not followed by a letter" guard instead.
      if (!/^\s*(глава|часть|книга)(?!\p{L})/iu.test(head)) return null;
      if (head.length > MAX_HEADING_LEN) return null;
      return { title: clean(head), level: /^\s*(часть|книга)/iu.test(head) ? 1 : 2 };
    },
  },
  // Bare numbered lines: "12." / "12" / "IV." on their own
  {
    id: "numbered",
    match: (p) => {
      const head = firstLine(p);
      if (p.includes("\n")) return null;
      if (!new RegExp(`^\\s*(\\d{1,3}|${ROMAN})\\s*[.)]?\\s*$`).test(head)) return null;
      return { title: clean(head), level: 2 };
    },
  },
  // Short ALL-CAPS line standing alone
  {
    id: "allcaps",
    match: (p) => {
      const head = firstLine(p);
      if (p.includes("\n")) return null;
      const t = head.trim();
      if (t.length < 3 || t.length > 48) return null;
      if (!/[A-ZА-Я]/.test(t)) return null;
      if (t !== t.toLocaleUpperCase()) return null;
      if (/[.!?]$/.test(t)) return null;
      return { title: clean(t), level: 2 };
    },
  },
];

function firstLine(p: string): string {
  return p.split("\n", 1)[0] ?? "";
}

function clean(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/\s*#+$/, "")
    .trim();
}

/**
 * Run the ladder over paragraph blocks and return the winning chapter list.
 * Returns an empty array when nothing is confident enough.
 */
export function detectChapters(paragraphs: string[]): DetectedChapter[] {
  if (paragraphs.length < MIN_CHAPTERS * 2) return [];

  for (const rule of RULES) {
    const found: DetectedChapter[] = [];
    let last = -Infinity;
    for (let i = 0; i < paragraphs.length; i++) {
      const hit = rule.match(paragraphs[i]);
      if (!hit || !hit.title) continue;
      if (i - last <= MIN_GAP) continue; // headings shouldn't cluster
      last = i;
      found.push({ index: i, title: hit.title, level: hit.level });
    }
    if (found.length >= MIN_CHAPTERS) return found;
  }
  return [];
}

/** Shape detected chapters as the nested TOC the Contents tab renders. */
export function chaptersToToc(chapters: DetectedChapter[]): TocItem[] {
  const out: TocItem[] = [];
  for (const c of chapters) {
    const item: TocItem = { label: c.title, href: `#p${c.index}` };
    const parent = out[out.length - 1];
    if (c.level > 1 && parent) {
      (parent.subitems ??= []).push(item);
    } else {
      out.push(item);
    }
  }
  // A tree with a single root and everything nested under it reads worse than
  // a flat list, so flatten that degenerate case.
  if (out.length === 1 && out[0].subitems?.length) {
    return [{ label: out[0].label, href: out[0].href }, ...out[0].subitems];
  }
  return out;
}

/** Convenience: paragraphs in, TOC out. */
export function buildTextToc(paragraphs: string[]): TocItem[] {
  return chaptersToToc(detectChapters(paragraphs));
}
