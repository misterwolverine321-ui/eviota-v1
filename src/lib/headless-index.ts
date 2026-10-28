import { getBook, getBookFile, type BookRecord } from "./db";
import { getFormatInfo } from "./formats";
import { installPdfJsPolyfill } from "./pdfjs-polyfill";
import { normalizeText } from "./search";
import { sectionLabeller } from "./section-labels";
import { ensureIndex, INDEX_VERSION, readIndex, sweepOrphanIndexes } from "./search-index";

/**
 * Shelf search over books that have never been opened.
 *
 * The reader builds a book's search index while the book is open, from its own engine. This module
 * builds the same index without the reader: it opens the file the way import already does and
 * extracts text unit by unit, with the same numbering the reader uses, so a hit found from the shelf
 * opens the reader at the right place. Only formats whose reader numbers its units in a way this
 * module reproduces are covered:
 *  - EPUB, MOBI, AZW, AZW3 and FB2 (the foliate engine): one unit per section of `book.sections`,
 *    text from `section.createDocument()` (the same call the reader makes);
 *  - PDF (pdf.js): one unit per page, text from `getTextContent()`, normalised as the PDF reader does;
 *  - plain text and RTF: the paragraphs the text reader shows, cut into units by `text-units.ts`;
 *  - HTML and Markdown: the blocks of the document the HTML reader shows (`html-blocks.ts`), cut the
 *    same way.
 * For the last two there is nothing like a page or a section, so the reader and this module call the
 * same functions on the same file; the unit tests check that they agree.
 * Comics and DjVu are not covered: a comic has text only after OCR, which runs in the reader, and a
 * DjVu text layer is read by an engine this module does not start. The shelf says how many books
 * are covered.
 *
 * Nothing here touches the network: the files come from IndexedDB and are parsed in this window.
 */

export type HeadlessKind = "foliate" | "pdf" | "text" | "html";

/** The kind of reader a book has, when shelf search can index it headlessly; otherwise null. */
export function headlessKind(fileName: string): HeadlessKind | null {
  const info = getFormatInfo(fileName);
  return info?.kind === "foliate" ||
    info?.kind === "pdf" ||
    info?.kind === "text" ||
    info?.kind === "html"
    ? info.kind
    : null;
}

export interface Units {
  count: number;
  extract: (unit: number) => Promise<string>;
  close: () => void;
  /** For units this module cuts itself: changes when the text does (see `BuildOptions.signature`). */
  signature?: string;
  /** Hit-list label of a unit, as the reader would give it. */
  label?: (unit: number) => string;
}

async function openFoliate(file: File): Promise<Units> {
  const { makeBook } = await import("foliate-js/view.js");
  const book = await makeBook(file);
  const sections: { createDocument?: () => Promise<Document> }[] = book.sections ?? [];
  const label = await sectionLabeller(book);
  return {
    count: sections.length,
    label,
    extract: async (unit) => {
      if (!sections.length) return "";
      // The reader's own clamp and rounding, so unit n is section n there and here.
      const i = Math.max(0, Math.min(sections.length - 1, Math.round(unit) - 1));
      const section = sections[i];
      if (!section?.createDocument) return "";
      try {
        const doc = await section.createDocument();
        return (doc?.body?.textContent ?? "").replace(/\s+/g, " ").trim();
      } catch {
        return "";
      }
    },
    close: () => {},
  };
}

async function openPdf(file: File): Promise<Units> {
  installPdfJsPolyfill();
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  return {
    count: doc.numPages,
    extract: async (p) => {
      if (p < 1 || p > doc.numPages) return "";
      const page = await doc.getPage(p);
      try {
        const content = await page.getTextContent();
        return normalizeText(
          content.items
            .map((it) =>
              typeof (it as { str?: unknown }).str === "string" ? (it as { str: string }).str : "",
            )
            .join(" "),
        );
      } finally {
        page.cleanup?.();
      }
    },
    close: () => {
      void task.destroy().catch(() => undefined);
    },
  };
}

/** Units from a block list, the way the reader cuts them. */
async function openBlocks(blocks: string[]): Promise<Units> {
  const { buildTextUnits, unitPercentLabel } = await import("./text-units");
  const units = buildTextUnits(blocks);
  return {
    count: units.count,
    extract: async (unit) => units.texts[Math.round(unit) - 1] ?? "",
    close: () => {},
    signature: units.signature,
    label: (unit) => unitPercentLabel(units, unit),
  };
}

async function openText(file: File, encoding: string | null): Promise<Units> {
  const { readTextDocument } = await import("./text-document");
  const { paras } = readTextDocument(new Uint8Array(await file.arrayBuffer()), file.name, encoding);
  return openBlocks(paras);
}

async function openHtml(file: File): Promise<Units> {
  const { prepareRawView, blockTextsOfBody } = await import("./html-blocks");
  return openBlocks(blockTextsOfBody(prepareRawView(await file.text(), file.name).html));
}

/**
 * Opens a book's units for indexing. Exported for the unit tests, which check the numbering.
 * `encoding` is the text encoding the reader was told to use for this book, if any.
 */
export async function openUnits(
  kind: HeadlessKind,
  file: File,
  opts: { encoding?: string | null } = {},
): Promise<Units> {
  if (kind === "pdf") return openPdf(file);
  if (kind === "text") return openText(file, opts.encoding ?? null);
  if (kind === "html") return openHtml(file);
  return openFoliate(file);
}

export interface ShelfIndexStatus {
  /** Books shelf search can index (see `headlessKind`) that are on the shelf with their file kept. */
  eligible: number;
  /** Of those, how many have a finished index for the current index version. */
  ready: number;
  /** Of those, how many could not be indexed (unreadable file, no pages). */
  failed: number;
}

function isReady(record: Awaited<ReturnType<typeof readIndex>>): boolean {
  return record?.status === "ready" && record.version === INDEX_VERSION;
}

/**
 * Index every covered book on the shelf that is not yet indexed, one book at a time, in the
 * background. Aborting stops it at the next batch; a book left half-done resumes on the next run,
 * because each batch is written as it finishes (the reader's index works the same way).
 */
export async function indexShelfHeadless(
  books: BookRecord[],
  opts: { signal?: AbortSignal; onStatus?: (status: ShelfIndexStatus) => void } = {},
): Promise<void> {
  const { signal, onStatus } = opts;
  // Index records left behind by books deleted while they were being indexed (older builds); the
  // build now refuses to write for a book that is gone, so this only ever finds old leftovers.
  try {
    await sweepOrphanIndexes();
  } catch {
    /* housekeeping: the shelf indexes regardless */
  }
  const candidates: { book: BookRecord; kind: HeadlessKind }[] = [];
  for (const book of books) {
    const kind = headlessKind(book.fileName);
    if (kind) candidates.push({ book, kind });
  }

  // A book whose file is not kept (evicted) cannot be read here, so it is not counted as eligible.
  const withFile: typeof candidates = [];
  for (const c of candidates) {
    if (signal?.aborted) return;
    if (await getBookFile(c.book.id)) withFile.push(c);
  }

  let ready = 0;
  let failed = 0;
  const report = () => onStatus?.({ eligible: withFile.length, ready, failed });
  for (const c of withFile) {
    if (isReady(await readIndex(c.book.id))) ready++;
  }
  report();

  for (const { book, kind } of withFile) {
    if (signal?.aborted) return;
    if (isReady(await readIndex(book.id))) continue;
    let units: Units | null = null;
    try {
      const blob = await getBookFile(book.id);
      if (!blob) {
        // Deleted since the run began: not a book that could not be read.
        if (await getBook(book.id)) failed++;
        continue;
      }
      const file =
        blob instanceof File ? blob : new File([blob], book.fileName, { type: blob.type });
      units = await openUnits(kind, file, { encoding: book.encoding ?? null });
      if (units.count < 1) {
        failed++;
        continue;
      }
      const record = await ensureIndex({
        bookId: book.id,
        pageCount: units.count,
        extract: units.extract,
        ...(units.signature !== undefined ? { signature: units.signature } : {}),
        ...(units.label ? { label: units.label } : {}),
        signal,
      });
      if (record.status === "ready") ready++;
      else if (record.status === "failed") failed++;
    } catch {
      failed++;
    } finally {
      units?.close();
      report();
    }
  }
}
