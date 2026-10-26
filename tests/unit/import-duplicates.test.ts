import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { importFiles } from "@/lib/import-books";
import { listBooks } from "@/lib/db";

/**
 * The import itself, against the real IndexedDB (fake-indexeddb). Each test uses its own text, so
 * one test's books never match another's; text needs no decoder, so this runs in Node.
 */
describe("importFiles: duplicates and refusals", () => {
  it("skips a file whose bytes are already on the shelf, under another name", async () => {
    const text = "the same words, first time round, long enough to be a file\n".repeat(3);
    const first = await importFiles([new File([text], "first.txt")]);
    expect(first.added.map((b) => b.fileName)).toEqual(["first.txt"]);
    const again = await importFiles([new File([text], "copy of first.txt")]);
    expect(again.added).toEqual([]);
    expect(again.skipped).toEqual(["copy of first.txt"]);
  });

  it("imports a different file that has the same name and size as one on the shelf", async () => {
    const a = "alpha text, exactly thirty-two bytes!";
    const b = "bravo text, exactly thirty-two bytes!";
    expect(a.length).toBe(b.length);
    await importFiles([new File([a], "same-name.txt")]);
    const res = await importFiles([new File([b], "same-name.txt")]);
    expect(res.skipped).toEqual([]);
    expect(res.added).toHaveLength(1);
  });

  it("keeps one copy when two identical files arrive in the same batch", async () => {
    const text = "dropped together, the same bytes twice over, nothing else here\n".repeat(2);
    const res = await importFiles([new File([text], "twin-a.txt"), new File([text], "twin-b.txt")]);
    expect(res.added.map((b) => b.fileName)).toEqual(["twin-a.txt"]);
    expect(res.skipped).toEqual(["twin-b.txt"]);
    const books = (await listBooks()).filter((b) => b.fileName.startsWith("twin-"));
    expect(books).toHaveLength(1);
  });

  it("refuses an empty file and a file that is not the kind its name says, with a reason", async () => {
    const res = await importFiles([
      new File([], "nothing-here.txt"),
      new File(["just some words, not a PDF at all\n".repeat(2)], "not-really.pdf"),
      new File(["x"], "mystery.xyz"),
    ]);
    expect(res.added).toEqual([]);
    expect(res.rejected).toEqual([
      { name: "nothing-here.txt", reason: "is empty" },
      { name: "not-really.pdf", reason: "is not a PDF file" },
    ]);
    expect(res.failed).toEqual(["mystery.xyz"]);
  });
});
