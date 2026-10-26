import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { ensureIndex } from "@/lib/search-index";
import { addShelfBook } from "./fixtures/shelf-book";

/**
 * The shelf and the reader can build the index of one book at the same time. Each build reads the
 * record, extends it and writes it back, so two builds must not interleave: the second starts only
 * after the first has finished (and then finds nothing left to extract).
 */
describe("ensureIndex for one book", () => {
  it("runs a second build of the same book after the first has finished", async () => {
    await addShelfBook("queued-book");
    const events: string[] = [];
    const slow = (tag: string) => async (page: number) => {
      events.push(`${tag}${page}:start`);
      await new Promise((r) => setTimeout(r, 5));
      events.push(`${tag}${page}:end`);
      return `text of ${tag}${page}`;
    };
    const first = ensureIndex({
      bookId: "queued-book",
      pageCount: 2,
      extract: slow("a"),
      batch: 1,
    });
    const second = ensureIndex({
      bookId: "queued-book",
      pageCount: 2,
      extract: slow("b"),
      batch: 1,
    });
    await Promise.all([first, second]);

    const lastA = events.lastIndexOf("a2:end");
    expect(lastA).toBeGreaterThanOrEqual(0);
    const firstB = events.findIndex((e) => e.startsWith("b"));
    // Either the second build found nothing left to do, or it started after the first ended.
    expect(firstB === -1 || firstB > lastA).toBe(true);
  });
});
