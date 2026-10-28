/**
 * Everything above the shelf grid (the hero on an empty shelf, or the "Your shelf" heading, then the
 * stats, the search and sort row, and the index line) only appears once the books have loaded from
 * IndexedDB. Without a reserved height, the grid jumps down when it does: the layout shift was 0.26
 * on an empty first visit and 0.57 on a phone.
 *
 * This keeps, on this device only, how tall that region was the last time it settled, once for a
 * wide screen and once for a narrow one, so the next visit can hold the same space while the books
 * load. It is two numbers under one key. Nothing about the books or the reading is kept.
 */

export const SHELF_TOP_KEY = "eviota-shelf-top-height";

/** The breakpoint where the hero's type grows (Tailwind's `sm:`). */
export const WIDE_SCREEN_QUERY = "(min-width: 640px)";

export interface ShelfTopHeights {
  wide: number;
  narrow: number;
}

/**
 * An empty shelf, the first visit's guess: the hero plus the search and sort row. Measured in
 * checkpoint 25 (hero 414 px on a desktop, 591 px on a phone; the row 86 px and 130 px).
 */
export const SHELF_TOP_DEFAULTS: Readonly<ShelfTopHeights> = { wide: 500, narrow: 721 };

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 2000;

function usable(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_HEIGHT &&
    value <= MAX_HEIGHT
  );
}

/**
 * Reads a stored value. Each height falls back to its own default when it is missing, not a
 * number, or outside a plausible range, so one bad field does not discard the other.
 */
export function parseShelfTopHeights(raw: string | null): ShelfTopHeights {
  const out: ShelfTopHeights = { ...SHELF_TOP_DEFAULTS };
  if (raw === null) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== "object" || parsed === null) return out;
  const { wide, narrow } = parsed as Record<string, unknown>;
  if (usable(wide)) out.wide = Math.round(wide);
  if (usable(narrow)) out.narrow = Math.round(narrow);
  return out;
}

/**
 * The heights with one viewport's value replaced, or `null` when the new height is unusable or
 * already stored. Returning `null` for an unchanged value means a resize does not write storage.
 */
export function withShelfTopHeight(
  current: ShelfTopHeights,
  viewport: "wide" | "narrow",
  height: number,
): ShelfTopHeights | null {
  if (!usable(height)) return null;
  const rounded = Math.round(height);
  if (current[viewport] === rounded) return null;
  return { ...current, [viewport]: rounded };
}

/** This device's stored heights. Storage can be blocked, so any failure gives the defaults. */
export function loadShelfTopHeights(): ShelfTopHeights {
  try {
    return parseShelfTopHeights(window.localStorage.getItem(SHELF_TOP_KEY));
  } catch {
    return { ...SHELF_TOP_DEFAULTS };
  }
}

export function saveShelfTopHeights(heights: ShelfTopHeights): void {
  try {
    window.localStorage.setItem(SHELF_TOP_KEY, JSON.stringify(heights));
  } catch {
    // Storage blocked or full: the next visit uses the defaults. Nothing else depends on this.
  }
}
