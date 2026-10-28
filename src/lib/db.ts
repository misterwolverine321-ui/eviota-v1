import { openDB, type IDBPDatabase } from "idb";

export interface BookProgress {
  kind: "cfi" | "page" | "fraction";
  cfi?: string;
  page?: number;
  fraction: number;
  updatedAt: number;
}

export interface BookRecord {
  id: string;
  title: string;
  author: string;
  format: string; // extension, lowercase
  fileName: string;
  size: number;
  addedAt: number;
  lastOpenedAt?: number;
  hasCover: boolean;
  cover?: Blob;
  progress?: BookProgress | null;
  /** Resolved / user-chosen charset for plain-text sources. */
  encoding?: string;
  /** Prefer the extracted article body for saved web pages. */
  cleanView?: boolean;
  /**
   * §6.4: run OCR over image-only pages (comics / scans) to build a text layer.
   * Opt-in per book — OCR of a 200-page scan is minutes of CPU.
   */
  ocrEnabled?: boolean;
  /** Free-form tags used by the library filter chips. */
  tags?: string[];
  /** Source blob dropped to free space; record + progress kept. */
  blobEvicted?: boolean;
  /** Comic series name (ComicInfo.xml sidecar or file name). */
  series?: string;
  /** Issue number within the series; may be fractional. */
  seriesIndex?: number;
  /** Total issues in the series, when the sidecar declares it. */
  seriesTotal?: number;
  /**
   * Per-book sharp-zoom override. Undefined follows the global
   * reader setting; a scan that needs more (or no) upscaling keeps its own.
   */
  sharpZoom?: boolean;
  /** Per-book unsharp strength for the upscale, 0..100. Undefined = global. */
  sharpAmount?: number;
}

/**
 * Internal identifier, deliberately NOT renamed with the app. The project was
 * called Folio before it was Nawiri and then Eviota. IndexedDB has no rename operation, so a
 * new name would orphan every book already saved under this one, and copying a
 * multi-gigabyte library on first start is a worse risk than an identifier
 * nobody sees. Never shown in the UI.
 */
const DB_NAME = "folio-library";
const DB_VERSION = 5;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("books", { keyPath: "id" });
          db.createObjectStore("files"); // id -> Blob
        }
        if (oldVersion < 2) {
          // Highlights, notes and bookmarks, anchored per book.
          const store = db.createObjectStore("annotations", { keyPath: "id" });
          store.createIndex("bookId", "bookId");
        }
        if (oldVersion < 3) {
          // Persisted per-book search index. The heavy postings blob
          // lives in `searchIndex`; `searchMeta` holds the cheap status record
          // so the UI can read build state without deserializing the index.
          db.createObjectStore("searchIndex", { keyPath: "bookId" });
          db.createObjectStore("searchMeta", { keyPath: "bookId" });
        }
        if (oldVersion < 4) {
          // Reading sessions and collections.
          const sessions = db.createObjectStore("sessions", { keyPath: "id" });
          sessions.createIndex("bookId", "bookId");
          db.createObjectStore("collections", { keyPath: "id" });
        }
        if (oldVersion < 5) {
          // Deletion tombstones so a sync merge can tell "never had
          // it" from "deleted it here". Keyed by the deleted record's id.
          const tombs = db.createObjectStore("tombstones", { keyPath: "id" });
          tombs.createIndex("bookId", "bookId");
        }
      },
    });
  }
  return dbPromise;
}

const hasIdb = () => typeof indexedDB !== "undefined";

export async function listBooks(): Promise<BookRecord[]> {
  if (!hasIdb()) return [];
  const db = await getDb();
  return (await db.getAll("books")) as BookRecord[];
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  if (!hasIdb()) return undefined;
  const db = await getDb();
  return (await db.get("books", id)) as BookRecord | undefined;
}

export async function getBookFile(id: string): Promise<Blob | undefined> {
  if (!hasIdb()) return undefined;
  const db = await getDb();
  return (await db.get("files", id)) as Blob | undefined;
}

export async function putBook(record: BookRecord, file: Blob): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["books", "files"], "readwrite");
  await tx.objectStore("books").put(record);
  await tx.objectStore("files").put(file, record.id);
  await tx.done;
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  const stores = [
    "books",
    "files",
    "annotations",
    "searchIndex",
    "searchMeta",
    "sessions",
    "collections",
  ].filter((name) => db.objectStoreNames.contains(name));
  const tx = db.transaction(stores, "readwrite");
  await tx.objectStore("books").delete(id);
  await tx.objectStore("files").delete(id);
  if (stores.includes("searchIndex")) await tx.objectStore("searchIndex").delete(id);
  if (stores.includes("searchMeta")) await tx.objectStore("searchMeta").delete(id);
  const annotations = tx.objectStore("annotations");
  const keys = await annotations.index("bookId").getAllKeys(id);
  await Promise.all(keys.map((k) => annotations.delete(k)));
  if (stores.includes("sessions")) {
    const sessions = tx.objectStore("sessions");
    const sessionKeys = await sessions.index("bookId").getAllKeys(id);
    await Promise.all(sessionKeys.map((k) => sessions.delete(k)));
  }
  if (stores.includes("collections")) {
    const collections = tx.objectStore("collections");
    const all = (await collections.getAll()) as { id: string; bookIds: string[] }[];
    await Promise.all(
      all
        .filter((c) => c.bookIds?.includes(id))
        .map((c) => collections.put({ ...c, bookIds: c.bookIds.filter((b) => b !== id) })),
    );
  }
  await tx.done;
}

export interface Tombstone {
  id: string;
  bookId: string;
  kind: "annotation" | "book";
  deletedAt: number;
}

/** Record a deletion so sync doesn't resurrect it from another device. */
export async function recordTombstone(
  id: string,
  bookId: string,
  kind: Tombstone["kind"] = "annotation",
): Promise<void> {
  if (!hasIdb()) return;
  const db = await getDb();
  if (!db.objectStoreNames.contains("tombstones")) return;
  await db.put("tombstones", { id, bookId, kind, deletedAt: Date.now() } satisfies Tombstone);
}

export async function patchBook(id: string, patch: Partial<BookRecord>): Promise<void> {
  const db = await getDb();
  const existing = (await db.get("books", id)) as BookRecord | undefined;
  if (!existing) return;
  await db.put("books", { ...existing, ...patch });
}

/**
 * Replace a book's file blob in place.
 * Keeps the record id stable so annotations and progress survive.
 */
export async function putBookFile(id: string, file: Blob): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["books", "files"], "readwrite");
  await tx.objectStore("files").put(file, id);
  const existing = (await tx.objectStore("books").get(id)) as BookRecord | undefined;
  if (existing) {
    await tx.objectStore("books").put({ ...existing, size: file.size });
  }
  await tx.done;
}
