import type { CSSProperties } from "react";
import type { ReaderSettings } from "@/lib/reader-settings";

/**
 * Shared reflowable-text typography.
 *
 * The EPUB engine injects its own stylesheet into foliate's shadow renderer, so
 * it builds these rules inline. The TXT/HTML/Markdown engines render their own
 * DOM, and they read the same knobs from here — one place to keep alignment,
 * hyphenation, letter spacing and paragraph rhythm identical across formats.
 *
 * Units: `letterSpacing` is hundredths of an em (−2…+8), `paragraphSpacing` is
 * tenths of an em (0…20). Indent only applies when paragraphs are not already
 * separated by space — indent *and* spacing together reads as a double break.
 */

/** Whether a first-line indent should be drawn for these settings. */
export function indentActive(s: ReaderSettings): boolean {
  return s.paragraphIndent && s.paragraphSpacing === 0;
}

/** Em value for the gap between consecutive paragraphs. */
export function paragraphGapEm(s: ReaderSettings): number {
  return s.paragraphSpacing / 10;
}

/** Block-level typography for a rendered text column (React style object). */
export function textBlockStyle(s: ReaderSettings): CSSProperties {
  return {
    textAlign: s.textAlign === "justify" ? "justify" : "start",
    letterSpacing: `${(s.letterSpacing / 100).toFixed(3)}em`,
    hyphens: s.hyphenate ? "auto" : "manual",
    WebkitHyphens: s.hyphenate ? "auto" : "manual",
    overflowWrap: "break-word",
    orphans: 2,
    widows: 2,
  } as CSSProperties;
}

/** Per-paragraph rhythm: the gap to the previous paragraph, or an indent. */
export function paragraphStyle(s: ReaderSettings, first: boolean): CSSProperties {
  const gap = paragraphGapEm(s);
  return {
    marginTop: first ? 0 : `${(gap || 1.1).toFixed(2)}em`,
    textIndent: indentActive(s) && !first ? "1.2em" : 0,
  };
}

/** The same rules as CSS text, for engines that render into an iframe. */
export function typographyCss(s: ReaderSettings): string {
  const gap = paragraphGapEm(s);
  return `
    body {
      text-align: ${s.textAlign === "justify" ? "justify" : "start"};
      letter-spacing: ${(s.letterSpacing / 100).toFixed(3)}em;
      hyphens: ${s.hyphenate ? "auto" : "manual"};
      -webkit-hyphens: ${s.hyphenate ? "auto" : "manual"};
      overflow-wrap: break-word;
      orphans: 2;
      widows: 2;
    }
    p + p {
      margin-top: ${(gap || 1).toFixed(2)}em;
      text-indent: ${indentActive(s) ? "1.2em" : "0"};
    }
    h1, h2, h3, h4, h5, h6 { text-align: start; hyphens: manual; letter-spacing: normal; }
  `;
}
