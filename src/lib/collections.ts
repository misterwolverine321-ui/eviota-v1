/**
 * Phase 7.2 — collections and tags (DB v4).
 *
 * Collections are an explicit, ordered grouping stored in their own object
 * store with a `bookIds` join array; tags are free-form strings on the book
 * record. Filtering is pure so the library page can compose it with the
 * existing metadata search and sort.
 */
import { getDb, patchBook, type BookRecord } from "./db";

/** Phase 7.4 — derived reading state used by the faceted status filter. */
export type BookStatus = "unread" | "reading" | "finished";

/**
 * Smart-collection rule. Every present field must match (AND), so membership
 * is *computed* from the shelf rather than stored in `bookIds`.
 */
export interface SmartRule {
  status?: BookStatus;
  format?: string;
  tag?: string;
}

export interface Collection {
  id: string;
  name: string;
  color: string;
  order: number;
  bookIds: string[];
  /** When set the collection is smart: `bookIds` is ignored. */
  rule?: SmartRule | null;
}

export const COLLECTION_COLORS = ["#c2410c", "#0f766e", "#4338ca", "#a21caf", "#65a30d", "#b91c1c"];

const hasIdb = () => typeof indexedDB !== "undefined";

export async function listCollections(): Promise<Collection[]> {
  if (!hasIdb()) return [];
  const db = await getDb();
  const all = (await db.getAll("collections")) as Collection[];
  return all.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function createCollection(name: string, rule?: SmartRule | null): Promise<Collection> {
  const existing = await listCollections();
  const collection: Collection = {
    id: `col_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Untitled",
    color: COLLECTION_COLORS[existing.length % COLLECTION_COLORS.length],
    order: existing.length,
    bookIds: [],
    rule: rule ?? null,
  };
  const db = await getDb();
  await db.put("collections", collection);
  return collection;
}

export async function putCollection(collection: Collection): Promise<void> {
  const db = await getDb();
  await db.put("collections", collection);
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("collections", id);
}

export async function toggleBookInCollection(
  collectionId: string,
  bookId: string,
): Promise<Collection | undefined> {
  const db = await getDb();
  const collection = (await db.get("collections", collectionId)) as Collection | undefined;
  if (!collection) return undefined;
  const bookIds = collection.bookIds.includes(bookId)
    ? collection.bookIds.filter((b) => b !== bookId)
    : [...collection.bookIds, bookId];
  const next = { ...collection, bookIds };
  await db.put("collections", next);
  return next;
}

export async function setBookTags(bookId: string, tags: string[]): Promise<void> {
  await patchBook(bookId, { tags: normalizeTags(tags) });
}

// ------------------------------------------------------------------- pure

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function allTags(books: BookRecord[]): string[] {
  return normalizeTags(books.flatMap((b) => b.tags ?? []));
}

/** A book counts as finished once it is within a page of the end. */
export const FINISHED_FRACTION = 0.98;

/**
 * Derived reading state: finished when progress reaches the tail of the book,
 * reading once it has been opened or has any progress, unread otherwise.
 */
export function bookStatus(book: BookRecord): BookStatus {
  const fraction = book.progress?.fraction ?? 0;
  if (fraction >= FINISHED_FRACTION) return "finished";
  if (fraction > 0 || book.lastOpenedAt) return "reading";
  return "unread";
}

export function isSmartCollection(collection: Collection): boolean {
  const rule = collection.rule;
  return !!rule && (!!rule.status || !!rule.format || !!rule.tag);
}

/** Does a book satisfy every field of a smart rule? */
export function matchesRule(book: BookRecord, rule: SmartRule): boolean {
  if (rule.status && bookStatus(book) !== rule.status) return false;
  if (rule.format && book.format.toLowerCase() !== rule.format.toLowerCase()) return false;
  if (rule.tag && !(book.tags ?? []).some((t) => t.toLowerCase() === rule.tag!.toLowerCase()))
    return false;
  return true;
}

/** Membership: computed for smart collections, stored otherwise. */
export function collectionBooks(collection: Collection, books: BookRecord[]): BookRecord[] {
  if (isSmartCollection(collection)) return books.filter((b) => matchesRule(b, collection.rule!));
  return books.filter((b) => collection.bookIds.includes(b.id));
}

export function inCollection(collection: Collection, book: BookRecord): boolean {
  return isSmartCollection(collection)
    ? matchesRule(book, collection.rule!)
    : collection.bookIds.includes(book.id);
}

export interface LibraryFilter {
  collection?: Collection | null;
  tags?: string[];
  status?: BookStatus | null;
}

/**
 * Books in the collection (stored or smart) that carry *every* selected tag
 * and match the selected reading status facet.
 */
export function filterBooks(
  books: BookRecord[],
  { collection, tags = [], status = null }: LibraryFilter,
): BookRecord[] {
  const wanted = tags.map((t) => t.toLowerCase());
  return books.filter((book) => {
    if (collection && !inCollection(collection, book)) return false;
    if (status && bookStatus(book) !== status) return false;
    if (!wanted.length) return true;
    const own = (book.tags ?? []).map((t) => t.toLowerCase());
    return wanted.every((t) => own.includes(t));
  });
}
