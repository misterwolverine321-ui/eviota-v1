// Node environment on purpose, for the reason given in backup-legacy.test.ts: Node's `Blob` is the
// one fake-indexeddb can clone and that has `arrayBuffer()`.
import "fake-indexeddb/auto";
import { zipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BACKUP_SCHEMA_VERSION, importBackup } from "@/lib/backup";
import { getBook } from "@/lib/db";

const nodeBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);
const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

beforeAll(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  });
});

/**
 * What the Settings screen puts in its toast when a file is not a backup: `importBackup`'s message
 * is shown as it is, so it has to be a sentence, not a dump of the validator's issue list.
 */
const NOT_A_BACKUP = "That file isn't an Eviota backup.";

const goodManifest = {
  app: "eviota",
  schemaVersion: BACKUP_SCHEMA_VERSION,
  createdAt: 1_700_000_000_000,
  includesBlobs: false,
  counts: { books: 0, annotations: 0, sessions: 0, collections: 0 },
};

/**
 * A zip with every file a backup has, and the manifest bytes as given (or none at all). With a
 * `bookId` its books.json holds one book, so a test can tell whether anything got written.
 */
function backup(manifest: Uint8Array | undefined, bookId?: string): Blob {
  const book = {
    id: bookId,
    title: "Walden",
    author: "Thoreau",
    format: "epub",
    fileName: "walden.epub",
    size: 5,
    addedAt: 1,
    hasCover: false,
  };
  const files: Record<string, Uint8Array> = {
    "books.json": enc(bookId ? [book] : []),
    "annotations.json": enc([]),
    "sessions.json": enc([]),
    "collections.json": enc([]),
    "settings.json": enc({}),
  };
  if (manifest) files["manifest.json"] = manifest;
  return nodeBlob(zipSync(files));
}

async function messageOf(file: Blob): Promise<string> {
  try {
    await importBackup(file);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "(restored without an error)";
}

describe("a file whose manifest is not an Eviota manifest", () => {
  const bad: [string, Uint8Array | undefined][] = [
    ["a manifest from some other app", enc({ ...goodManifest, app: "somethingelse" })],
    ["no manifest.json in the zip", undefined],
    ["a manifest.json that is not JSON", new TextEncoder().encode("{ not json")],
    ["an empty manifest.json", new Uint8Array()],
    ["a manifest that is JSON null", enc(null)],
    ["a manifest that is an array", enc([goodManifest])],
    ["a manifest that is a number", enc(42)],
    ["an empty object", enc({})],
    ["no counts", enc({ ...goodManifest, counts: undefined })],
    ["a count that is missing", enc({ ...goodManifest, counts: { books: 0 } })],
    [
      "a count that is text",
      enc({ ...goodManifest, counts: { ...goodManifest.counts, books: "3" } }),
    ],
    ["a schema version that is text", enc({ ...goodManifest, schemaVersion: "1" })],
    ["a created-at that is text", enc({ ...goodManifest, createdAt: "yesterday" })],
    ["includesBlobs that is text", enc({ ...goodManifest, includesBlobs: "yes" })],
  ];

  bad.forEach(([name, bytes], i) => {
    it(`says so in a sentence, and adds nothing: ${name}`, async () => {
      const id = `intruder-${i}`;
      expect(await messageOf(backup(bytes, id))).toBe(NOT_A_BACKUP);
      expect(await getBook(id)).toBeUndefined();
    });
  });

  it("never shows the validator's issue list", async () => {
    const message = await messageOf(backup(enc({ ...goodManifest, app: "somethingelse" })));
    expect(message).not.toMatch(/invalid_|"code"|"path"|\n|\[|\{/);
  });
});

describe("a manifest that is one", () => {
  it("keeps its own words for a backup from a newer version", async () => {
    const newer = { ...goodManifest, schemaVersion: BACKUP_SCHEMA_VERSION + 1 };
    expect(await messageOf(backup(enc(newer), "from-the-future"))).toBe(
      "This backup was made by a newer version of Eviota.",
    );
    expect(await getBook("from-the-future")).toBeUndefined();
  });

  it("does add the book of a manifest that is one", async () => {
    await importBackup(backup(enc(goodManifest), "welcome-1"));
    expect((await getBook("welcome-1"))?.title).toBe("Walden");
  });

  it.each(["nawiri", "folio"])("restores a backup that names the app %s", async (app) => {
    const result = await importBackup(backup(enc({ ...goodManifest, app })));
    expect(result.manifest.app).toBe(app);
  });

  it("restores when a later version added fields to the manifest, and does not carry them", async () => {
    const withExtra = {
      ...goodManifest,
      futureField: { a: 1 },
      counts: { ...goodManifest.counts, notes: 9 },
    };
    const result = await importBackup(backup(enc(withExtra)));
    expect(result.manifest).toEqual(goodManifest);
    expect(result.manifest).not.toHaveProperty("futureField");
  });

  it("hands back the manifest it read", async () => {
    const manifest = {
      ...goodManifest,
      includesBlobs: true,
      counts: { books: 3, annotations: 4, sessions: 5, collections: 6 },
    };
    const result = await importBackup(backup(enc(manifest)));
    expect(result.manifest).toEqual(manifest);
  });
});
