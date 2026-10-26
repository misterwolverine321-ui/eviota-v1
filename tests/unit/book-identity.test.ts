// Node environment on purpose: Node's Blob has slice() and arrayBuffer(), jsdom's does not.
import { describe, expect, it } from "vitest";
import { fingerprintBlob, matchOwnCopies, type IncomingBook } from "@/lib/book-identity";
import type { BookRecord } from "@/lib/db";

const bytes = (n: number, fill = (i: number) => i % 251) =>
  Uint8Array.from({ length: n }, (_, i) => fill(i));
const blobOf = (u: Uint8Array) => new Blob([u as BlobPart]);

describe("fingerprintBlob", () => {
  it("is 28 hex characters and the same for the same bytes however the Blob was built", async () => {
    const data = bytes(500_000);
    const a = await fingerprintBlob(blobOf(data));
    const b = await fingerprintBlob(
      new Blob([data.slice(0, 1000), data.slice(1000)] as BlobPart[]),
    );
    expect(a).toMatch(/^[0-9a-f]{28}$/);
    expect(b).toBe(a);
  });

  it("differs when the size differs", async () => {
    expect(await fingerprintBlob(blobOf(bytes(500_000)))).not.toBe(
      await fingerprintBlob(blobOf(bytes(500_001))),
    );
  });

  it("differs when a byte changes at the start, the middle or the end of a large file", async () => {
    const data = bytes(1_000_000);
    const base = await fingerprintBlob(blobOf(data));
    for (const at of [0, 10, 500_000, 999_999]) {
      const changed = data.slice();
      changed[at] = (changed[at]! + 1) % 256;
      expect(await fingerprintBlob(blobOf(changed)), `byte ${at}`).not.toBe(base);
    }
  });

  it("looks at every byte of a small file", async () => {
    const data = bytes(150_000);
    const base = await fingerprintBlob(blobOf(data));
    for (const at of [0, 70_000, 100_000, 149_999]) {
      const changed = data.slice();
      changed[at] = (changed[at]! + 1) % 256;
      expect(await fingerprintBlob(blobOf(changed)), `byte ${at}`).not.toBe(base);
    }
  });

  it("reads only three windows of a large file (the cost does not grow with the file)", async () => {
    // A change far from the head, the middle and the tail is not seen. This is the trade for
    // never loading a multi-hundred-megabyte archive into memory just to name it.
    const data = bytes(1_000_000);
    const base = await fingerprintBlob(blobOf(data));
    const changed = data.slice();
    changed[200_000] = (changed[200_000]! + 1) % 256;
    expect(await fingerprintBlob(blobOf(changed))).toBe(base);
  });

  it("copes with an empty file", async () => {
    expect(await fingerprintBlob(new Blob([]))).toMatch(/^[0-9a-f]{28}$/);
  });
});

const own = (over: Partial<BookRecord> & { id: string }): BookRecord => ({
  title: "T",
  author: "A",
  format: "epub",
  fileName: "book.epub",
  size: 1000,
  addedAt: 10,
  hasCover: false,
  ...over,
});
const incoming = (over: Partial<IncomingBook> & { id: string }): IncomingBook => ({
  format: "epub",
  fileName: "book.epub",
  size: 1000,
  ...over,
});

const noFiles = async () => undefined;
const fingerprints =
  (table: Record<string, string>) =>
  async (id: string): Promise<string | undefined> =>
    table[id];

describe("matchOwnCopies: a backup's book and the device's own copy of the same file", () => {
  it("matches by format, size and file name when the backup has no fingerprint", async () => {
    const m = await matchOwnCopies([incoming({ id: "A1" })], [own({ id: "B1" })], noFiles);
    expect(m.get("A1")?.id).toBe("B1");
  });

  it("ignores case and surrounding space in the file name", async () => {
    const m = await matchOwnCopies(
      [incoming({ id: "A1", fileName: " Book.EPUB " })],
      [own({ id: "B1" })],
      noFiles,
    );
    expect(m.get("A1")?.id).toBe("B1");
  });

  it("does not match a different size, format or name", async () => {
    for (const [i, o] of [
      [incoming({ id: "A1", size: 1001 }), own({ id: "B1" })],
      [incoming({ id: "A1", format: "pdf" }), own({ id: "B1" })],
      [incoming({ id: "A1", fileName: "other.epub" }), own({ id: "B1" })],
      [incoming({ id: "A1" }), own({ id: "B1", size: 999 })],
    ] as const) {
      expect((await matchOwnCopies([i], [o], noFiles)).size).toBe(0);
    }
  });

  it("does not match when the size is unknown on either side", async () => {
    expect(
      (
        await matchOwnCopies(
          [incoming({ id: "A1", size: undefined })],
          [own({ id: "B1" })],
          noFiles,
        )
      ).size,
    ).toBe(0);
    expect(
      (
        await matchOwnCopies(
          [incoming({ id: "A1" })],
          [own({ id: "B1", size: undefined as never })],
          noFiles,
        )
      ).size,
    ).toBe(0);
  });

  it("does not match when the size is unknown or zero on BOTH sides, even with the same name", async () => {
    // Two missing sizes compare equal; that must not be read as "same file".
    for (const size of [undefined, 0]) {
      const m = await matchOwnCopies(
        [incoming({ id: "A1", size })],
        [own({ id: "B1", size: size as never })],
        noFiles,
      );
      expect(m.size, `size ${String(size)}`).toBe(0);
    }
  });

  it("with a fingerprint, the content decides: the name is not needed", async () => {
    const m = await matchOwnCopies(
      [incoming({ id: "A1", fileName: "renamed.epub", fingerprint: "f1" })],
      [own({ id: "B1" })],
      fingerprints({ B1: "f1" }),
    );
    expect(m.get("A1")?.id).toBe("B1");
  });

  it("with a fingerprint, same name and size but different content is not the same book", async () => {
    const m = await matchOwnCopies(
      [incoming({ id: "A1", fingerprint: "f1" })],
      [own({ id: "B1" })],
      fingerprints({ B1: "f2" }),
    );
    expect(m.size).toBe(0);
  });

  it("with a fingerprint, an own record that has no file is judged by name and size", async () => {
    const same = await matchOwnCopies(
      [incoming({ id: "A1", fingerprint: "f1" })],
      [own({ id: "B1", blobEvicted: true })],
      noFiles,
    );
    expect(same.get("A1")?.id).toBe("B1");
    const other = await matchOwnCopies(
      [incoming({ id: "A1", fingerprint: "f1", fileName: "other.epub" })],
      [own({ id: "B1", blobEvicted: true })],
      noFiles,
    );
    expect(other.size).toBe(0);
  });

  it("never matches a book the backup also carries under that very id", async () => {
    const m = await matchOwnCopies(
      [incoming({ id: "A1" }), incoming({ id: "B1" })],
      [own({ id: "B1" })],
      noFiles,
    );
    expect(m.size).toBe(0);
  });

  it("leaves a backup book alone when the device already holds it under that very id", async () => {
    // A1 is already A1 here. A second copy of the same file under another id (B1) must not
    // pull it away: the merge by id is the right outcome, not a re-key onto B1.
    const m = await matchOwnCopies(
      [incoming({ id: "A1" })],
      [own({ id: "A1", addedAt: 20 }), own({ id: "B1", addedAt: 5 })],
      noFiles,
    );
    expect(m.size).toBe(0);
  });

  it("gives one own copy to one backup book only, the first", async () => {
    const m = await matchOwnCopies(
      [incoming({ id: "A1" }), incoming({ id: "A2" })],
      [own({ id: "B1" })],
      noFiles,
    );
    expect([...m.keys()]).toEqual(["A1"]);
  });

  it("when the device holds the file twice, takes the one added first", async () => {
    const m = await matchOwnCopies(
      [incoming({ id: "A1" })],
      [own({ id: "B2", addedAt: 50 }), own({ id: "B1", addedAt: 5 })],
      noFiles,
    );
    expect(m.get("A1")?.id).toBe("B1");
  });

  it("only reads fingerprints of candidates with the right format and size", async () => {
    const asked: string[] = [];
    await matchOwnCopies(
      [incoming({ id: "A1", fingerprint: "f1" })],
      [own({ id: "B1", size: 5 }), own({ id: "B2", format: "pdf" }), own({ id: "B3" })],
      async (id) => {
        asked.push(id);
        return "f1";
      },
    );
    expect(asked).toEqual(["B3"]);
  });
});
