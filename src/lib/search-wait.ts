/**
 * Waiting for a book's search index to be built.
 *
 * Most readers can search the open book themselves ("live search"), so while the index is still
 * being built a query is answered by them. A DjVu scan and a comic have no such search: their text
 * comes only from the index (the scan's text layer, or OCR). A query typed before the index is
 * ready has nothing to ask, and used to come back with "No results" that stayed on screen. It waits
 * for the build instead.
 */

/** Resolves when `signal` aborts (at once if it already has). */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Resolves when the build `current()` names has finished, failed or been given up, or when `signal`
 * aborts. If a newer build replaces it while waiting (the reader declared new capabilities and the
 * index restarted), that one is waited for too, up to `maxBuilds` in all. Never rejects.
 */
export async function waitForIndexBuild(
  current: () => Promise<unknown> | null,
  signal: AbortSignal,
  maxBuilds = 3,
): Promise<void> {
  for (let i = 0; i < maxBuilds && !signal.aborted; i++) {
    const build = current();
    if (!build) return;
    await Promise.race([build.then(undefined, () => undefined), aborted(signal)]);
    if (current() === build) return;
  }
}
