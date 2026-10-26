/**
 * Two small things the root route does when the app has mounted.
 *
 * `markAppReady` sets `data-app-ready="1"` on `<html>`. It carries no meaning for the person using
 * the app; it is the one signal the browser tests wait for ("React is live, a click will be heard"),
 * kept apart from anything a feature does so that a refactor of a feature cannot break the tests'
 * idea of "ready" by accident.
 *
 * `benchRequested` says whether the address asks for the benchmark harness (`/?bench`). The harness
 * is developer tooling, so it is loaded only then (see `bench.ts`), not for everyone.
 */

export function markAppReady(doc: Document = document): void {
  doc.documentElement.dataset["appReady"] = "1";
}

/** `search` is `location.search`: the part of the address before the `#` the router uses. */
export function benchRequested(search: string): boolean {
  return new URLSearchParams(search).has("bench");
}
