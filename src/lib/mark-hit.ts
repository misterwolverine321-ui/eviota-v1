import type { NormRect } from "@/lib/annotations";

export interface MarkBoxes {
  id: string;
  rects: NormRect[];
}

/**
 * The mark under a point, in page fractions (0..1 across and down the page).
 *
 * A PDF page's text layer covers the whole page above the highlight overlay,
 * so a click never reaches a highlight's own element. The reader asks this
 * instead, which also leaves text selection alone. Marks later in the list are
 * drawn on top, so they win where two overlap. Edges count as inside.
 */
export function markAt(
  marks: MarkBoxes[],
  x: number,
  y: number,
): { id: string; rect: NormRect } | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!;
    for (const rect of mark.rects) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return { id: mark.id, rect };
      }
    }
  }
  return null;
}

/**
 * Is this click a plain single click, as opposed to the end of a drag or part of
 * a double or triple click (both are text selection)? `down` is where the
 * pointer went down; the pointer may travel a few pixels in a plain click.
 */
export function isPlainClick(
  click: { detail: number; x: number; y: number },
  down: { x: number; y: number } | null,
  slop = 5,
): boolean {
  if (click.detail > 1) return false;
  if (down && Math.hypot(click.x - down.x, click.y - down.y) > slop) return false;
  return true;
}
