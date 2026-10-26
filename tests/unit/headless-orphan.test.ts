import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteBook, getDb, putBook, type BookRecord } from "@/lib/db";
import { indexShelfHeadless, type ShelfIndexStatus } from "@/lib/headless-index";
import { emptyIndex } from "@/workers/search-index.worker";
import { INDEX_VERSION, readIndex, readIndexMeta } from "@/lib/search-index";

/**
 * Deleting a book while the shelf is indexing it must not leave index records behind, and a book
 * that disappeared during the run is not one that "could not be read".
 */

function book(id: string, fileName = `${id}.txt`): BookRecord {
  return {
    id,
    title: fileName,
    author: "Author",
    format: "txt",
    fileName,
    size: 1,
    addedAt: 1,
    hasCover: false,
    progress: null,
  };
}

const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about harbour lamps.`).join(
  "\n\n",
);

async function shelve(id: string) {
  const b = book(id);
  await putBook(b, new NodeBlob([text]) as unknown as Blob);
  return b;
}

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "files", "searchIndex", "searchMeta"] as const) {
    await db.clear(store);
  }
});

describe("shelf indexing and leftover index records", () => {
  it("removes the records of books that are gone when the run starts", async () => {
    const db = await getDb();
    // What older versions left behind after a book was deleted mid-build.
    await db.put("searchIndex", {
      bookId: "long-gone",
      version: INDEX_VERSION,
      builtAt: 1,
      status: "ready",
      pending: [],
      rotations: {},
      index: emptyIndex(1),
    });
    await db.put("searchMeta", { bookId: "long-gone", version: INDEX_VERSION, status: "ready" });

    const kept = await shelve("kept");
    await indexShelfHeadless([kept]);

    expect(await readIndex("long-gone")).toBeUndefined();
    expect(await readIndexMeta("long-gone")).toBeUndefined();
    expect((await readIndex("kept"))?.status).toBe("ready");
  });

  it("does not count a book deleted during the run as a failure", async () => {
    const a = await shelve("run-a");
    const b = await shelve("run-b");
    const statuses: ShelfIndexStatus[] = [];
    let deleted = false;
    await indexShelfHeadless([a, b], {
      onStatus: (s) => {
        statuses.push(s);
        // After the first report the run has counted both books; the person removes the second.
        if (!deleted) {
          deleted = true;
          void deleteBook("run-b");
        }
      },
    });

    expect(statuses.at(-1)).toMatchObject({ ready: 1, failed: 0 });
    expect((await readIndex("run-a"))?.status).toBe("ready");
    expect(await readIndex("run-b")).toBeUndefined();
    expect(await readIndexMeta("run-b")).toBeUndefined();
  });

  it("still counts a book whose file went missing during the run as a failure", async () => {
    const a = await shelve("evict-a");
    const b = await shelve("evict-b");
    const statuses: ShelfIndexStatus[] = [];
    let evicted = false;
    await indexShelfHeadless([a, b], {
      onStatus: (s) => {
        statuses.push(s);
        // The file is dropped (storage pressure) but the book stays on the shelf.
        if (!evicted) {
          evicted = true;
          void getDb().then((db) => db.delete("files", "evict-b"));
        }
      },
    });
    expect(statuses.at(-1)).toMatchObject({ ready: 1, failed: 1 });
  });

  it("still counts a book whose file cannot be read as a failure", async () => {
    // The book is on the shelf, its file is empty: the reader finds no text units in it.
    const empty = book("empty-one");
    await putBook(empty, new NodeBlob([""]) as unknown as Blob);
    const statuses: ShelfIndexStatus[] = [];
    await indexShelfHeadless([empty], { onStatus: (s) => statuses.push(s) });
    expect(statuses.at(-1)).toMatchObject({ eligible: 1, ready: 0, failed: 1 });
  });
});
