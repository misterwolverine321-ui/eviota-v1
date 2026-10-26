import type { Annotation } from "./annotations";
import { ANCHOR_CONTEXT } from "./text-anchor";

/**
 * Repair for marks made with a triple click by checkpoint 8 and earlier.
 *
 * Those builds read the end of a selection that finished at the start of the next block as
 * if it finished at the END of the next block, so a stored mark ran on over the following
 * paragraph: `anchor.end`, `quote`, `suffix` and the creation-time CFI all covered it. The
 * record's `text`, the raw selection, was always right, and that is what makes the repair
 * possible without opening the book: when the stored quote begins with exactly the selected
 * characters and goes on beyond them, the surplus is the overshoot.
 *
 * The check is deliberately narrow. It compares ignoring all whitespace (the text map
 * collapses runs and does not invent a space between blocks that touch), and it acts only when
 * the quote is strictly longer than the selection and starts with it. A genuine selection
 * across paragraphs has the same words on both sides and is left alone, as is anything whose
 * text differs from the quote in any other way. Doubt means no repair.
 *
 * Pure: no DOM, no storage. Returns the corrected record, or null when nothing needs fixing.
 */

const bare = (s: string) => s.replace(/\s+/g, "");

export function repairOvershoot(annotation: Annotation): Annotation | null {
  if (!annotation || typeof annotation !== "object") return null;
  const { anchor, text, type } = annotation;
  if (!anchor || anchor.kind !== "text") return null;
  if (type !== "highlight" && type !== "underline" && type !== "strike") return null;
  const { quote } = anchor;
  if (typeof text !== "string" || typeof quote !== "string") return null;
  // The stored offsets must agree with the stored quote, or nothing here can be trusted.
  if (anchor.end - anchor.start !== quote.length) return null;

  const want = bare(text);
  if (!want) return null;
  const have = bare(quote);
  if (have.length <= want.length || !have.startsWith(want)) return null;

  // The shortest prefix of the quote that holds every selected character.
  let kept = 0;
  let at = 0;
  while (at < quote.length && kept < want.length) {
    if (!/\s/.test(quote[at]!)) kept++;
    at++;
  }

  return {
    ...annotation,
    anchor: {
      kind: "text",
      page: anchor.page,
      start: anchor.start,
      end: anchor.start + at,
      quote: quote.slice(0, at),
      prefix: anchor.prefix,
      // What the mark used to cover is now the text that follows it.
      suffix: (quote.slice(at) + anchor.suffix).slice(0, ANCHOR_CONTEXT),
      // The old CFI ends in the wrong place; the engine derives a right one on load.
    },
  };
}
