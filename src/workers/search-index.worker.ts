/// <reference lib="webworker" />
/**
 * Search-index worker.
 *
 * Pure compute: it never touches IndexedDB and never loads a decoder. The
 * kernel streams already-extracted page text in and gets back an inverted
 * index; every structural edit (rotate / reorder / delete / merge) is applied
 * here as a cheap postings remap so a page op costs O(pages) instead of a full
 * re-extraction.
 */

export interface IndexShape {
  /** Inverted index: normalized token -> sorted page numbers. */
  terms: Record<string, number[]>;
  /** Page number -> exact page text (casing preserved, for snippets). */
  pages: Record<number, string>;
  /** Page number -> searchable annotation text (notes/quotes). */
  notes: Record<number, string>;
  pageCount: number;
}

type Req =
  | { type: "indexPages"; index: IndexShape; entries: { page: number; text: string }[] }
  | { type: "indexNotes"; index: IndexShape; entries: { page: number; text: string }[] }
  | { type: "movePage"; index: IndexShape; from: number; to: number }
  | { type: "deletePage"; index: IndexShape; page: number }
  | { type: "appendPages"; index: IndexShape; count: number }
  | {
      type: "query";
      index: IndexShape;
      query: string;
      matchCase: boolean;
      wholeWord: boolean;
    };

type Res =
  | { id: number; ok: true; index: IndexShape }
  | { id: number; ok: true; pages: number[] }
  | { id: number; ok: false; error: string };

const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;

export function tokenize(input: string): string[] {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((t) => t.length > 1);
}

export function emptyIndex(pageCount = 0): IndexShape {
  return { terms: {}, pages: {}, notes: {}, pageCount };
}

function addPosting(terms: Record<string, number[]>, token: string, page: number) {
  const list = terms[token];
  if (!list) {
    terms[token] = [page];
    return;
  }
  // postings stay sorted & unique
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < page) lo = mid + 1;
    else hi = mid;
  }
  if (list[lo] !== page) list.splice(lo, 0, page);
}

/** Drop every posting for one page without touching the other pages. */
function clearPage(terms: Record<string, number[]>, page: number) {
  for (const token of Object.keys(terms)) {
    const list = terms[token];
    const at = list.indexOf(page);
    if (at !== -1) {
      list.splice(at, 1);
      if (list.length === 0) delete terms[token];
    }
  }
}

/** Rewrite every posting through a page-number mapping (old -> new, 0 = drop). */
function remapPostings(index: IndexShape, map: Map<number, number>) {
  for (const token of Object.keys(index.terms)) {
    const next: number[] = [];
    for (const page of index.terms[token]) {
      const to = map.get(page);
      if (to) next.push(to);
    }
    if (next.length) index.terms[token] = next.sort((a, b) => a - b);
    else delete index.terms[token];
  }
  const pages: Record<number, string> = {};
  const notes: Record<number, string> = {};
  for (const [from, to] of map) {
    if (index.pages[from] !== undefined) pages[to] = index.pages[from];
    if (index.notes[from] !== undefined) notes[to] = index.notes[from];
  }
  index.pages = pages;
  index.notes = notes;
}

export function indexPages(
  index: IndexShape,
  entries: { page: number; text: string }[],
  field: "pages" | "notes" = "pages",
): IndexShape {
  for (const { page, text } of entries) {
    // Re-indexing a page means replacing it, never appending duplicates.
    const other = field === "pages" ? index.notes[page] : index.pages[page];
    clearPage(index.terms, page);
    index[field][page] = text;
    for (const token of tokenize(`${text} ${other ?? ""}`)) addPosting(index.terms, token, page);
    if (page > index.pageCount) index.pageCount = page;
  }
  return index;
}

export function movePage(index: IndexShape, from: number, to: number): IndexShape {
  if (from === to) return index;
  const order: number[] = [];
  for (let p = 1; p <= index.pageCount; p++) if (p !== from) order.push(p);
  order.splice(Math.min(to, order.length + 1) - 1, 0, from);
  const map = new Map<number, number>();
  order.forEach((oldPage, i) => map.set(oldPage, i + 1));
  remapPostings(index, map);
  return index;
}

export function deletePage(index: IndexShape, page: number): IndexShape {
  const map = new Map<number, number>();
  let next = 1;
  for (let p = 1; p <= index.pageCount; p++) {
    if (p === page) continue;
    map.set(p, next++);
  }
  remapPostings(index, map);
  index.pageCount = Math.max(0, index.pageCount - 1);
  return index;
}

/** Pages appended by a merge: reserve the slots, leave them unextracted. */
export function appendPages(index: IndexShape, count: number): IndexShape {
  index.pageCount += count;
  return index;
}

/** Candidate pages for a query: intersection of every token's postings. */
export function candidatePages(index: IndexShape, query: string, wholeWord: boolean): number[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  let acc: number[] | null = null;
  for (const token of tokens) {
    // A trailing partial word ("sear" of "search") needs a prefix scan; only
    // whole-word mode can rely on an exact postings hit.
    const exact = index.terms[token];
    const pages = exact ? exact.slice() : wholeWord ? [] : prefixPages(index.terms, token);
    acc = acc === null ? pages : acc.filter((p) => pages.includes(p));
    if (!acc.length) return [];
  }
  return acc ?? [];
}

function prefixPages(terms: Record<string, number[]>, token: string): number[] {
  const out = new Set<number>();
  for (const key of Object.keys(terms))
    if (key.includes(token)) for (const p of terms[key]) out.add(p);
  return [...out].sort((a, b) => a - b);
}

function handle(req: Req): IndexShape | number[] {
  switch (req.type) {
    case "indexPages":
      return indexPages(req.index, req.entries, "pages");
    case "indexNotes":
      return indexPages(req.index, req.entries, "notes");
    case "movePage":
      return movePage(req.index, req.from, req.to);
    case "deletePage":
      return deletePage(req.index, req.page);
    case "appendPages":
      return appendPages(req.index, req.count);
    case "query":
      return candidatePages(req.index, req.query, req.wholeWord);
  }
}

// Guarded so the module can also be imported directly (tests, SSR-safe paths).
if (typeof self !== "undefined" && "onmessage" in self) {
  self.onmessage = (e: MessageEvent<Req & { id: number }>) => {
    const { id, ...req } = e.data;
    try {
      const out = handle(req as Req);
      const res: Res = Array.isArray(out)
        ? { id, ok: true, pages: out }
        : { id, ok: true, index: out };
      (self as unknown as Worker).postMessage(res);
    } catch (err) {
      (self as unknown as Worker).postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies Res);
    }
  };
}
