import { describe, expect, it } from "vitest";
import {
  fingerprintBlob,
  findSameFile,
  sameBytes,
  type SameFileCandidate,
} from "@/lib/book-identity";
import type { BookRecord } from "@/lib/db";

const KIB = 1024;

/** A deterministic pattern, so two calls give the same bytes. */
const pattern = (size: number, tweak?: { at: number; to: number }) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  if (tweak) bytes[tweak.at] = tweak.to;
  return bytes;
};

const record = (over: Partial<BookRecord> & { id: string }): BookRecord => ({
  title: "t",
  author: "a",
  format: "epub",
  fileName: "book.epub",
  size: 0,
  addedAt: 0,
  hasCover: false,
  ...over,
});

describe("sameBytes", () => {
  it("is true for equal files and false for a difference in the last byte of a multi-chunk file", async () => {
    const size = 2 * 1024 * KIB + 500;
    const a = new Blob([pattern(size)]);
    const b = new Blob([pattern(size)]);
    expect(await sameBytes(a, b)).toBe(true);
    const c = new Blob([pattern(size, { at: size - 1, to: 0x01 })]);
    expect(await sameBytes(a, c)).toBe(false);
  });

  it("is false for files of different sizes", async () => {
    expect(await sameBytes(new Blob([pattern(10)]), new Blob([pattern(11)]))).toBe(false);
  });
});

describe("findSameFile", () => {
  it("finds the same bytes under another name", async () => {
    const bytes = pattern(300 * KIB);
    const stored = new Blob([bytes]);
    const incoming = new File([bytes], "renamed copy.epub");
    const hit = await findSameFile(incoming, "epub", [
      { record: record({ id: "A", size: bytes.length }), load: async () => stored },
    ]);
    expect(hit?.id).toBe("A");
  });

  it("does not take a different file of the same size, even when the fingerprints agree", async () => {
    // 400 KiB: the fingerprint reads the first, middle and last 64 KiB. A byte at 100 KiB lies
    // between the windows, so the two fingerprints agree and only the byte comparison can tell.
    const size = 400 * KIB;
    const stored = new Blob([pattern(size)]);
    const incoming = new File([pattern(size, { at: 100 * KIB, to: 0x99 })], "book.epub");
    expect(await fingerprintBlob(stored)).toBe(await fingerprintBlob(incoming));
    const hit = await findSameFile(incoming, "epub", [
      { record: record({ id: "A", size }), load: async () => stored },
    ]);
    expect(hit).toBeNull();
  });

  it("ignores a book of another format with the same bytes", async () => {
    const bytes = pattern(50 * KIB);
    const hit = await findSameFile(new File([bytes], "x.pdf"), "pdf", [
      {
        record: record({ id: "A", format: "epub", size: bytes.length }),
        load: async () => new Blob([bytes]),
      },
    ]);
    expect(hit).toBeNull();
  });

  it("matches a book whose file is gone only by the same name and size, as before", async () => {
    const bytes = pattern(50 * KIB);
    const gone: SameFileCandidate = {
      record: record({ id: "A", fileName: "book.epub", size: bytes.length }),
      load: async () => undefined,
    };
    const sameName = await findSameFile(new File([bytes], "book.epub"), "epub", [gone]);
    expect(sameName?.id).toBe("A");
    const otherName = await findSameFile(new File([bytes], "other.epub"), "epub", [gone]);
    expect(otherName).toBeNull();
  });

  it("returns the first match when several books hold the same file", async () => {
    const bytes = pattern(20 * KIB);
    const first = new Blob([bytes]);
    const hit = await findSameFile(new File([bytes], "c.epub"), "epub", [
      { record: record({ id: "first", size: bytes.length }), load: async () => first },
      { record: record({ id: "second", size: bytes.length }), load: async () => first },
    ]);
    expect(hit?.id).toBe("first");
  });
});
