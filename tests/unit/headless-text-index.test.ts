import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it } from "vitest";
import { getDb, putBook, type BookRecord } from "@/lib/db";
import { indexShelfHeadless, type ShelfIndexStatus } from "@/lib/headless-index";
import { queryIndex, readIndex } from "@/lib/search-index";
import { readTextDocument } from "@/lib/text-document";
import { buildTextUnits, unitPercentLabel } from "@/lib/text-units";

/**
 * A text book that was never opened is indexed from the shelf, and a hit found there walks back to
 * the paragraph the text reader would scroll to. Run in Node: the file goes through IndexedDB as a
 * Node Blob, which fake-indexeddb can clone.
 */

function record(id: string, fileName: string, extra: Partial<BookRecord> = {}): BookRecord {
  return {
    id,
    title: fileName,
    author: "Author",
    format: fileName.split(".").pop() ?? "txt",
    fileName,
    size: 1,
    addedAt: 1,
    hasCover: false,
    progress: null,
    ...extra,
  };
}

const paragraphs = Array.from({ length: 400 }, (_, i) =>
  i === 321
    ? "Here, deep in the book, sits the zephyrquill marker."
    : `Paragraph number ${i} talks about harbour lamps and river stones at some length, so the file is long enough to need several units.`,
);

describe("shelf indexing of a text book", () => {
  it("indexes a text file that was never opened, with the reader's units and signature", async () => {
    const text = paragraphs.join("\n\n");
    await putBook(record("txt-1", "long.txt"), new NodeBlob([text]) as unknown as Blob);

    const statuses: ShelfIndexStatus[] = [];
    await indexShelfHeadless([record("txt-1", "long.txt")], { onStatus: (s) => statuses.push(s) });
    expect(statuses.at(-1)).toMatchObject({ eligible: 1, ready: 1, failed: 0 });

    const stored = await readIndex("txt-1");
    const reader = buildTextUnits(
      readTextDocument(new TextEncoder().encode(text), "long.txt", null).paras,
    );
    expect(reader.count).toBeGreaterThan(1);
    expect(stored?.status).toBe("ready");
    expect(stored?.index.pageCount).toBe(reader.count);
    expect(stored?.signature).toBe(reader.signature);
    // Hit-list labels say what stretch of the file the unit covers.
    expect(stored?.labels?.[1]).toBe(unitPercentLabel(reader, 1));
    expect(stored?.labels?.[1]).toMatch(/^0–\d+%$/);
    expect(stored?.labels?.[reader.count]).toMatch(/–100%$/);
    expect(Object.keys(stored?.labels ?? {})).toHaveLength(reader.count);

    // The word is found, and the hit walks back to the paragraph it is in.
    const hits = await queryIndex(stored!, "zephyrquill");
    expect(hits).toHaveLength(1);
    const target = hits[0].target as { kind: string; page: number; offset: number };
    expect(target.kind).toBe("page");
    expect(reader.locate(target.page, target.offset)?.block).toBe(321);
    expect(hits[0].label).toMatch(/^\d+–\d+%$/);
  });

  it("does not index it a second time", async () => {
    const before = await readIndex("txt-1");
    await indexShelfHeadless([record("txt-1", "long.txt")]);
    expect((await readIndex("txt-1"))?.builtAt).toBe(before?.builtAt);
  });

  it("reads a book in the encoding it was given", async () => {
    const latin = new NodeBlob([new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x62, 0x61, 0x72])]);
    const book = record("txt-2", "old.txt", { encoding: "windows-1252" });
    await putBook(book, latin as unknown as Blob);
    await indexShelfHeadless([book]);
    const hits = await queryIndex((await readIndex("txt-2"))!, "café");
    expect(hits).toHaveLength(1);
  });

  it("counts an empty text file as unreadable rather than indexing nothing", async () => {
    const book = record("txt-3", "empty.txt");
    await putBook(book, new NodeBlob([""]) as unknown as Blob);
    const statuses: ShelfIndexStatus[] = [];
    await indexShelfHeadless([book], { onStatus: (s) => statuses.push(s) });
    expect(statuses.at(-1)).toMatchObject({ eligible: 1, ready: 0, failed: 1 });
    expect(await (await getDb()).get("searchIndex", "txt-3")).toBeUndefined();
  });
});
