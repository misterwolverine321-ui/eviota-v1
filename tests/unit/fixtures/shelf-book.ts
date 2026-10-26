import { getDb, type BookRecord } from "@/lib/db";

/**
 * A book on the shelf, for tests that build a search index for it. `writeIndex` refuses to write for
 * a book that is not in the `books` store (it may have been deleted while the index was building),
 * so a test that indexes "a book" has to put one there first. Needs `fake-indexeddb/auto`.
 */
export function shelfBook(id: string): BookRecord {
  return {
    id,
    title: id,
    author: "Author",
    format: "epub",
    fileName: `${id}.epub`,
    size: 1,
    addedAt: 1,
    hasCover: false,
    progress: null,
  };
}

export async function addShelfBook(id: string): Promise<void> {
  await (await getDb()).put("books", shelfBook(id));
}
