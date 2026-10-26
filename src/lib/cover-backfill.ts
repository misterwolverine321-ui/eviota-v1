/**
 * Cover backfill.
 *
 * Comic covers are extracted at import time, but comics added before that
 * landed sit on the shelf as blank cards. This walks the library once, pulls
 * the first page out of each cover-less comic archive already stored in
 * IndexedDB, and patches the record in place — ids, progress and annotations
 * are untouched.
 *
 * Runs one book at a time (archive inflation is CPU heavy) and reports each
 * repaired book so the shelf can refresh without a reload.
 */

import { getBookFile, listBooks, patchBook, type BookRecord } from "./db";
import { getFormatInfo } from "./formats";

/** A library record that should get a cover and can still be read. */
export function needsCoverBackfill(book: BookRecord): boolean {
  if (book.hasCover || book.cover) return false;
  if (book.blobEvicted) return false;
  return getFormatInfo(book.fileName)?.kind === "comic";
}

export interface BackfillOptions {
  /** Called after each record is repaired, with the updated book. */
  onCover?: (book: BookRecord) => void;
  /** Stop early (e.g. the page unmounted). */
  signal?: AbortSignal;
}

/**
 * Backfill covers for every comic on the shelf that lacks one.
 * Returns the number of covers written.
 */
export async function backfillCovers(options: BackfillOptions = {}): Promise<number> {
  const { onCover, signal } = options;
  const targets = (await listBooks()).filter(needsCoverBackfill);
  if (!targets.length) return 0;

  const { extractComicCover } = await import("./comic-cover");
  let repaired = 0;

  for (const book of targets) {
    if (signal?.aborted) break;
    try {
      const file = await getBookFile(book.id);
      if (!file) continue;
      const cover = await extractComicCover(file);
      if (!cover || !cover.size) continue;
      await patchBook(book.id, { cover, hasCover: true });
      repaired += 1;
      onCover?.({ ...book, cover, hasCover: true });
    } catch (err) {
      console.warn("cover backfill failed", book.fileName, err);
    }
  }

  return repaired;
}
