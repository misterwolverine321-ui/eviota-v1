import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureIndex, queryIndex, readIndex } from "@/lib/search-index";
import { addShelfBook } from "./fixtures/shelf-book";

/**
 * For a text book the units are cut by us from the decoded text. If the reader picks another
 * encoding the text changes under an index that has the same number of units: the signature is how
 * the stored index notices, instead of serving offsets into text that is no longer there.
 */
describe("ensureIndex with a signature", () => {
  beforeEach(async () => {
    for (const id of ["sig-1", "sig-2", "sig-3"]) await addShelfBook(id);
  });

  const extractor = (texts: string[]) => {
    const calls: number[] = [];
    return {
      calls,
      extract: async (page: number) => {
        calls.push(page);
        return texts[page - 1] ?? "";
      },
    };
  };

  it("keeps an index whose signature matches, and extracts nothing again", async () => {
    const a = extractor(["alpha one", "alpha two"]);
    await ensureIndex({ bookId: "sig-1", pageCount: 2, extract: a.extract, signature: "s1" });
    expect(a.calls).toEqual([1, 2]);

    const b = extractor(["changed", "changed"]);
    const record = await ensureIndex({
      bookId: "sig-1",
      pageCount: 2,
      extract: b.extract,
      signature: "s1",
    });
    expect(b.calls).toEqual([]);
    expect(record.signature).toBe("s1");
  });

  it("rebuilds when the signature changes, even with the same number of units", async () => {
    const first = extractor(["old text one", "old text two"]);
    await ensureIndex({ bookId: "sig-2", pageCount: 2, extract: first.extract, signature: "s1" });
    expect(await queryIndex((await readIndex("sig-2"))!, "old")).toHaveLength(2);

    const second = extractor(["new words one", "new words two"]);
    const record = await ensureIndex({
      bookId: "sig-2",
      pageCount: 2,
      extract: second.extract,
      signature: "s2",
    });
    expect(second.calls).toEqual([1, 2]);
    expect(record.signature).toBe("s2");
    expect(await queryIndex(record, "old")).toHaveLength(0);
    expect(await queryIndex(record, "words")).toHaveLength(2);
  });

  it("leaves an index without a signature (EPUB, PDF) as it was", async () => {
    const a = extractor(["epub section"]);
    await ensureIndex({ bookId: "sig-3", pageCount: 1, extract: a.extract });
    const b = extractor(["other"]);
    const record = await ensureIndex({ bookId: "sig-3", pageCount: 1, extract: b.extract });
    expect(b.calls).toEqual([]);
    expect(record.signature).toBeUndefined();
  });
});
