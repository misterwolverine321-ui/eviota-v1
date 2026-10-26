/**
 * First-run helpers for the library: which bundled sample books are still
 * missing from the shelf, and which onboarding state to show.
 * Pure — no IndexedDB or DOM — so the unit tests drive it directly.
 */
import type { SampleBook } from "./samples";

export type ShelfState = "loading" | "empty" | "filtered-empty" | "ready";

/** Samples whose file name is not already on the shelf (case-insensitive). */
export function missingSamples(
  books: ReadonlyArray<{ fileName: string }>,
  samples: ReadonlyArray<SampleBook>,
): SampleBook[] {
  const have = new Set(books.map((b) => b.fileName.toLowerCase()));
  return samples.filter((s) => !have.has(s.fileName.toLowerCase()));
}

/** What the shelf area should render. */
export function shelfState(input: {
  loaded: boolean;
  total: number;
  visible: number;
  pending: number;
}): ShelfState {
  if (!input.loaded) return "loading";
  if (input.visible > 0 || input.pending > 0) return "ready";
  return input.total === 0 ? "empty" : "filtered-empty";
}
