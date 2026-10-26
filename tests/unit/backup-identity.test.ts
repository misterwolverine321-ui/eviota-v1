// Node environment on purpose, like backup-legacy.test.ts: fake-indexeddb with Node's Blob.
import "fake-indexeddb/auto";
import { unzipSync, zipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportBackup, importBackup } from "@/lib/backup";
import { fingerprintBlob } from "@/lib/book-identity";
import { getBook, getBookFile, getDb, listBooks, putBook, type BookRecord } from "@/lib/db";

/**
 * A metadata-only backup moves notes and progress to a device that already has the books. The
 * device's copy was imported there on its own, under its own random id, so the backup's book has
 * to be matched to it by what the file is, and the marks, sessions and collections re-pointed at
 * it. Before, the restore made a second, fileless record and put everything on that.
 */

beforeAll(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  });
});

const FILE = Uint8Array.from({ length: 5_000 }, (_, i) => (i * 7) % 251);
const OTHER = Uint8Array.from({ length: 5_000 }, (_, i) => (i * 11) % 251);
const nodeBlob = (b: Uint8Array) => new Blob([b as BlobPart]);
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

const record = (id: string, over: Partial<BookRecord> = {}): BookRecord => ({
  id,
  title: "Walden",
  author: "Thoreau",
  format: "epub",
  fileName: "walden.epub",
  size: FILE.length,
  addedAt: 100,
  hasCover: false,
  ...over,
});

const annotation = (id: string, bookId: string, at = 1) => ({
  id,
  bookId,
  anchor: { kind: "cfi", cfi: "epubcfi(/6/4)" },
  type: "highlight",
  color: "yellow",
  text: "I went to the woods",
  createdAt: at,
  updatedAt: at,
});
const session = (id: string, bookId: string) => ({
  id,
  bookId,
  startedAt: 1,
  endedAt: 2,
  activeMs: 1,
  pagesRead: 1,
  words: 1,
  fromFraction: 0,
  toFraction: 0.1,
});
const collection = (id: string, bookIds: string[]) => ({
  id,
  name: "Classics",
  color: "#c2410c",
  order: 0,
  bookIds,
});

async function wipe() {
  const db = await getDb();
  for (const store of ["books", "files", "annotations", "sessions", "collections"]) {
    await db.clear(store);
  }
}
beforeEach(wipe);

/** What device A would hand over: its book (id A1), marks, a session and a collection. */
async function backupFromDeviceA(opts: { includeBlobs: boolean; progressAt?: number }) {
  await putBook(
    record("A1", {
      progress: { kind: "fraction", fraction: 0.6, updatedAt: opts.progressAt ?? 5_000 },
    }),
    nodeBlob(FILE),
  );
  const db = await getDb();
  await db.put("annotations", annotation("a-note", "A1", 10));
  await db.put("sessions", session("s-1", "A1"));
  await db.put("collections", collection("c-1", ["A1"]));
  const bytes = new Uint8Array(
    await (await exportBackup({ includeBlobs: opts.includeBlobs })).arrayBuffer(),
  );
  await wipe();
  return bytes;
}

describe("exportBackup", () => {
  it("names each stored file by its content, with or without the files themselves", async () => {
    for (const includeBlobs of [true, false]) {
      const bytes = await backupFromDeviceA({ includeBlobs });
      const books = JSON.parse(new TextDecoder().decode(unzipSync(bytes)["books.json"]!));
      expect(books).toHaveLength(1);
      expect(books[0].fingerprint).toBe(await fingerprintBlob(nodeBlob(FILE)));
    }
  });

  it("gives no fingerprint to a book that has no file on this device", async () => {
    await putBook(record("E1", { blobEvicted: true }), nodeBlob(FILE));
    const db = await getDb();
    await db.delete("files", "E1");
    const bytes = new Uint8Array(await (await exportBackup({ includeBlobs: false })).arrayBuffer());
    const books = JSON.parse(new TextDecoder().decode(unzipSync(bytes)["books.json"]!));
    expect(books[0].fingerprint).toBeUndefined();
  });
});

describe("restoring a metadata-only backup on a device that has the book", () => {
  it("attaches marks, sessions and collections to the device's own copy, and adds no book", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false });
    await putBook(
      record("B1", {
        addedAt: 200,
        progress: { kind: "fraction", fraction: 0.1, updatedAt: 1_000 },
      }),
      nodeBlob(FILE),
    );

    const result = await importBackup(nodeBlob(backup));

    expect(result.booksAdded).toBe(0);
    expect(result.booksUpdated).toBe(1);
    expect((await listBooks()).map((b) => b.id)).toEqual(["B1"]);

    const db = await getDb();
    expect(((await db.get("annotations", "a-note")) as { bookId: string }).bookId).toBe("B1");
    expect(((await db.get("sessions", "s-1")) as { bookId: string }).bookId).toBe("B1");
    expect(((await db.get("collections", "c-1")) as { bookIds: string[] }).bookIds).toEqual(["B1"]);
    expect(await db.getAllKeysFromIndex("annotations", "bookId", "A1")).toEqual([]);

    // The shelf order is the device's own: the backup's older "added" time does not replace it.
    expect((await getBook("B1"))?.addedAt).toBe(200);
    // The fingerprint names a file in the backup; it is not a field of a stored book.
    expect(await db.get("books", "B1")).not.toHaveProperty("fingerprint");
  });

  it("brings the newer reading position and leaves the device's own file alone", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false, progressAt: 5_000 });
    await putBook(
      record("B1", { progress: { kind: "fraction", fraction: 0.1, updatedAt: 1_000 } }),
      nodeBlob(FILE),
    );

    await importBackup(nodeBlob(backup));

    const book = (await getBook("B1"))!;
    expect(book.progress?.fraction).toBe(0.6);
    expect(book.id).toBe("B1");
    expect(book.blobEvicted).not.toBe(true);
    expect(new Uint8Array(await (await getBookFile("B1"))!.arrayBuffer())).toEqual(FILE);
  });

  it("keeps the device's newer reading position when the backup's is older", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false, progressAt: 500 });
    await putBook(
      record("B1", { progress: { kind: "fraction", fraction: 0.9, updatedAt: 9_000 } }),
      nodeBlob(FILE),
    );
    await importBackup(nodeBlob(backup));
    expect((await getBook("B1"))?.progress?.fraction).toBe(0.9);
  });

  it("is repeatable: restoring the same backup again adds nothing", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false });
    await putBook(record("B1"), nodeBlob(FILE));
    await importBackup(nodeBlob(backup));
    const again = await importBackup(nodeBlob(backup));
    expect(again.booksAdded).toBe(0);
    const db = await getDb();
    expect((await listBooks()).map((b) => b.id)).toEqual(["B1"]);
    expect(await db.count("annotations")).toBe(1);
    expect(await db.count("sessions")).toBe(1);
    expect(((await db.get("collections", "c-1")) as { bookIds: string[] }).bookIds).toEqual(["B1"]);
  });

  it("does not call the device's book file-less because the backup's device had freed its file", async () => {
    // Same id on both devices (an earlier full restore), the backup's record says "file removed"
    // and is the newer one; this device still has the file.
    await putBook(
      record("A1", {
        blobEvicted: true,
        progress: { kind: "fraction", fraction: 0.6, updatedAt: 5_000 },
      }),
      nodeBlob(FILE),
    );
    await (await getDb()).delete("files", "A1");
    const backup = new Uint8Array(
      await (await exportBackup({ includeBlobs: false })).arrayBuffer(),
    );
    await wipe();
    await putBook(
      record("A1", { progress: { kind: "fraction", fraction: 0.1, updatedAt: 1_000 } }),
      nodeBlob(FILE),
    );

    await importBackup(nodeBlob(backup));

    const book = (await getBook("A1"))!;
    expect(book.progress?.fraction).toBe(0.6); // the backup's record did win the merge
    expect(book.blobEvicted).not.toBe(true);
    expect(await getBookFile("A1")).toBeDefined();
  });

  it("matches a renamed copy by its content, and the copy keeps its own name", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false });
    await putBook(record("B1", { fileName: "Walden (1).epub" }), nodeBlob(FILE));
    const result = await importBackup(nodeBlob(backup));
    expect(result.booksAdded).toBe(0);
    expect((await getBook("B1"))?.fileName).toBe("Walden (1).epub");
    expect(
      ((await (await getDb()).get("annotations", "a-note")) as { bookId: string }).bookId,
    ).toBe("B1");
  });

  it("does not match a different file that happens to share the name and size", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false });
    await putBook(record("B1"), nodeBlob(OTHER));
    const result = await importBackup(nodeBlob(backup));
    expect(result.booksAdded).toBe(1);
    expect((await listBooks()).map((b) => b.id).sort()).toEqual(["A1", "B1"]);
    expect(
      ((await (await getDb()).get("annotations", "a-note")) as { bookId: string }).bookId,
    ).toBe("A1");
  });

  it("matches a backup made before fingerprints existed by name and size", async () => {
    const old = zipSync({
      "manifest.json": enc({
        app: "nawiri",
        schemaVersion: 1,
        createdAt: 1,
        includesBlobs: false,
        counts: { books: 1, annotations: 1, sessions: 0, collections: 0 },
      }),
      "books.json": enc([record("A1")]),
      "annotations.json": enc([annotation("a-note", "A1")]),
      "sessions.json": enc([]),
      "collections.json": enc([]),
      "settings.json": enc({}),
    });
    await putBook(record("B1"), nodeBlob(FILE));
    const result = await importBackup(nodeBlob(old));
    expect(result.booksAdded).toBe(0);
    expect(
      ((await (await getDb()).get("annotations", "a-note")) as { bookId: string }).bookId,
    ).toBe("B1");

    // another name: no safe way to know it is the same book
    await wipe();
    await putBook(record("B1", { fileName: "other.epub" }), nodeBlob(FILE));
    expect((await importBackup(nodeBlob(old))).booksAdded).toBe(1);
  });
});

describe("restoring a full backup onto the device's own copy", () => {
  it("never replaces a file the device already has", async () => {
    // An older backup (no fingerprint) is matched by name and size alone, so its bytes may
    // differ from the device's. The device's own file is the one that stays.
    const old = zipSync({
      "manifest.json": enc({
        app: "nawiri",
        schemaVersion: 1,
        createdAt: 1,
        includesBlobs: true,
        counts: { books: 1, annotations: 0, sessions: 0, collections: 0 },
      }),
      "books.json": enc([record("A1")]),
      "annotations.json": enc([]),
      "sessions.json": enc([]),
      "collections.json": enc([]),
      "settings.json": enc({}),
      "blobs/A1": FILE,
    });
    await putBook(record("B1"), nodeBlob(OTHER));

    const result = await importBackup(nodeBlob(old));

    expect(result.booksAdded).toBe(0);
    expect((await listBooks()).map((b) => b.id)).toEqual(["B1"]);
    expect(new Uint8Array(await (await getBookFile("B1"))!.arrayBuffer())).toEqual(OTHER);
  });

  it("gives the file to an own copy that is waiting for it (same file, no bytes here)", async () => {
    const full = await backupFromDeviceA({ includeBlobs: true });
    await putBook(record("B1", { blobEvicted: true }), nodeBlob(FILE));
    await (await getDb()).delete("files", "B1");

    await importBackup(nodeBlob(full));

    const book = (await getBook("B1"))!;
    expect(book.blobEvicted).toBe(false);
    expect(new Uint8Array(await (await getBookFile("B1"))!.arrayBuffer())).toEqual(FILE);
    expect((await listBooks()).map((b) => b.id)).toEqual(["B1"]);
  });
});

describe("restoring a metadata-only backup on a device that does not have the book", () => {
  it("keeps the marks on a record that asks for the file, instead of one that claims to have it", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false });
    const result = await importBackup(nodeBlob(backup));
    expect(result.booksAdded).toBe(1);
    const book = (await getBook("A1"))!;
    expect(book.blobEvicted).toBe(true);
    expect(await getBookFile("A1")).toBeUndefined();
    expect(await (await getDb()).get("books", "A1")).not.toHaveProperty("fingerprint");
    expect(
      ((await (await getDb()).get("annotations", "a-note")) as { bookId: string }).bookId,
    ).toBe("A1");
  });

  it("a full backup still brings the file, and the record does not ask for one", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: true });
    await importBackup(nodeBlob(backup));
    const book = (await getBook("A1"))!;
    expect(book.blobEvicted).toBe(false);
    expect((await getBookFile("A1"))?.size).toBe(FILE.length);
  });

  it("restoring it again updates that record rather than adding another", async () => {
    const backup = await backupFromDeviceA({ includeBlobs: false });
    await importBackup(nodeBlob(backup));
    const again = await importBackup(nodeBlob(backup));
    expect(again.booksAdded).toBe(0);
    expect(again.booksUpdated).toBe(1);
    expect(await listBooks()).toHaveLength(1);
  });

  it("brings the file to a record that was waiting for it, when a full backup of the same book arrives", async () => {
    const meta = await backupFromDeviceA({ includeBlobs: false });
    await importBackup(nodeBlob(meta));
    const full = await backupFromDeviceA({ includeBlobs: true });
    await importBackup(nodeBlob(full));
    const book = (await getBook("A1"))!;
    expect(book.blobEvicted).toBe(false);
    expect((await getBookFile("A1"))?.size).toBe(FILE.length);
    expect(await listBooks()).toHaveLength(1);
  });
});
