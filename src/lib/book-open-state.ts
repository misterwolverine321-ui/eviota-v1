/** Decide what the reader route shows for a stored book record and file. */
export type BookOpenState = "ready" | "evicted" | "missing";

export function bookOpenState(
  book: { blobEvicted?: boolean } | null | undefined,
  file: Blob | null | undefined,
): BookOpenState {
  if (!book) return "missing";
  if (file) return "ready";
  return book.blobEvicted ? "evicted" : "missing";
}

export type ReattachCheck = { ok: true } | { ok: false; reason: "size" };

/**
 * Is `file` plausibly the file this evicted record was made from?
 *
 * Annotations and progress are anchored to positions inside the original file,
 * so attaching a different file (another edition, a re-saved PDF) would put
 * highlights in the wrong places. Size is a cheap guard that catches the
 * common mistake, picking the wrong file, while accepting the original, which
 * is byte-identical to what was removed. A record with no stored size (very
 * old records) is accepted, since there is nothing to compare against.
 */
export function checkReattach(
  book: { size?: number } | null | undefined,
  file: { size: number },
): ReattachCheck {
  const expected = book?.size;
  if (typeof expected === "number" && expected > 0 && file.size !== expected) {
    return { ok: false, reason: "size" };
  }
  return { ok: true };
}
