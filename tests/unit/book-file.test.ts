// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { asNamedFile } from "@/lib/book-file";

/**
 * A restored backup stores each book as a plain Blob, which has no name, and
 * foliate-js reads `file.name` to decide how to open a book. Found in Chromium:
 * after "Restore from file" every EPUB said "Couldn't open this
 * file" (`Cannot read properties of undefined (reading 'endsWith')`) while the
 * PDF, which is read by its bytes, still opened.
 */
describe("asNamedFile", () => {
  const bytes = () => new Blob(["hello"], { type: "application/octet-stream" });

  it("gives a nameless Blob the name recorded on the book, keeping its bytes and type", async () => {
    const out = asNamedFile(bytes(), "walden.epub") as File;
    expect(out.name).toBe("walden.epub");
    expect(out.type).toBe("application/octet-stream");
    expect(out.size).toBe(5);
    expect(await out.text()).toBe("hello");
  });

  it("returns a file that already has a name untouched, even if the record says otherwise", () => {
    const named = new File(["hello"], "original.epub");
    expect(asNamedFile(named, "other.epub")).toBe(named);
  });

  it("returns the Blob as it is when there is no name to give", () => {
    const blob = bytes();
    expect(asNamedFile(blob, undefined)).toBe(blob);
    expect(asNamedFile(blob, "")).toBe(blob);
  });

  it("treats an empty name like no name", () => {
    const unnamed = new File(["hello"], "");
    expect((asNamedFile(unnamed, "walden.epub") as File).name).toBe("walden.epub");
  });
});
