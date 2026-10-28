/**
 * Phase 7.4 — backup & restore.
 *
 * Export writes a single `.eviota.zip` with fflate: `manifest.json`,
 * `books.json`, `annotations.json`, `sessions.json`, `collections.json`,
 * `settings.json` and a `blobs/` directory. Import validates the manifest
 * with Zod and merges by id — newer `updatedAt`/`addedAt` wins, annotations
 * union by id, unknown fields on a record are preserved.
 */
import { unzip, zip, type Zippable } from "fflate";
import { z } from "zod";
import { listAllAnnotations } from "./annotations";
import { fingerprintBlob, matchOwnCopies } from "./book-identity";
import { getDb, listBooks, type BookRecord } from "./db";
import type { Collection } from "./collections";
import type { ReadingSession } from "./sessions";

export const BACKUP_SCHEMA_VERSION = 1;

/**
 * Backups say `eviota` now. Those written as Nawiri say `nawiri`, and those before that say
 * `folio`; all of them must keep restoring.
 */
const manifestSchema = z.object({
  app: z.enum(["eviota", "nawiri", "folio"]),
  schemaVersion: z.number(),
  createdAt: z.number(),
  includesBlobs: z.boolean(),
  counts: z.object({
    books: z.number(),
    annotations: z.number(),
    sessions: z.number(),
    collections: z.number(),
  }),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export interface BackupProgress {
  (step: string, done: number, total: number): void;
}

interface AnnotationLike {
  id: string;
  bookId: string;
  updatedAt?: number;
  [key: string]: unknown;
}

const SETTINGS_KEY = "nawiri-reader-settings";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 0));

function zipAsync(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data as Uint8Array)));
  });
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files as Record<string, Uint8Array>)));
  });
}

export async function exportBackup(
  options: { includeBlobs?: boolean; onProgress?: BackupProgress } = {},
): Promise<Blob> {
  const includeBlobs = options.includeBlobs ?? true;
  const report = options.onProgress ?? (() => {});
  const db = await getDb();
  const books = (await listBooks()) as BookRecord[];
  const annotations = (await listAllAnnotations()) as unknown as AnnotationLike[];
  const sessions = (await db.getAll("sessions")) as ReadingSession[];
  const collections = (await db.getAll("collections")) as Collection[];

  const files: Zippable = {};
  // Covers travel as base64 inside books.json so the JSON stays self-contained. Each book that
  // has a file also carries a fingerprint of it, so a restore (a metadata-only one above all)
  // can tell which of the device's own books it is, whatever id and name that copy has there.
  const bookRows = await Promise.all(
    books.map(async (book) => {
      const { cover, ...rest } = book;
      const coverB64 = cover ? await blobToBase64(cover) : undefined;
      const file = (await db.get("files", book.id)) as Blob | undefined;
      const fingerprint = file ? await fingerprintBlob(file) : undefined;
      return {
        ...rest,
        ...(coverB64 ? { coverB64 } : {}),
        ...(fingerprint ? { fingerprint } : {}),
      };
    }),
  );

  files["books.json"] = encode(bookRows);
  files["annotations.json"] = encode(annotations);
  files["sessions.json"] = encode(sessions);
  files["collections.json"] = encode(collections);
  files["settings.json"] = encode(readSettings());

  if (includeBlobs) {
    let done = 0;
    for (const book of books) {
      const blob = (await db.get("files", book.id)) as Blob | undefined;
      if (blob) {
        files[`blobs/${book.id}`] = new Uint8Array(await blob.arrayBuffer());
      }
      report("Packing books", ++done, books.length);
    }
  }

  const manifest: BackupManifest = {
    app: "eviota",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: Date.now(),
    includesBlobs: includeBlobs,
    counts: {
      books: books.length,
      annotations: annotations.length,
      sessions: sessions.length,
      collections: collections.length,
    },
  };
  files["manifest.json"] = encode(manifest);

  report("Compressing", 1, 1);
  const bytes = await zipAsync(files);
  return new Blob([bytes as BlobPart], { type: "application/zip" });
}

export interface RestoreResult {
  manifest: BackupManifest;
  booksAdded: number;
  booksUpdated: number;
  annotations: number;
  sessions: number;
  collections: number;
}

export async function importBackup(
  file: Blob,
  onProgress?: BackupProgress,
): Promise<RestoreResult> {
  const report = onProgress ?? (() => {});
  const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  // The Settings screen shows this message as it is, so a manifest that fails to validate says so
  // in a sentence rather than with the validator's list of issues (which is what `parse` throws).
  const parsed = manifestSchema.safeParse(readJson(entries["manifest.json"], null));
  if (!parsed.success) throw new Error("That file isn't an Eviota backup.");
  const manifest = parsed.data;
  if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error("This backup was made by a newer version of Eviota.");
  }

  const incomingBooks = (
    readJson(entries["books.json"], []) as (BookRecord & {
      coverB64?: string;
      fingerprint?: string;
    })[]
  ).filter((b) => b && typeof b.id === "string");
  const incomingAnnotations = (
    readJson(entries["annotations.json"], []) as AnnotationLike[]
  ).filter((a) => a && typeof a.id === "string");
  const incomingSessions = (readJson(entries["sessions.json"], []) as ReadingSession[]).filter(
    (s) => s && typeof s.id === "string",
  );
  const incomingCollections = (readJson(entries["collections.json"], []) as Collection[]).filter(
    (c) => c && typeof c.id === "string",
  );

  const db = await getDb();
  const ownBooks = (await db.getAll("books")) as BookRecord[];
  const existing = new Map(ownBooks.map((b) => [b.id, b]));

  // A book this device holds under another id is the same book when it is the same file. Its
  // marks, sessions and collection entries are moved onto the device's own copy.
  const ownCopies = await matchOwnCopies(incomingBooks, ownBooks, async (id) => {
    const file = (await db.get("files", id)) as Blob | undefined;
    return file ? fingerprintBlob(file) : undefined;
  });
  const targetOf = (backupId: string) => ownCopies.get(backupId)?.id ?? backupId;

  let added = 0;
  let updated = 0;
  let done = 0;
  for (const raw of incomingBooks) {
    const { coverB64, fingerprint: _fingerprint, ...record } = raw;
    const cover = coverB64 ? base64ToBlob(coverB64) : undefined;
    const own = ownCopies.get(record.id);
    const targetId = own?.id ?? record.id;
    const incoming: BookRecord = { ...record, id: targetId, ...(cover ? { cover } : {}) };
    const prev = own ?? existing.get(record.id);
    let merged = mergeBook(prev, incoming);
    // What describes the file stays what this device's copy says.
    if (own) {
      merged = { ...merged, fileName: own.fileName, size: own.size, addedAt: own.addedAt };
    }
    if (prev) updated++;
    else added++;

    const blob = entries[`blobs/${record.id}`];
    let hasFile = !!(await db.get("files", targetId));
    if (blob && (!own || !hasFile)) {
      await db.put(
        "files",
        new Blob([blob as BlobPart], { type: "application/octet-stream" }),
        targetId,
      );
      hasFile = true;
      merged = { ...merged, blobEvicted: false };
    }
    // The flag follows the file this device actually holds, never what the backup's device said
    // about its own. Without a file the record asks for one (a metadata-only backup restored on a
    // device that lacks the book), instead of looking like a book that is there and cannot be
    // opened; with one, a stale "removed" from the backup is cleared.
    if (!hasFile) merged = { ...merged, blobEvicted: true };
    else if (merged.blobEvicted) merged = { ...merged, blobEvicted: false };
    await db.put("books", merged);
    report("Restoring books", ++done, incomingBooks.length);
  }

  for (const annotation of incomingAnnotations) {
    const moved = { ...annotation, bookId: targetOf(String(annotation.bookId)) };
    const prev = (await db.get("annotations", annotation.id)) as AnnotationLike | undefined;
    await db.put("annotations", mergeAnnotation(prev, moved));
  }
  for (const session of incomingSessions) {
    if (!(await db.get("sessions", session.id))) {
      await db.put("sessions", { ...session, bookId: targetOf(session.bookId) });
    }
  }
  for (const collection of incomingCollections) {
    const moved = {
      ...collection,
      bookIds: Array.isArray(collection.bookIds) ? collection.bookIds.map(targetOf) : [],
    };
    const prev = (await db.get("collections", collection.id)) as Collection | undefined;
    await db.put("collections", mergeCollection(prev, moved));
  }

  const settings = readJson(entries["settings.json"], null);
  if (settings && typeof settings === "object") writeSettings(settings);

  return {
    manifest,
    booksAdded: added,
    booksUpdated: updated,
    annotations: incomingAnnotations.length,
    sessions: incomingSessions.length,
    collections: incomingCollections.length,
  };
}

// -------------------------------------------------------------- pure merges

/** Newest record wins field-by-field; unknown fields on either side survive. */
export function mergeBook(prev: BookRecord | undefined, incoming: BookRecord): BookRecord {
  if (!prev) return incoming;
  const prevStamp = prev.progress?.updatedAt ?? prev.lastOpenedAt ?? prev.addedAt ?? 0;
  const nextStamp = incoming.progress?.updatedAt ?? incoming.lastOpenedAt ?? incoming.addedAt ?? 0;
  const winner = nextStamp >= prevStamp ? incoming : prev;
  const loser = winner === incoming ? prev : incoming;
  const tags = Array.from(new Set([...(prev.tags ?? []), ...(incoming.tags ?? [])])).sort((a, b) =>
    a.localeCompare(b),
  );
  const merged: BookRecord = { ...loser, ...winner };
  if (tags.length) merged.tags = tags;
  if (!merged.cover && (prev.cover || incoming.cover)) {
    merged.cover = prev.cover ?? incoming.cover;
    merged.hasCover = true;
  }
  return merged;
}

export function mergeAnnotation<T extends AnnotationLike>(prev: T | undefined, incoming: T): T {
  if (!prev) return incoming;
  return (incoming.updatedAt ?? 0) >= (prev.updatedAt ?? 0)
    ? { ...prev, ...incoming }
    : { ...incoming, ...prev };
}

export function mergeCollection(prev: Collection | undefined, incoming: Collection): Collection {
  if (!prev) return incoming;
  return {
    ...prev,
    ...incoming,
    bookIds: Array.from(new Set([...prev.bookIds, ...incoming.bookIds])),
  };
}

// ------------------------------------------------------------------ helpers

function readJson(bytes: Uint8Array | undefined, fallback: unknown): unknown {
  if (!bytes) return fallback;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fallback;
  }
}

function readSettings(): unknown {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeSettings(settings: unknown): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `${blob.type || "image/jpeg"};${btoa(binary)}`;
}

function base64ToBlob(value: string): Blob {
  const sep = value.indexOf(";");
  const type = sep > 0 ? value.slice(0, sep) : "image/jpeg";
  const binary = atob(value.slice(sep + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes as BlobPart], { type });
}

export function backupFileName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `eviota-${stamp}.eviota.zip`;
}
