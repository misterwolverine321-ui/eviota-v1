export type ReaderKind =
  | "foliate" // epub, mobi, azw, azw3, fb2
  | "pdf"
  | "text" // txt, rtf
  | "html"
  | "comic" // cbz, cbr, cb7 via libarchive
  | "djvu" // djvu, djv: opened by the djvu-rs engine (src/workers/djvu.worker.ts)
  | "chm" // compiled HTML help: recognised and kept, no decoder is shipped
  | "unsupported";

export type FormatCategory = "book" | "comic" | "doc" | "web";

export interface FormatInfo {
  ext: string;
  label: string;
  category: FormatCategory;
  kind: ReaderKind;
  blurb: string;
}

export const FORMATS: Record<string, FormatInfo> = {
  epub: {
    ext: "epub",
    label: "EPUB",
    category: "book",
    kind: "foliate",
    blurb: "The universal open e-book standard",
  },
  mobi: {
    ext: "mobi",
    label: "MOBI",
    category: "book",
    kind: "foliate",
    blurb: "Legacy Amazon Kindle format",
  },
  azw: { ext: "azw", label: "AZW", category: "book", kind: "foliate", blurb: "Kindle format" },
  azw3: {
    ext: "azw3",
    label: "AZW3",
    category: "book",
    kind: "foliate",
    blurb: "Modern Kindle KF8 format",
  },
  fb2: {
    ext: "fb2",
    label: "FB2",
    category: "book",
    kind: "foliate",
    blurb: "FictionBook XML e-book",
  },
  pdf: {
    ext: "pdf",
    label: "PDF",
    category: "doc",
    kind: "pdf",
    blurb: "Fixed-layout documents & scans",
  },
  txt: { ext: "txt", label: "TXT", category: "doc", kind: "text", blurb: "Plain text" },
  rtf: { ext: "rtf", label: "RTF", category: "doc", kind: "text", blurb: "Rich text documents" },
  md: {
    ext: "md",
    label: "MD",
    category: "doc",
    kind: "html",
    blurb: "Markdown notes & documents",
  },
  markdown: {
    ext: "markdown",
    label: "MD",
    category: "doc",
    kind: "html",
    blurb: "Markdown notes & documents",
  },
  cbz: {
    ext: "cbz",
    label: "CBZ",
    category: "comic",
    kind: "comic",
    blurb: "Comic book ZIP archive",
  },
  cbr: {
    ext: "cbr",
    label: "CBR",
    category: "comic",
    kind: "comic",
    blurb: "Comic book RAR archive",
  },
  cb7: {
    ext: "cb7",
    label: "CB7",
    category: "comic",
    kind: "comic",
    blurb: "Comic book 7-Zip archive",
  },
  html: { ext: "html", label: "HTML", category: "web", kind: "html", blurb: "Saved web pages" },
  htm: { ext: "htm", label: "HTM", category: "web", kind: "html", blurb: "Saved web pages" },
  chm: {
    ext: "chm",
    label: "CHM",
    category: "doc",
    kind: "chm",
    blurb: "Compiled HTML help files",
  },
  djvu: {
    ext: "djvu",
    label: "DJVU",
    category: "doc",
    kind: "djvu",
    blurb: "High-resolution scanned documents",
  },
  djv: {
    ext: "djv",
    label: "DJV",
    category: "doc",
    kind: "djvu",
    blurb: "High-resolution scanned documents",
  },
};

export const FORMAT_STRIP_ORDER = [
  "epub",
  "pdf",
  "txt",
  "rtf",
  "mobi",
  "azw3",
  "fb2",
  "cbz",
  "cbr",
  "cb7",
  "html",
  "djvu",
];

export const CATEGORY_LABELS: Record<FormatCategory, string> = {
  book: "E-Books",
  comic: "Comics & Manga",
  doc: "Documents",
  web: "Web Pages",
};

export function getFormatInfo(fileName: string): FormatInfo | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return FORMATS[ext] ?? null;
}
