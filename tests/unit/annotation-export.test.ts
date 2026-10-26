// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Annotation } from "@/lib/annotations";
import {
  csvCell,
  escapeHtml,
  exportFileName,
  groupByBook,
  renderExport,
  toRows,
  type BookExport,
} from "@/lib/annotation-export";

const T = Date.UTC(2026, 9, 7, 12, 0, 0);
const base = { bookId: "b1", color: "yellow" as const, createdAt: T, updatedAt: T + 1000 };

const annotations: Annotation[] = [
  {
    ...base,
    id: "a-late",
    type: "highlight",
    createdAt: T + 50,
    anchor: {
      kind: "text",
      page: 12,
      start: 10,
      end: 40,
      quote: "ignored when text is set",
      prefix: "…went to the woods because ",
      suffix: " to live deliberately",
      cfi: "epubcfi(/6/14!/4/2)",
    },
    text: "I wished to live deliberately",
    label: "Where I Lived",
  },
  {
    ...base,
    id: "a-note",
    type: "note",
    color: "pink",
    anchor: { kind: "cfi", cfi: "epubcfi(/6/2!/4/8)" },
    text: 'He said, "stop, now"\nand left',
    note: "Cross-reference, see ch. 3.\nSecond line.",
    label: "Economy",
  },
  {
    ...base,
    id: "a-bm",
    type: "bookmark",
    anchor: { kind: "rect", page: 3, rects: [{ x: 0, y: 0, w: 1, h: 0.1 }] },
  },
  {
    ...base,
    id: "a-hostile",
    type: "highlight",
    color: "blue",
    anchor: {
      kind: "text",
      page: 12,
      start: 0,
      end: 5,
      quote: "q",
      prefix: "",
      suffix: "",
    },
    text: '<script>alert(1)</script><img src=x onerror=alert(2)> =HYPERLINK("http://evil.example","x")',
    orphaned: true,
  },
  {
    ...base,
    id: "a-formula",
    type: "highlight",
    color: "purple",
    anchor: { kind: "cfi", cfi: "epubcfi(/6/22!/4/2)" },
    text: "=cmd|' /C calc'!A0",
    label: "Formula",
  },
  {
    ...base,
    id: "a-nepali",
    type: "highlight",
    color: "green",
    anchor: { kind: "cfi", cfi: "epubcfi(/6/20!/4/2)" },
    text: "नमस्ते संसार, यो एउटा परीक्षा हो",
    label: "अध्याय १",
  },
];

const book: BookExport = {
  book: {
    id: "b1",
    title: 'Walden; or, "Life" in the Woods',
    author: "H. D. Thoreau",
    format: "epub",
  },
  rows: toRows(annotations),
};
const NOW = new Date(Date.UTC(2026, 9, 7));

/** An RFC 4180 reader written independently of the writer under test. */
function parseCsv(input: string): string[][] {
  const text = input.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe("toRows", () => {
  it("puts marks in reading order and carries location, page, CFI and context", () => {
    const rows = toRows(annotations);
    // page-less (CFI) marks sort first, in the order they were created, then by page
    expect(rows.map((r) => r.page)).toEqual([null, null, null, 3, 12, 12]);
    const deliberate = rows.find((r) => r.quote.startsWith("I wished"))!;
    expect(deliberate).toMatchObject({
      page: 12,
      cfi: "epubcfi(/6/14!/4/2)",
      location: "Where I Lived",
      contextBefore: "…went to the woods because ",
      contextAfter: " to live deliberately",
    });
  });

  it("labels an unlabelled paged mark by its page and leaves bookmarks without a quote", () => {
    const bm = toRows(annotations).find((r) => r.type === "bookmark")!;
    expect(bm).toMatchObject({ location: "Page 3", quote: "", cfi: null });
  });

  it("falls back to the anchor's own quote when no text was stored", () => {
    const [row] = toRows([
      {
        ...base,
        id: "x",
        type: "highlight",
        anchor: { kind: "text", page: 1, start: 0, end: 3, quote: "abc", prefix: "", suffix: "" },
      },
    ]);
    expect(row!.quote).toBe("abc");
  });
});

describe("JSON", () => {
  it("is valid, labelled, and loses nothing the rows carry", () => {
    const out = renderExport("json", [book], NOW);
    expect(out.mime).toBe("application/json");
    const parsed = JSON.parse(out.content);
    expect(parsed).toMatchObject({ app: "eviota", kind: "annotations", version: 1 });
    expect(parsed.exportedAt).toBe("2026-10-07T00:00:00.000Z");
    expect(parsed.books[0].title).toBe('Walden; or, "Life" in the Woods');
    expect(parsed.books[0].annotations).toEqual(book.rows);
  });
});

describe("CSV", () => {
  const out = renderExport("csv", [book], NOW);
  const rows = parseCsv(out.content);
  const header = rows[0]!;
  const col = (r: string[], name: string) => r[header.indexOf(name)];

  it("starts with a UTF-8 BOM so Excel reads Devanagari correctly, and uses CRLF", () => {
    expect(out.content.charCodeAt(0)).toBe(0xfeff);
    expect(out.content).toContain("\r\n");
    expect(out.content).not.toMatch(/[^\r]\n(?=[^"]*(?:"[^"]*"[^"]*)*$)/); // no bare LF outside quotes
  });

  it("has a header and one row per annotation, every row the same width", () => {
    expect(header).toContain("quote");
    expect(rows).toHaveLength(1 + annotations.length);
    for (const r of rows) expect(r).toHaveLength(header.length);
  });

  it("round-trips commas, quotes and newlines inside cells", () => {
    const note = rows.find((r) => col(r, "type") === "note")!;
    expect(col(note, "quote")).toBe('He said, "stop, now"\nand left');
    expect(col(note, "note")).toBe("Cross-reference, see ch. 3.\nSecond line.");
    expect(col(note, "book")).toBe('Walden; or, "Life" in the Woods');
  });

  it("keeps Devanagari exactly", () => {
    const row = rows.find((r) => col(r, "location") === "अध्याय १")!;
    expect(col(row, "quote")).toBe("नमस्ते संसार, यो एउटा परीक्षा हो");
  });

  it("neutralises a formula in a highlight so a spreadsheet will not run it", () => {
    const formula = rows.find((r) => col(r, "location") === "Formula")!;
    expect(col(formula, "quote")).toBe("'=cmd|' /C calc'!A0");
    expect(csvCell('=HYPERLINK("http://evil.example")')).toBe(
      `"'=HYPERLINK(""http://evil.example"")"`,
    );
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(csvCell(`${lead}1+1`).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
  });

  it("writes numbers and booleans as such, and CFIs verbatim", () => {
    const hl = rows.find((r) => col(r, "location") === "Where I Lived")!;
    expect(col(hl, "page")).toBe("12");
    expect(col(hl, "cfi")).toBe("epubcfi(/6/14!/4/2)");
    expect(col(hl, "orphaned")).toBe("false");
  });
});

describe("HTML", () => {
  const out = renderExport("html", [book], NOW);
  const doc = new DOMParser().parseFromString(out.content, "text/html");

  it("is a document with no script, no handlers and no remote references", () => {
    expect(doc.querySelectorAll("script, iframe, object, embed, link")).toHaveLength(0);
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      expect(Array.from(el.attributes).some((a) => /^on/i.test(a.name))).toBe(false);
    }
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    // Hostile *text* may mention a URL; no attribute may point at one.
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes))
        expect(attr.value).not.toMatch(/^(https?:)?\/\//i);
    }
    expect(
      doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    ).toContain("default-src 'none'");
  });

  it("shows hostile text as text, not as markup", () => {
    expect(doc.body.textContent).toContain("<script>alert(1)</script>");
    expect(doc.body.textContent).toContain("<img src=x onerror=alert(2)>");
  });

  it("escapes the title and keeps line breaks", () => {
    expect(doc.querySelector("h2")?.textContent).toBe('Walden; or, "Life" in the Woods');
    expect(doc.querySelector("blockquote br")).not.toBeNull();
    expect(doc.title).toBe('Notes — Walden; or, "Life" in the Woods');
  });

  it("escapeHtml covers the five special characters", () => {
    expect(escapeHtml(`<a href="x" b='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; b=&#39;y&#39;&gt;&amp;",
    );
  });
});

describe("Markdown", () => {
  const out = renderExport("markdown", [book], NOW);
  const lines = out.content.split("\n");

  it("starts with front matter that cannot be broken out of", () => {
    expect(lines[0]).toBe("---");
    expect(lines[1]).toBe('title: "Walden; or, \\"Life\\" in the Woods"');
    expect(lines[2]).toBe('author: "H. D. Thoreau"');
    expect(lines).toContain("exported: 2026-10-07");
    expect(lines.indexOf("---", 1)).toBe(6);
  });

  it("quotes multi-line passages line by line and keeps notes and locations", () => {
    expect(out.content).toContain('> He said, "stop, now"\n> and left');
    expect(out.content).toContain("**Note:** Cross-reference, see ch. 3.");
    expect(out.content).toContain("— Highlight · yellow · Where I Lived");
    expect(out.content).toContain("— Bookmark · yellow · Page 3");
    expect(out.content).toContain(
      "— Highlight · blue · Page 12 · could not be re-found in the text",
    );
  });

  it("does not let raw HTML from a book through as live markup", () => {
    expect(out.content).not.toMatch(/<script|<img/i);
    expect(out.content).toContain("&lt;script>alert(1)");
  });

  it("an export of several books has one header and no mid-file front matter", () => {
    const many = renderExport(
      "markdown",
      [book, { book: { id: "b2", title: "Alice", author: "Carroll" }, rows: [] }],
      NOW,
    ).content;
    expect(many.startsWith("# Notes from your library")).toBe(true);
    expect(many).toContain("## Alice");
    expect(many).toContain("_No highlights, notes or bookmarks._");
    expect(many).not.toContain("\n---\n");
    expect(many.startsWith("---")).toBe(false);
  });

  it("a book with nothing in it says so instead of producing an empty file", () => {
    const empty = renderExport("markdown", [{ book: book.book, rows: [] }], NOW).content;
    expect(empty).toContain("_No highlights, notes or bookmarks._");
    expect(empty).toContain("annotations: 0");
  });
});

describe("file names", () => {
  it("slugs the title, keeps non-Latin letters, and dates the file", () => {
    expect(exportFileName("md", book.book, NOW)).toBe(
      "eviota-notes-walden-or-life-in-the-woods-2026-10-07.md",
    );
    expect(exportFileName("csv", { id: "x", title: "नमस्ते संसार", author: "" }, NOW)).toBe(
      "eviota-notes-नमस्ते-संसार-2026-10-07.csv",
    );
  });

  it("falls back for empty titles and for an all-books export", () => {
    expect(exportFileName("json", { id: "x", title: "***", author: "" }, NOW)).toBe(
      "eviota-notes-book-2026-10-07.json",
    );
    expect(exportFileName("html", null, NOW)).toBe("eviota-notes-all-books-2026-10-07.html");
  });
});

describe("groupByBook", () => {
  const mk = (id: string, bookId: string): Annotation => ({
    ...base,
    id,
    bookId,
    type: "highlight",
    anchor: { kind: "cfi", cfi: `epubcfi(/6/${id})` },
    text: id,
  });
  const books = [
    { id: "z", title: "Zeta", author: "" },
    { id: "a", title: "Alpha", author: "" },
    { id: "empty", title: "Never marked", author: "" },
  ];

  it("keeps only books that have marks, in title order, and drops marks of removed books", () => {
    const grouped = groupByBook(books, [mk("1", "z"), mk("2", "a"), mk("3", "a"), mk("4", "gone")]);
    expect(grouped.map((g) => g.book.title)).toEqual(["Alpha", "Zeta"]);
    expect(grouped[0]!.rows.map((r) => r.quote)).toEqual(["2", "3"]);
    expect(JSON.stringify(grouped)).not.toContain('"4"');
  });

  it("returns nothing for a library with no marks", () => {
    expect(groupByBook(books, [])).toEqual([]);
  });
});
