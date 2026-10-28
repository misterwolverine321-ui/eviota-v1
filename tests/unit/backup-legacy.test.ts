// Runs in the Node environment on purpose: there `Blob` is Node's, which
// fake-indexeddb can clone and which has `arrayBuffer()`. jsdom's Blob has
// neither property (see book-storage.test.ts), so a jsdom run would test the
// test environment instead of the backup code.
import "fake-indexeddb/auto";
import { unzipSync, zipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportBackup, importBackup } from "@/lib/backup";
import { getBook, getBookFile, putBook, type BookRecord } from "@/lib/db";

const nodeBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);

/** backup.ts reads and writes reader settings through `localStorage`. */
beforeAll(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  });
});
const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** A backup exactly as the app wrote it before the rename (`app: "folio"`). */
function legacyBackup(bookId: string): Blob {
  const zipped = zipSync({
    "manifest.json": enc({
      app: "folio",
      schemaVersion: 1,
      createdAt: 1_700_000_000_000,
      includesBlobs: true,
      counts: { books: 1, annotations: 1, sessions: 0, collections: 0 },
    }),
    "books.json": enc([
      {
        id: bookId,
        title: "Walden",
        author: "Thoreau",
        format: "epub",
        fileName: "walden.epub",
        size: 5,
        addedAt: 1,
        hasCover: false,
      },
    ]),
    "annotations.json": enc([
      {
        id: `${bookId}-a1`,
        bookId,
        anchor: { kind: "cfi", cfi: "epubcfi(/6/4)" },
        type: "highlight",
        color: "yellow",
        text: "I went to the woods",
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
    "sessions.json": enc([]),
    "collections.json": enc([]),
    "settings.json": enc({ fontSize: 22 }),
    [`blobs/${bookId}`]: new Uint8Array([1, 2, 3, 4, 5]),
  });
  return nodeBlob(zipped);
}

describe("backups written under earlier app names", () => {
  it("still restore: book, file, annotation and settings all land", async () => {
    const result = await importBackup(legacyBackup("legacy-1"));
    expect(result.manifest.app).toBe("folio");
    expect(result.booksAdded).toBe(1);
    expect(result.annotations).toBe(1);
    expect((await getBook("legacy-1"))?.title).toBe("Walden");
    expect((await getBookFile("legacy-1"))?.size).toBe(5);
    expect(JSON.parse(localStorage.getItem("nawiri-reader-settings") ?? "{}")).toEqual({
      fontSize: 22,
    });
  });

  it("rejects a manifest from some other app", async () => {
    const zipped = zipSync({
      "manifest.json": enc({
        app: "somethingelse",
        schemaVersion: 1,
        createdAt: 1,
        includesBlobs: false,
        counts: { books: 0, annotations: 0, sessions: 0, collections: 0 },
      }),
    });
    await expect(importBackup(nodeBlob(zipped))).rejects.toThrow();
  });
});

describe("new backups", () => {
  it("are labelled eviota and round-trip through the real export/import", async () => {
    const record: BookRecord = {
      id: "roundtrip-1",
      title: "Alice",
      author: "Carroll",
      format: "epub",
      fileName: "alice.epub",
      size: 3,
      addedAt: 2,
      hasCover: false,
    };
    await putBook(record, nodeBlob(new Uint8Array([9, 8, 7])));
    const backup = await exportBackup();
    const buf = new Uint8Array(await backup.arrayBuffer());
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(buf)["manifest.json"]));
    expect(manifest.app).toBe("eviota");
    const restored = await importBackup(nodeBlob(buf));
    expect(restored.manifest.app).toBe("eviota");
    expect((await getBook("roundtrip-1"))?.title).toBe("Alice");
  });
});
