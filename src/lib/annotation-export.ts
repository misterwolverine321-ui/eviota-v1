import type { Annotation } from "./annotations";

/**
 * Annotation export. Highlights and notes are the part of a library people
 * invest years in, so they must leave the app in formats other tools read:
 * Markdown (Obsidian and plain notes), HTML (print or share), JSON (lossless)
 * and CSV (spreadsheets). Everything is built locally from what is stored.
 *
 * Each row carries where the mark sits (label, page, CFI) and, for text
 * anchors, the surrounding words, so a quote can be found again in the book.
 */

export type ExportFormat = "markdown" | "html" | "json" | "csv";

export const EXPORT_FORMATS: { id: ExportFormat; label: string; extension: string }[] = [
  { id: "markdown", label: "Markdown", extension: "md" },
  { id: "html", label: "HTML", extension: "html" },
  { id: "json", label: "JSON", extension: "json" },
  { id: "csv", label: "CSV", extension: "csv" },
];

export interface ExportBook {
  id: string;
  title: string;
  author: string;
  format?: string;
  fileName?: string;
}

export interface ExportRow {
  type: Annotation["type"];
  color: Annotation["color"];
  /** The marked passage; empty for bookmarks and ink. */
  quote: string;
  note: string;
  /** Chapter or page label captured when the mark was made. */
  location: string;
  page: number | null;
  cfi: string | null;
  contextBefore: string;
  contextAfter: string;
  /** The page text changed and the mark could not be re-found. */
  orphaned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BookExport {
  book: ExportBook;
  rows: ExportRow[];
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Normalise stored annotations into rows, in reading order. */
export function toRows(annotations: Annotation[]): ExportRow[] {
  const rows = annotations.map((a) => {
    const anchor = a.anchor;
    const page = anchor.kind === "cfi" ? null : anchor.page;
    // Reflowable text anchors keep the CFI they were created with as a hint.
    const cfi = (anchor.kind === "rect" ? undefined : anchor.cfi) ?? null;
    const quote = a.text ?? (anchor.kind === "text" ? anchor.quote : "");
    return {
      row: {
        type: a.type,
        color: a.color,
        quote,
        note: a.note ?? "",
        location: a.label ?? (page !== null ? `Page ${page}` : ""),
        page,
        cfi,
        contextBefore: anchor.kind === "text" ? anchor.prefix : "",
        contextAfter: anchor.kind === "text" ? anchor.suffix : "",
        orphaned: !!a.orphaned,
        createdAt: iso(a.createdAt),
        updatedAt: iso(a.updatedAt),
      } satisfies ExportRow,
      created: a.createdAt,
    };
  });
  rows.sort((a, b) => (a.row.page ?? 0) - (b.row.page ?? 0) || a.created - b.created);
  return rows.map((r) => r.row);
}

/**
 * Group a whole library's annotations by book. Books with nothing marked are
 * left out, and marks whose book has since been removed are skipped (there is
 * no title to put them under). Books are in title order.
 */
export function groupByBook(books: ExportBook[], annotations: Annotation[]): BookExport[] {
  const byBook = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const list = byBook.get(a.bookId);
    if (list) list.push(a);
    else byBook.set(a.bookId, [a]);
  }
  return books
    .filter((b) => byBook.has(b.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((book) => ({ book, rows: toRows(byBook.get(book.id)!) }));
}

// ------------------------------------------------------------- Markdown --

/** Raw HTML in a quote must not become live markup in a notes app. */
const mdSafe = (text: string) => text.replace(/<(?=[a-zA-Z!/?])/g, "&lt;");

const blockquote = (text: string) =>
  mdSafe(text)
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");

const TYPE_LABEL: Record<Annotation["type"], string> = {
  highlight: "Highlight",
  underline: "Underline",
  strike: "Strikethrough",
  note: "Note",
  ink: "Drawing",
  bookmark: "Bookmark",
};

function renderMarkdown(books: BookExport[], exportedAt: string): string {
  const out: string[] = [];
  const single = books.length === 1;

  if (single) {
    const { book, rows } = books[0]!;
    // Front matter is only valid at the very start of a file. JSON strings are
    // valid YAML double-quoted scalars and cannot break out of the value.
    out.push("---");
    out.push(`title: ${JSON.stringify(book.title)}`);
    out.push(`author: ${JSON.stringify(book.author)}`);
    out.push("source: Eviota");
    out.push(`exported: ${exportedAt}`);
    out.push(`annotations: ${rows.length}`);
    out.push("---", "");
  } else {
    out.push("# Notes from your library", "", `Exported from Eviota on ${exportedAt}.`, "");
  }

  for (const { book, rows } of books) {
    out.push(`${single ? "#" : "##"} ${mdSafe(book.title).replace(/\r?\n/g, " ")}`, "");
    if (book.author) out.push(mdSafe(book.author), "");
    if (!rows.length) out.push("_No highlights, notes or bookmarks._", "");
    for (const row of rows) {
      if (row.quote) out.push(blockquote(row.quote), "");
      if (row.note) out.push(`**Note:** ${mdSafe(row.note)}`, "");
      const meta = [TYPE_LABEL[row.type], row.color, row.location].filter(Boolean).join(" · ");
      out.push(`— ${meta}${row.orphaned ? " · could not be re-found in the text" : ""}`, "");
    }
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

// ----------------------------------------------------------------- HTML --

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const paragraphs = (text: string) => escapeHtml(text).split(/\r?\n/).join("<br>");

function renderHtml(books: BookExport[], exportedAt: string): string {
  const sections = books
    .map(({ book, rows }) => {
      const items = rows
        .map((row) => {
          const meta = [TYPE_LABEL[row.type], row.color, row.location].filter(Boolean).join(" · ");
          return (
            `<article class="mark ${escapeHtml(row.color)}">` +
            (row.quote ? `<blockquote>${paragraphs(row.quote)}</blockquote>` : "") +
            (row.note ? `<p class="note">${paragraphs(row.note)}</p>` : "") +
            `<p class="meta">${escapeHtml(meta)}${row.orphaned ? " · could not be re-found in the text" : ""}</p>` +
            `</article>`
          );
        })
        .join("\n");
      return (
        `<section><h2>${escapeHtml(book.title)}</h2>` +
        (book.author ? `<p class="author">${escapeHtml(book.author)}</p>` : "") +
        (items || `<p class="empty">No highlights, notes or bookmarks.</p>`) +
        `</section>`
      );
    })
    .join("\n");
  const title = books.length === 1 ? `Notes — ${books[0]!.book.title}` : "Notes from your library";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--fg:#1a1a1a;--bg:#fdfdfd;--sub:#666;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--fg:#e8e8e8;--bg:#161616;--sub:#999;--line:#333}}
body{margin:0 auto;max-width:42rem;padding:2.5rem 1.25rem;background:var(--bg);color:var(--fg);font:1rem/1.6 Georgia,serif}
h1{font-size:1.6rem}h2{font-size:1.25rem;margin:2.5rem 0 .2rem}.author{margin:0 0 1.5rem;color:var(--sub)}
.mark{border-left:4px solid var(--line);padding:.1rem 0 .1rem 1rem;margin:1.25rem 0}
.yellow{border-color:#F5C542}.pink{border-color:#F58AA8}.green{border-color:#79C88F}.blue{border-color:#6FA8DC}.purple{border-color:#B08BE0}
blockquote{margin:0}.note{margin:.5rem 0 0;font-style:italic}
.meta,.empty{margin:.4rem 0 0;color:var(--sub);font:.8rem system-ui,sans-serif}
.foot{margin-top:3rem;color:var(--sub);font:.75rem system-ui,sans-serif}
@media print{body{max-width:none}}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${sections}
<p class="foot">Exported from Eviota on ${escapeHtml(exportedAt)}.</p>
</body></html>
`;
}

// ----------------------------------------------------------------- JSON --

function renderJson(books: BookExport[], exportedAt: string): string {
  return `${JSON.stringify(
    {
      app: "eviota",
      kind: "annotations",
      version: 1,
      exportedAt,
      books: books.map(({ book, rows }) => ({ ...book, annotations: rows })),
    },
    null,
    2,
  )}\n`;
}

// ------------------------------------------------------------------ CSV --

/**
 * A spreadsheet runs a cell that starts with `=`, `+`, `-` or `@` as a
 * formula, and a highlight can be any text from any file. Prefixing an
 * apostrophe makes the cell inert (the OWASP-recommended defence). The cost is
 * a visible apostrophe on passages that legitimately start with one of those.
 */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  "book",
  "author",
  "type",
  "color",
  "location",
  "page",
  "quote",
  "note",
  "context_before",
  "context_after",
  "created",
  "updated",
  "orphaned",
  "cfi",
];

function renderCsv(books: BookExport[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const { book, rows } of books) {
    for (const r of rows) {
      lines.push(
        [
          book.title,
          book.author,
          r.type,
          r.color,
          r.location,
          r.page,
          r.quote,
          r.note,
          r.contextBefore,
          r.contextAfter,
          r.createdAt,
          r.updatedAt,
          r.orphaned,
          r.cfi,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  // BOM: without it Excel reads UTF-8 (Devanagari, accents) as Windows-1252.
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

// --------------------------------------------------------------- public --

export interface RenderedExport {
  content: string;
  mime: string;
  extension: string;
}

export function renderExport(
  format: ExportFormat,
  books: BookExport[],
  now: Date = new Date(),
): RenderedExport {
  const exportedAt = now.toISOString().slice(0, 10);
  switch (format) {
    case "markdown":
      return { content: renderMarkdown(books, exportedAt), mime: "text/markdown", extension: "md" };
    case "html":
      return { content: renderHtml(books, exportedAt), mime: "text/html", extension: "html" };
    case "json":
      return {
        content: renderJson(books, now.toISOString()),
        mime: "application/json",
        extension: "json",
      };
    case "csv":
      return { content: renderCsv(books), mime: "text/csv", extension: "csv" };
  }
}

const slug = (text: string) =>
  text
    .toLowerCase()
    // \p{M}: Devanagari vowel signs and the virama are combining marks, not letters.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export function exportFileName(
  extension: string,
  book: ExportBook | null,
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().slice(0, 10);
  return `eviota-notes-${book ? slug(book.title) || "book" : "all-books"}-${stamp}.${extension}`;
}
