// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// The EPUB opener is foliate's own makeBook, replaced here by a book with three sections whose
// text is known. The numbering under test is the reader's: unit n is section n, rounded and clamped.
const sections = ["alpha section", "beta section", "gamma section"].map((text, i) => ({
  id: `s${i + 1}`,
  createDocument: async () =>
    new DOMParser().parseFromString(`<body><p>${text}</p></body>`, "text/html"),
}));
// The book also has a table of contents, as an EPUB's parser hands it over.
const toc = [
  { label: "Alpha chapter", href: "s1" },
  { label: "Gamma chapter", href: "s3" },
];
vi.mock("foliate-js/view.js", () => ({
  makeBook: async () => ({
    sections,
    toc: toc.map((item) => ({ ...item })),
    splitTOCHref: (href: string) => href.split("#"),
    getTOCFragment: () => null,
  }),
}));

const { headlessKind, openUnits } = await import("@/lib/headless-index");

describe("headlessKind", () => {
  it("covers the e-book formats, PDF, plain text, RTF, HTML and Markdown, and nothing else", () => {
    expect(headlessKind("novel.epub")).toBe("foliate");
    expect(headlessKind("novel.azw3")).toBe("foliate");
    expect(headlessKind("novel.fb2")).toBe("foliate");
    expect(headlessKind("report.PDF")).toBe("pdf");
    expect(headlessKind("notes.txt")).toBe("text");
    expect(headlessKind("letter.rtf")).toBe("text");
    expect(headlessKind("page.html")).toBe("html");
    expect(headlessKind("page.htm")).toBe("html");
    expect(headlessKind("README.md")).toBe("html");
    expect(headlessKind("README.markdown")).toBe("html");
    expect(headlessKind("comic.cbz")).toBeNull();
    expect(headlessKind("scan.djvu")).toBeNull();
    expect(headlessKind("help.chm")).toBeNull();
    expect(headlessKind("no-extension")).toBeNull();
  });
});

describe("openUnits for an e-book", () => {
  it("counts the sections and numbers them as the reader does (unit 1 is the first section)", async () => {
    const units = await openUnits("foliate", new File(["x"], "book.epub"));
    expect(units.count).toBe(3);
    expect(await units.extract(1)).toBe("alpha section");
    expect(await units.extract(2)).toBe("beta section");
    expect(await units.extract(3)).toBe("gamma section");
  });

  it("labels a unit with the table-of-contents entry its section falls under", async () => {
    const units = await openUnits("foliate", new File(["x"], "book.epub"));
    expect(units.label?.(1)).toBe("Alpha chapter");
    expect(units.label?.(2)).toBe("Alpha chapter");
    expect(units.label?.(3)).toBe("Gamma chapter");
  });

  it("rounds a fractional unit and clamps one outside the book, as the reader does", async () => {
    const units = await openUnits("foliate", new File(["x"], "book.epub"));
    expect(await units.extract(1.4)).toBe("alpha section");
    expect(await units.extract(2.6)).toBe("gamma section");
    expect(await units.extract(0)).toBe("alpha section");
    expect(await units.extract(99)).toBe("gamma section");
  });
});

describe("openUnits for plain text, RTF, HTML and Markdown", () => {
  // The reader cuts these documents into units with the same two functions; what is checked here
  // is that opening a file for the shelf gives the units the reader would.
  it("gives a text file the units the text reader builds, with the same signature", async () => {
    const { readTextDocument } = await import("@/lib/text-document");
    const { buildTextUnits } = await import("@/lib/text-units");
    const body = "First paragraph here.\n\nSecond paragraph, with the needle in it.\n\nThird.";
    const units = await openUnits("text", new File([body], "notes.txt"));
    const reader = buildTextUnits(
      readTextDocument(new TextEncoder().encode(body), "notes.txt", null).paras,
    );
    expect(units.count).toBe(reader.count);
    expect(await units.extract(1)).toBe(reader.texts[0]);
    expect(units.signature).toBe(reader.signature);
    expect(units.label?.(1)).toBe("0–100%");
  });

  it("reads an RTF file as paragraphs, not as one block", async () => {
    const rtf = "{\\rtf1\\ansi First one.\\par Second one.\\par Third one.\\par}";
    const units = await openUnits("text", new File([rtf], "letter.rtf"));
    expect(await units.extract(1)).toBe("First one. Second one. Third one.");
  });

  it("reads text in the encoding the book was given", async () => {
    const latin = new File([new Uint8Array([0x63, 0x61, 0x66, 0xe9])], "old.txt");
    const units = await openUnits("text", latin, { encoding: "windows-1252" });
    expect(await units.extract(1)).toBe("café");
  });

  it("gives an HTML file the blocks of the document the reader shows, scripts removed", async () => {
    const html =
      "<html><body><script>var secret = 'nope';</script><h1>Title</h1><p>Body text with a needle.</p></body></html>";
    const units = await openUnits("html", new File([html], "page.html"));
    expect(units.count).toBe(1);
    expect(await units.extract(1)).toBe("Title Body text with a needle.");
  });

  it("converts Markdown before taking its blocks", async () => {
    const units = await openUnits(
      "html",
      new File(["# Heading\n\nSome *emphasised* words."], "n.md"),
    );
    expect(await units.extract(1)).toBe("Heading Some emphasised words.");
  });

  it("has no units for an empty file", async () => {
    const units = await openUnits("text", new File([""], "empty.txt"));
    expect(units.count).toBe(0);
  });
});
