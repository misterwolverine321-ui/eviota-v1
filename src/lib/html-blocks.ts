import type { TocItem } from "./reader-settings";
import { annotateHeadings, isMarkdownFile, markdownToHtml } from "./markdown";
import { hardenPage, type BlockedReport } from "./safe-document";
import { normalizeText } from "./search";

/**
 * The text blocks of an HTML (or Markdown) document, defined once.
 *
 * Search over these formats works block by block: a hit is "block n, so many characters in". The
 * HTML reader needs the blocks as elements (to scroll to one and tint it), and the shelf indexer
 * needs the same blocks as strings without showing the document. Both come from here, and the
 * document both start from comes from `prepareRawView`, so block n is the same block in both.
 */

/** Block elements that own their own text run for search purposes. */
export const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dd, dt, figcaption";

/** The innermost block elements of a document that carry text, in document order. */
export function collectBlockElements(root: ParentNode): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR).forEach((el) => {
    if (el.querySelector(BLOCK_SELECTOR)) return; // keep the innermost block
    if (!normalizeText(el.textContent ?? "")) return;
    blocks.push(el);
  });
  return blocks;
}

/** The whitespace-collapsed text of each block of a document body, parsed without displaying it. */
export function blockTextsOfBody(bodyHtml: string): string[] {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${bodyHtml}</body></html>`,
    "text/html",
  );
  return collectBlockElements(doc.body).map((el) => normalizeText(el.textContent ?? ""));
}

export interface RawView {
  /** The document as the page, before any reading-view extraction (Markdown already converted). */
  source: string;
  /** The hardened body markup the reader shows. */
  html: string;
  toc: TocItem[];
  report: BlockedReport;
}

/**
 * The reader's own view of an HTML or Markdown file: converted if Markdown, hardened (scripts,
 * handlers and remote references removed), headings annotated. Pure of side effects, so the shelf
 * indexer can call it on a book that is never opened.
 */
export function prepareRawView(text: string, fileName: string): RawView {
  const source = isMarkdownFile(fileName) ? markdownToHtml(text).html : text;
  const page = hardenPage(source);
  const { html, toc } = annotateHeadings(page.body);
  return { source, html, toc, report: page.report };
}
