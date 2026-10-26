import type { BookRecord } from "./db";

/**
 * Is this backup's book the same file as one the device already holds?
 *
 * Books are keyed by a random id made at import, so two devices that each imported the same
 * file hold it under different ids. A backup that carries only metadata (notes, progress) has to
 * be attached to the device's own copy by what the file IS, or it lands on a fileless duplicate.
 *
 * The identity is the format and size, plus either a fingerprint of the content (backups made
 * from this version on carry one) or, for older backups, the file name. The fingerprint reads
 * three 64 KiB windows of the file (start, middle, end) and its size, so it costs the same for a
 * 2 MB EPUB and a 700 MB comic archive and never loads the file into memory. It is a name for
 * the file, not a proof: two files that agree in size and in all three windows would be taken
 * for one, and for books that means a re-save that changed bytes only elsewhere.
 */

const WINDOW = 64 * 1024;

/** 53-bit non-cryptographic hash (cyrb53), run twice with different seeds for 106 bits. */
function cyrb53(bytes: Uint8Array, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < bytes.length; i++) {
    const ch = bytes[i]!;
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const hex14 = (n: number) => n.toString(16).padStart(14, "0");

/** A short name for a file's content: 28 hex characters. Same bytes, same name, on any device. */
export async function fingerprintBlob(blob: Blob): Promise<string> {
  const size = blob.size;
  const parts =
    size <= WINDOW * 3
      ? [blob]
      : [
          blob.slice(0, WINDOW),
          blob.slice(Math.floor((size - WINDOW) / 2), Math.floor((size - WINDOW) / 2) + WINDOW),
          blob.slice(size - WINDOW, size),
        ];
  const prefix = new TextEncoder().encode(`${size}:`);
  const buffers = await Promise.all(parts.map(async (p) => new Uint8Array(await p.arrayBuffer())));
  const all = new Uint8Array(prefix.length + buffers.reduce((n, b) => n + b.length, 0));
  all.set(prefix, 0);
  let at = prefix.length;
  for (const b of buffers) {
    all.set(b, at);
    at += b.length;
  }
  return hex14(cyrb53(all, 0)) + hex14(cyrb53(all, 1));
}

/** The fields of a backup's book that identify its file. */
export interface IncomingBook {
  id: string;
  format?: string;
  size?: number;
  fileName?: string;
  /** From `fingerprintBlob`; absent in backups made before it existed. */
  fingerprint?: string;
}

const sameName = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * For each backup book that the device does not already hold under the same id, find the
 * device's own copy of the file, if any. Keys are backup ids. One own copy goes to one backup
 * book; when the device holds the file twice, the one added first is taken.
 *
 * `fingerprintOf` reads the fingerprint of an own book's stored file (undefined when it has
 * none); it is called only for candidates that already agree in format and size.
 */
export async function matchOwnCopies(
  incoming: IncomingBook[],
  own: BookRecord[],
  fingerprintOf: (ownId: string) => Promise<string | undefined>,
): Promise<Map<string, BookRecord>> {
  const incomingIds = new Set(incoming.map((b) => b.id));
  const ownIds = new Set(own.map((b) => b.id));
  const free = own
    .filter((b) => !incomingIds.has(b.id))
    .sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  const taken = new Set<string>();
  const matches = new Map<string, BookRecord>();

  for (const book of incoming) {
    if (ownIds.has(book.id)) continue; // already the same book by id
    if (typeof book.size !== "number" || book.size <= 0) continue;
    for (const candidate of free) {
      if (taken.has(candidate.id)) continue;
      if (candidate.format !== book.format || candidate.size !== book.size) continue;
      let same: boolean;
      const theirs = book.fingerprint;
      const mine = theirs ? await fingerprintOf(candidate.id) : undefined;
      if (theirs && mine) same = theirs === mine;
      else same = sameName(candidate.fileName, book.fileName);
      if (!same) continue;
      taken.add(candidate.id);
      matches.set(book.id, candidate);
      break;
    }
  }
  return matches;
}

const COMPARE_CHUNK = 1024 * 1024;

/**
 * Byte-for-byte equality, read in 1 MiB pieces so that two large files are never in memory at
 * once. The fingerprint narrows the search; this decides, so a collision cannot skip a book.
 */
export async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  for (let start = 0; start < a.size; start += COMPARE_CHUNK) {
    const end = Math.min(a.size, start + COMPARE_CHUNK);
    const [x, y] = await Promise.all([
      a.slice(start, end).arrayBuffer(),
      b.slice(start, end).arrayBuffer(),
    ]);
    const left = new Uint8Array(x);
    const right = new Uint8Array(y);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  }
  return true;
}

/** A book already on the device, with a way to read its stored file. */
export interface SameFileCandidate {
  record: BookRecord;
  /** The stored file, or undefined when the device no longer holds it. */
  load: () => Promise<Blob | undefined>;
}

/**
 * The book on the device that is the same file as `file`, or null. Same format and size, then the
 * same fingerprint, then the same bytes. A candidate whose file is gone can only be matched by
 * name and size, as before; that is the one case where the name decides.
 */
export async function findSameFile(
  file: File,
  format: string,
  candidates: SameFileCandidate[],
): Promise<BookRecord | null> {
  let incoming: Promise<string> | undefined;
  for (const { record, load } of candidates) {
    if (record.format !== format || record.size !== file.size) continue;
    const stored = await load();
    if (!stored) {
      if (record.fileName === file.name) return record;
      continue;
    }
    incoming ??= fingerprintBlob(file);
    if ((await incoming) !== (await fingerprintBlob(stored))) continue;
    if (await sameBytes(file, stored)) return record;
  }
  return null;
}
