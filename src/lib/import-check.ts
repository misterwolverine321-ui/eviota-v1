import { getFormatInfo } from "./formats";

/**
 * Checks made before a file is decoded, so a file that cannot be the kind its name says is refused
 * with a reason instead of failing somewhere inside a reader. Only the first bytes are read.
 *
 * A check here is a claim about a file's header, not a guarantee that the rest of the file is
 * sound: a zip with a good header and a broken directory still passes, and fails later in the
 * reader, as before. Formats with no fixed header (TXT, RTF, FB2, HTML, Markdown) are checked for
 * being empty only.
 */

const HEAD_BYTES = 1024;

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

const at = (head: Uint8Array, offset: number, bytes: number[]): boolean =>
  head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b);

/** A ZIP local header, an empty archive or a split archive: `PK` then 3/4, 5/6 or 7/8. */
const isZip = (head: Uint8Array): boolean =>
  at(head, 0, [0x50, 0x4b]) &&
  [3, 5, 7].includes(head[2] ?? -1) &&
  [4, 6, 8].includes(head[3] ?? -1);

/** A PDF header may follow up to 1 KiB of junk (the PDF specification allows it; readers accept it). */
const hasPdfHeader = (head: Uint8Array): boolean => {
  const text = ascii("%PDF-");
  for (let i = 0; i + text.length <= head.length; i++) if (at(head, i, text)) return true;
  return false;
};

/** A Palm database as used by MOBI, AZW and AZW3: the type field at offset 60. */
const isPalmBook = (head: Uint8Array): boolean =>
  at(head, 60, ascii("BOOKMOBI")) || at(head, 60, ascii("TEXtREAd"));

interface HeaderRule {
  /** The kind with its article, as in "is not a PDF file" and "is not an EPUB file". */
  noun: string;
  matches: (head: Uint8Array) => boolean;
}

const RULES: Record<string, HeaderRule> = {
  epub: { noun: "an EPUB", matches: isZip },
  cbz: { noun: "a CBZ", matches: isZip },
  pdf: { noun: "a PDF", matches: hasPdfHeader },
  cbr: { noun: "a CBR", matches: (h) => at(h, 0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) },
  cb7: { noun: "a CB7", matches: (h) => at(h, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  djvu: { noun: "a DjVu", matches: (h) => at(h, 0, ascii("AT&TFORM")) },
  djv: { noun: "a DjVu", matches: (h) => at(h, 0, ascii("AT&TFORM")) },
  mobi: { noun: "a Kindle", matches: isPalmBook },
  azw: { noun: "a Kindle", matches: isPalmBook },
  azw3: { noun: "a Kindle", matches: isPalmBook },
  chm: { noun: "a CHM", matches: (h) => at(h, 0, ascii("ITSF")) },
};

/** The reason a file is refused, or null when it may be imported. */
export async function fileProblem(file: File): Promise<string | null> {
  if (file.size === 0) return "is empty";
  const rule = RULES[getFormatInfo(file.name)?.ext ?? ""];
  if (!rule) return null;
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  return rule.matches(head) ? null : `is not ${rule.noun} file`;
}
