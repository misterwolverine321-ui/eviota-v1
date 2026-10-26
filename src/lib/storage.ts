/**
 * Phase 7.3 — storage meter and eviction handling.
 *
 * `navigator.storage.estimate()` gives the browser-level picture; the per-book
 * tally walks the stores Eviota owns so "Free up space" can drop derived data
 * (search index, covers, panels) while keeping the source blob, annotations
 * and progress intact.
 */
import { getDb, patchBook, putBookFile, type BookRecord } from "./db";

export interface StorageEstimate {
  usage: number;
  quota: number;
  persisted: boolean;
}

export interface BookTally {
  bookId: string;
  source: number;
  cover: number;
  index: number;
  total: number;
}

const hasIdb = () => typeof indexedDB !== "undefined";

export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  let persisted = false;
  try {
    persisted = (await navigator.storage.persisted?.()) ?? false;
  } catch {
    persisted = false;
  }
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}

/** Ask for persistent storage so the library survives eviction pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function byteSize(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export async function tallyBook(book: BookRecord): Promise<BookTally> {
  const empty: BookTally = {
    bookId: book.id,
    source: 0,
    cover: byteSize(book.cover),
    index: 0,
    total: 0,
  };
  if (!hasIdb()) return empty;
  const db = await getDb();
  const file = (await db.get("files", book.id)) as Blob | undefined;
  const index = await db.get("searchIndex", book.id);
  const tally: BookTally = {
    ...empty,
    source: file?.size ?? 0,
    index: byteSize(index),
  };
  tally.total = tally.source + tally.cover + tally.index;
  return tally;
}

export async function tallyLibrary(books: BookRecord[]): Promise<BookTally[]> {
  return Promise.all(books.map((b) => tallyBook(b)));
}

/** Tier 1: drop derived data only. Source blob, notes and progress survive. */
export async function freeDerived(bookId: string): Promise<void> {
  if (!hasIdb()) return;
  const db = await getDb();
  for (const store of ["searchIndex", "searchMeta"]) {
    if (db.objectStoreNames.contains(store)) await db.delete(store, bookId);
  }
}

/** Tier 2: also drop the source blob; the record, progress and notes stay. */
export async function evictSource(bookId: string): Promise<void> {
  if (!hasIdb()) return;
  await freeDerived(bookId);
  const db = await getDb();
  await db.delete("files", bookId);
  await patchBook(bookId, { blobEvicted: true });
}

/**
 * Undo tier 2 for one book: put the source file back under the SAME record id,
 * so notes, bookmarks and reading progress (which are keyed by that id) line up
 * again. Importing the file as a new book would not do this: it gets a fresh
 * id, no progress, and leaves the evicted card behind.
 *
 * Callers must run `checkReattach` first; this does not validate the file.
 * The search index (dropped by tier 1) is rebuilt lazily when the book opens.
 */
export async function reattachSource(bookId: string, file: Blob): Promise<void> {
  await putBookFile(bookId, file); // also refreshes the stored size
  await patchBook(bookId, { blobEvicted: false });
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
