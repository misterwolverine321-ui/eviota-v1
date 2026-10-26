import { rtfToText } from "./rtf";
import { decodeText, type DecodeResult } from "./text-decode";

/**
 * A text or RTF file as the reader sees it: decoded, RTF turned into text, cut into paragraphs.
 *
 * The text reader and the shelf indexer both start here, so paragraph n is the same paragraph in
 * both, which is what lets a hit found from the shelf be walked back to the place it came from.
 */
export interface TextDocument {
  paras: string[];
  decoded: DecodeResult;
}

export function readTextDocument(
  bytes: Uint8Array,
  fileName: string,
  encoding: string | null,
): TextDocument {
  const decoded = decodeText(bytes, encoding);
  const raw = decoded.text;
  const isRtf = /\.rtf$/i.test(fileName) || raw.slice(0, 5) === "{\\rtf";
  const text = isRtf ? rtfToText(raw) : raw;
  const paras = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { paras, decoded };
}
