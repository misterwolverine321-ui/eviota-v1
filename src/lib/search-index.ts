import { getDb } from "./db";
import { findMatches, type MatchOptions } from "./search";
import type { SearchHit } from "./reader-settings";
import type { IndexShape } from "@/workers/search-index.worker";
import { emptyIndex } from "@/workers/search-index.worker";

/**
 * Persisted per-book search index with incremental maintenance.
 *
 * The heavy work is split three ways:
 *  - pdf.js extracts page text in its own worker (`extract` callback),
 *  - our worker tokenizes and remaps postings,
 *  - this module owns persistence and scheduling.
 *
 * Every edit is incremental. Rotating a page rewrites metadata only; moving or
 * deleting a page remaps postings; merging reserves the appended slots and
 * extracts just those. A full rebuild only happens when the index version
 * changes or the page count drifts from what we recorded.
 */

export const INDEX_VERSION = 1;

export type IndexStatus = "idle" | "building" | "ready" | "failed";

export interface SearchIndexRecord {
  bookId: string;
  version: number;
  builtAt: number;
  status: IndexStatus;
  /** Pages still awaiting text extraction. */
  pending: number[];
  /** Page -> accumulated rotation in degrees (metadata only, no re-extract). */
  rotations: Record<number, number>;
  /**
   * Page/unit -> human label, for engines whose index units are named sections
   * (EPUB sections) rather than numbered pages.
   */
  labels?: Record<number, string>;
  /**
   * What the units were cut from (see `BuildOptions.signature`). Absent for formats whose units
   * come straight from the file (EPUB sections, PDF pages).
   */
  signature?: string;
  index: IndexShape;
  error?: string;
}

export interface IndexProgress {
  status: IndexStatus;
  done: number;
  total: number;
}

// ------------------------------------------------------------------ worker --

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
let seq = 0;
const inflight = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("../workers/search-index.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, index, pages, error } = e.data ?? {};
      const p = inflight.get(id);
      if (!p) return;
      inflight.delete(id);
      if (ok) p.resolve(index ?? pages);
      else p.reject(new Error(error ?? "index worker failed"));
    };
    worker.onerror = () => {
      for (const p of inflight.values()) p.reject(new Error("index worker crashed"));
      inflight.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

async function call<T>(req: Record<string, unknown>): Promise<T> {
  const w = getWorker();
  if (!w) {
    // No worker (SSR / old browser): run the same code inline.
    const mod = await import("@/workers/search-index.worker");
    switch (req["type"]) {
      case "indexPages":
        return mod.indexPages(req["index"] as IndexShape, req["entries"] as never, "pages") as T;
      case "indexNotes":
        return mod.indexPages(req["index"] as IndexShape, req["entries"] as never, "notes") as T;
      case "movePage":
        return mod.movePage(
          req["index"] as IndexShape,
          req["from"] as number,
          req["to"] as number,
        ) as T;
      case "deletePage":
        return mod.deletePage(req["index"] as IndexShape, req["page"] as number) as T;
      case "appendPages":
        return mod.appendPages(req["index"] as IndexShape, req["count"] as number) as T;
      default:
        return mod.candidatePages(
          req["index"] as IndexShape,
          req["query"] as string,
          req["wholeWord"] as boolean,
        ) as T;
    }
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    inflight.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, ...req });
  });
}

// ------------------------------------------------------------- persistence --

const hasIdb = () => typeof indexedDB !== "undefined";

/** Cheap status record, kept in its own store so the UI never loads postings. */
export interface SearchMetaRecord {
  bookId: string;
  version: number;
  status: IndexStatus;
  builtAt: number;
  pageCount: number;
  pending: number;
  error?: string;
}

export async function readIndex(bookId: string): Promise<SearchIndexRecord | undefined> {
  if (!hasIdb()) return undefined;
  const db = await getDb();
  if (!db.objectStoreNames.contains("searchIndex")) return undefined;
  return (await db.get("searchIndex", bookId)) as SearchIndexRecord | undefined;
}

export async function readIndexMeta(bookId: string): Promise<SearchMetaRecord | undefined> {
  if (!hasIdb()) return undefined;
  const db = await getDb();
  if (!db.objectStoreNames.contains("searchMeta")) return undefined;
  return (await db.get("searchMeta", bookId)) as SearchMetaRecord | undefined;
}

/**
 * Stores an index record and its status record, unless the book is no longer on the shelf.
 *
 * A build writes after every batch and can take a while, and the book can be deleted in between.
 * `deleteBook` removes the book's index records, so a write that came after it would put them back
 * for good: nothing reads them (the shelf search filters by the books it has) but they are loaded by
 * every query and kept for ever. The check and the writes are one transaction on the book store and
 * both index stores, and `deleteBook` writes to all three, so IndexedDB runs one of them entirely
 * before the other: either the write lands and the delete then removes it, or the delete comes
 * first and the write finds no book.
 *
 * Returns false only when the book is gone (nothing was written and the build should stop). Where
 * there is no IndexedDB, or no store to write to, there is nothing to protect and it returns true.
 */
export async function writeIndex(record: SearchIndexRecord): Promise<boolean> {
  if (!hasIdb()) return true;
  const db = await getDb();
  if (!db.objectStoreNames.contains("searchIndex")) return true;
  const names = ["books", "searchIndex", "searchMeta"].filter((n) =>
    db.objectStoreNames.contains(n),
  );
  const tx = db.transaction(names, "readwrite");
  if (names.includes("books") && !(await tx.objectStore("books").getKey(record.bookId))) {
    await tx.done;
    return false;
  }
  await tx.objectStore("searchIndex").put(record);
  if (names.includes("searchMeta")) {
    const meta: SearchMetaRecord = {
      bookId: record.bookId,
      version: record.version,
      status: record.status,
      builtAt: record.builtAt,
      pageCount: record.index.pageCount,
      pending: record.pending.length,
      ...(record.error ? { error: record.error } : {}),
    };
    await tx.objectStore("searchMeta").put(meta);
  }
  await tx.done;
  return true;
}

/**
 * Removes the index and status records of books that are no longer on the shelf (left by builds
 * that were still writing when their book was deleted, in versions before `writeIndex` checked).
 * Returns how many books' records were removed. Reads only keys, so it is cheap on a large shelf.
 */
export async function sweepOrphanIndexes(): Promise<number> {
  if (!hasIdb()) return 0;
  const db = await getDb();
  const stores = ["searchIndex", "searchMeta"].filter((n) => db.objectStoreNames.contains(n));
  if (!stores.length || !db.objectStoreNames.contains("books")) return 0;
  const tx = db.transaction(["books", ...stores], "readwrite");
  const live = new Set((await tx.objectStore("books").getAllKeys()) as string[]);
  const removed = new Set<string>();
  for (const name of stores) {
    const store = tx.objectStore(name);
    for (const key of (await store.getAllKeys()) as string[]) {
      if (live.has(key)) continue;
      await store.delete(key);
      removed.add(key);
    }
  }
  await tx.done;
  return removed.size;
}

export async function dropIndex(bookId: string): Promise<void> {
  if (!hasIdb()) return;
  const db = await getDb();
  if (db.objectStoreNames.contains("searchIndex")) await db.delete("searchIndex", bookId);
  if (db.objectStoreNames.contains("searchMeta")) await db.delete("searchMeta", bookId);
}

function blank(bookId: string, pageCount: number): SearchIndexRecord {
  return {
    bookId,
    version: INDEX_VERSION,
    builtAt: 0,
    status: "idle",
    pending: Array.from({ length: pageCount }, (_, i) => i + 1),
    rotations: {},
    index: emptyIndex(pageCount),
  };
}

// ----------------------------------------------------------------- building --

const idle = (fn: () => void) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (ric) ric(fn);
  else setTimeout(fn, 0);
};

export interface BuildOptions {
  bookId: string;
  pageCount: number;
  extract: (page: number) => Promise<string>;
  onProgress?: (p: IndexProgress) => void;
  signal?: AbortSignal;
  /** Pages to (re)extract regardless of the pending list. */
  force?: number[];
  /** Extraction batch size between yields. */
  batch?: number;
  /** Human label for a unit, stored alongside the postings for hit lists. */
  label?: (page: number) => string;
  /**
   * For formats whose units are cut from the text by us (plain text, HTML), a value that changes
   * when the text does. An index built from other text, by the same number of units, is rebuilt
   * rather than trusted. Leave it out for EPUB and PDF, whose units come from the file.
   */
  signature?: string;
}

/**
 * Bring a book's index up to date, extracting only the pages that are missing.
 * Safe to call on every reader open — a ready index resolves immediately.
 */
/**
 * Two builders can meet on one book: the shelf indexes books it has not opened, and the reader
 * indexes the book it has open. Each record is read, extended and written back as a whole, so the
 * runs for one book are queued one after another. A run that is aborted returns at its next batch,
 * so the queue moves on quickly.
 */
const buildQueues = new Map<string, Promise<unknown>>();

export function ensureIndex(opts: BuildOptions): Promise<SearchIndexRecord> {
  const previous = buildQueues.get(opts.bookId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => ensureIndexNow(opts));
  buildQueues.set(opts.bookId, run);
  void run.then(
    () => {
      if (buildQueues.get(opts.bookId) === run) buildQueues.delete(opts.bookId);
    },
    () => {
      if (buildQueues.get(opts.bookId) === run) buildQueues.delete(opts.bookId);
    },
  );
  return run;
}

async function ensureIndexNow(opts: BuildOptions): Promise<SearchIndexRecord> {
  const {
    bookId,
    pageCount,
    extract,
    onProgress,
    signal,
    force,
    batch = 8,
    label,
    signature,
  } = opts;
  let record = await readIndex(bookId);

  if (!record || record.version !== INDEX_VERSION) record = blank(bookId, pageCount);
  else if (record.index.pageCount !== pageCount) {
    // Page count drifted without going through an incremental op — rebuild.
    record = blank(bookId, pageCount);
  } else if (signature !== undefined && record.signature !== signature) {
    // Same number of units, different text (another encoding was chosen): the old postings and
    // offsets describe text that is no longer there.
    record = blank(bookId, pageCount);
  }
  if (signature !== undefined) record.signature = signature;

  if (label) {
    // Labels are cheap strings and can change between opens (renamed sections),
    // so they are refreshed on every pass rather than tied to extraction.
    const labels: Record<number, string> = {};
    for (let p = 1; p <= pageCount; p++) {
      const text = label(p);
      if (text) labels[p] = text;
    }
    record.labels = labels;
  }

  const queue = [...new Set([...(force ?? []), ...record.pending])]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);

  if (!queue.length) {
    if (record.status !== "ready" || label) {
      record.status = "ready";
      record.builtAt = Date.now();
      if (!(await writeIndex(record))) return abandoned(record);
    }
    onProgress?.({ status: "ready", done: pageCount, total: pageCount });
    return record;
  }

  record.status = "building";
  if (!(await writeIndex(record))) return abandoned(record);
  onProgress?.({ status: "building", done: pageCount - queue.length, total: pageCount });

  try {
    for (let i = 0; i < queue.length; i += batch) {
      if (signal?.aborted) return record;
      const slice = queue.slice(i, i + batch);
      const entries: { page: number; text: string }[] = [];
      for (const page of slice) {
        if (signal?.aborted) return record;
        try {
          entries.push({ page, text: await extract(page) });
        } catch {
          entries.push({ page, text: "" });
        }
      }
      record.index = await call<IndexShape>({
        type: "indexPages",
        index: record.index,
        entries,
      });
      record.pending = record.pending.filter((p) => !slice.includes(p));
      // The book was deleted while it was being indexed: stop, there is nobody to index for.
      if (!(await writeIndex(record))) return abandoned(record);
      onProgress?.({
        status: "building",
        done: pageCount - record.pending.length,
        total: pageCount,
      });
      await new Promise<void>((r) => idle(r));
    }
    record.status = "ready";
    record.builtAt = Date.now();
    delete record.error;
  } catch (e) {
    record.status = "failed";
    record.error = e instanceof Error ? e.message : String(e);
  }
  if (!(await writeIndex(record))) return abandoned(record);
  onProgress?.({
    status: record.status,
    done: pageCount - record.pending.length,
    total: pageCount,
  });
  return record;
}

/** What a build hands back when its book is gone: nothing was kept, and it is not "ready". */
function abandoned(record: SearchIndexRecord): SearchIndexRecord {
  record.status = "idle";
  return record;
}

// -------------------------------------------------------------- incremental --

/** Rotation changes pixels, never text: metadata-only update. */
export async function indexRotatePage(bookId: string, page: number, degrees: number) {
  const record = await readIndex(bookId);
  if (!record) return;
  record.rotations[page] = ((record.rotations[page] ?? 0) + degrees) % 360;
  record.builtAt = Date.now();
  await writeIndex(record);
}

/** Reorder: postings are remapped, no page is re-extracted. */
export async function indexMovePage(bookId: string, from: number, to: number) {
  const record = await readIndex(bookId);
  if (!record) return;
  record.index = await call<IndexShape>({
    type: "movePage",
    index: record.index,
    from,
    to,
  });
  record.pending = remapPending(record.pending, record.index.pageCount, from, to);
  record.rotations = remapRotations(record.rotations, record.index.pageCount, from, to);
  record.builtAt = Date.now();
  await writeIndex(record);
}

function remapPending(pending: number[], pageCount: number, from: number, to: number) {
  const order: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (p !== from) order.push(p);
  order.splice(Math.min(to, order.length + 1) - 1, 0, from);
  const map = new Map(order.map((oldPage, i) => [oldPage, i + 1]));
  return pending.map((p) => map.get(p) ?? p).sort((a, b) => a - b);
}

function remapRotations(
  rotations: Record<number, number>,
  pageCount: number,
  from: number,
  to: number,
) {
  const order: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (p !== from) order.push(p);
  order.splice(Math.min(to, order.length + 1) - 1, 0, from);
  const map = new Map(order.map((oldPage, i) => [oldPage, i + 1]));
  const next: Record<number, number> = {};
  for (const [page, deg] of Object.entries(rotations)) {
    const to2 = map.get(Number(page));
    if (to2) next[to2] = deg;
  }
  return next;
}

/** Delete: drop the page's postings and shift the tail down by one. */
export async function indexDeletePage(bookId: string, page: number) {
  const record = await readIndex(bookId);
  if (!record) return;
  record.index = await call<IndexShape>({
    type: "deletePage",
    index: record.index,
    page,
  });
  record.pending = record.pending.filter((p) => p !== page).map((p) => (p > page ? p - 1 : p));
  const rotations: Record<number, number> = {};
  for (const [k, v] of Object.entries(record.rotations)) {
    const n = Number(k);
    if (n === page) continue;
    rotations[n > page ? n - 1 : n] = v;
  }
  record.rotations = rotations;
  record.builtAt = Date.now();
  await writeIndex(record);
}

/** Merge: reserve the appended slots so only they get extracted next pass. */
export async function indexAppendPages(bookId: string, count: number) {
  const record = await readIndex(bookId);
  if (!record || count <= 0) return;
  const first = record.index.pageCount + 1;
  record.index = await call<IndexShape>({
    type: "appendPages",
    index: record.index,
    count,
  });
  for (let p = first; p < first + count; p++) record.pending.push(p);
  record.status = "idle";
  record.builtAt = Date.now();
  await writeIndex(record);
}

/**
 * Annotation text (quote + note) is searchable and changes far more often than
 * page text — it lives in its own field so a note edit re-tokenizes one page.
 */
export async function indexAnnotationText(
  bookId: string,
  entries: { page: number; text: string }[],
) {
  const record = await readIndex(bookId);
  if (!record || !entries.length) return;
  record.index = await call<IndexShape>({
    type: "indexNotes",
    index: record.index,
    entries,
  });
  record.builtAt = Date.now();
  await writeIndex(record);
}

// -------------------------------------------------------------------- query --

export interface IndexQueryOptions extends MatchOptions {
  limit?: number;
}

/**
 * Index-backed search. Resolves candidate pages from the inverted index, then
 * scans only those pages' cached text for exact offsets.
 */
export async function queryIndex(
  record: SearchIndexRecord,
  query: string,
  opts: IndexQueryOptions = {},
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const pages = await call<number[]>({
    type: "query",
    index: record.index,
    query,
    matchCase: !!opts.matchCase,
    wholeWord: !!opts.wholeWord,
  });
  const hits: SearchHit[] = [];
  for (const page of pages) {
    const text = record.index.pages[page];
    if (!text) continue;
    hits.push(
      ...findMatches(
        text,
        query,
        // The offset lets DOM engines land on the match, not just the section.
        (offset) => ({ kind: "page" as const, page, offset }),
        `p${page}`,
        record.labels?.[page] ?? `Page ${page}`,
        opts,
      ),
    );
    if (opts.limit && hits.length >= opts.limit) break;
  }
  return hits;
}
