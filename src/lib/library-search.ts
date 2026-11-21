import { getDb, type BookRecord } from "./db";
import type { MatchOptions } from "./search";
import type { SearchHit } from "./reader-settings";
import { queryIndex, type SearchIndexRecord } from "./search-index";

/**
 * Cross-book library search (§6.1).
 *
 * Every book that carries a finished search index is queried through the same
 * index-backed path the reader uses, so snippets and page numbers match exactly
 * what the search drawer would show. Indexes are built elsewhere (in the reader,
 * and from the shelf for EPUB and PDF books); a book without one is skipped.
 */

export interface LibraryBookResult {
  bookId: string;
  title: string;
  author: string;
  format: string;
  /** Capped snippet list for this book. */
  hits: SearchHit[];
  /** Total hits found before the cap. */
  total: number;
}

export interface LibrarySearchOptions extends MatchOptions {
  /** Snippets kept per book. */
  perBook?: number;
  /** Books listed at most (the ones with the most matches). Every indexed book is searched. */
  maxBooks?: number;
  signal?: AbortSignal;
}

/** Page number carried by a hit, when the target is page-based. */
export function hitPage(hit: SearchHit): number | null {
  const target = hit.target as { kind?: string; page?: number };
  return target?.kind === "page" && typeof target.page === "number" ? target.page : null;
}

/**
 * Characters into the unit's text where a page-based hit's match starts (the offset the index holds),
 * so a link from the shelf can bring the reader to the match and not only to its page or section.
 */
export function hitOffset(hit: SearchHit): number | null {
  const target = hit.target as { kind?: string; offset?: number };
  return target?.kind === "page" && typeof target.offset === "number" && target.offset >= 0
    ? Math.floor(target.offset)
    : null;
}

async function readAllIndexes(): Promise<SearchIndexRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await getDb();
  if (!db.objectStoreNames.contains("searchIndex")) return [];
  return (await db.getAll("searchIndex")) as SearchIndexRecord[];
}

export async function searchLibrary(
  query: string,
  books: BookRecord[],
  opts: LibrarySearchOptions = {},
): Promise<LibraryBookResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const perBook = opts.perBook ?? 5;
  const maxBooks = opts.maxBooks ?? 40;

  const byId = new Map(books.map((b) => [b.id, b]));
  // Every ready index on the shelf is searched. The cap applies to the list that comes back: an
  // early version capped the books searched, so with more than `maxBooks` indexed books the rest
  // could never be found.
  const records = (await readAllIndexes()).filter(
    (r) => r.status === "ready" && byId.has(r.bookId),
  );

  const results: LibraryBookResult[] = [];
  for (const record of records) {
    if (opts.signal?.aborted) return results;
    const book = byId.get(record.bookId)!;
    let hits: SearchHit[];
    try {
      hits = await queryIndex(record, q, {
        matchCase: opts.matchCase,
        wholeWord: opts.wholeWord,
        limit: perBook * 8,
      });
    } catch {
      continue;
    }
    if (!hits.length) continue;
    results.push({
      bookId: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      hits: hits.slice(0, perBook),
      total: hits.length,
    });
  }

  results.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  return results.slice(0, maxBooks);
}
