import { describe, expect, it } from "vitest";
import { fileProblem } from "@/lib/import-check";

/** A file with the given first bytes and padding after them. */
const file = (name: string, head: string | number[], length = 2048): File => {
  const first = typeof head === "string" ? Array.from(head, (c) => c.charCodeAt(0)) : head;
  const bytes = new Uint8Array(length);
  bytes.set(first, 0);
  return new File([bytes], name);
};

const PK = [0x50, 0x4b];

describe("fileProblem: what is refused before decoding", () => {
  it("refuses an empty file, whatever its name", async () => {
    expect(await fileProblem(new File([], "notes.txt"))).toBe("is empty");
    expect(await fileProblem(new File([], "book.epub"))).toBe("is empty");
  });

  it("accepts a zip header for EPUB and CBZ, including an empty or split archive", async () => {
    expect(await fileProblem(file("a.epub", [...PK, 3, 4]))).toBeNull();
    expect(await fileProblem(file("a.cbz", [...PK, 3, 4]))).toBeNull();
    expect(await fileProblem(file("empty.epub", [...PK, 5, 6]))).toBeNull();
    expect(await fileProblem(file("split.epub", [...PK, 7, 8]))).toBeNull();
  });

  it("refuses an EPUB that is not a zip, and says so in the kind's own words", async () => {
    expect(await fileProblem(file("fake.epub", "<html>not a book"))).toBe("is not an EPUB file");
    expect(await fileProblem(file("broken.cbz", [...PK, 3, 3]))).toBe("is not a CBZ file");
  });

  it("accepts a PDF whose header follows some junk, and refuses one without a header", async () => {
    expect(await fileProblem(file("a.pdf", "%PDF-1.7\n"))).toBeNull();
    const junked = new Uint8Array(2048);
    junked.set(
      Array.from("%PDF-1.4", (c) => c.charCodeAt(0)),
      100,
    );
    expect(await fileProblem(new File([junked], "junk.pdf"))).toBeNull();
    expect(await fileProblem(file("text.pdf", "Hello, world"))).toBe("is not a PDF file");
  });

  it("checks the RAR and 7-Zip headers of CBR and CB7, and refuses a zip named CBR", async () => {
    expect(await fileProblem(file("a.cbr", [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))).toBeNull();
    expect(
      await fileProblem(file("a.cb7", [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04])),
    ).toBeNull();
    expect(await fileProblem(file("zip-as.cbr", [...PK, 3, 4]))).toBe("is not a CBR file");
  });

  it("checks the DjVu header for both extensions", async () => {
    expect(await fileProblem(file("scan.djvu", "AT&TFORM\0\0\0\x10"))).toBeNull();
    expect(await fileProblem(file("scan.djv", "AT&TFORM\0\0\0\x10"))).toBeNull();
    expect(await fileProblem(file("scan.djvu", "%PDF-1.4"))).toBe("is not a DjVu file");
  });

  it("finds Kindle books by the Palm type field at offset 60, for MOBI, AZW and AZW3", async () => {
    const palm = (magic: string) => {
      const bytes = new Uint8Array(2048);
      bytes.set(
        Array.from(magic, (c) => c.charCodeAt(0)),
        60,
      );
      return bytes;
    };
    expect(await fileProblem(new File([palm("BOOKMOBI")], "a.mobi"))).toBeNull();
    expect(await fileProblem(new File([palm("TEXtREAd")], "a.azw"))).toBeNull();
    expect(await fileProblem(new File([palm("BOOKMOBI")], "a.azw3"))).toBeNull();
    expect(await fileProblem(new File([palm("NOTHING!")], "a.mobi"))).toBe("is not a Kindle file");
    // Too short to hold the field at all.
    expect(await fileProblem(file("tiny.mobi", "BOOKMOBI"))).toBe("is not a Kindle file");
  });

  it("checks the CHM header", async () => {
    expect(await fileProblem(file("help.chm", "ITSF\x03\0\0\0"))).toBeNull();
    expect(await fileProblem(file("help.chm", "<html>"))).toBe("is not a CHM file");
  });

  it("matches the extension whatever its case", async () => {
    expect(await fileProblem(file("SCAN.PDF", "%PDF-1.4"))).toBeNull();
    expect(await fileProblem(file("NOTES.PDF", "plain"))).toBe("is not a PDF file");
  });

  it("checks nothing but emptiness for formats without a fixed header", async () => {
    expect(await fileProblem(file("notes.txt", "any bytes at all"))).toBeNull();
    expect(await fileProblem(file("novel.fb2", "<?xml version='1.0'?>"))).toBeNull();
    expect(await fileProblem(file("page.html", "<p>x</p>"))).toBeNull();
    expect(await fileProblem(file("doc.rtf", "{\\rtf1"))).toBeNull();
    expect(await fileProblem(file("doc.markdown", "# Title"))).toBeNull();
  });

  it("leaves a name it does not know to the import (it reports those as unrecognised)", async () => {
    expect(await fileProblem(file("unknown.xyz", "whatever"))).toBeNull();
  });
});
