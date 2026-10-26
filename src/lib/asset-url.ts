/**
 * Resolve a path under the app's `public/` folder to an absolute URL.
 *
 * Eviota is a static app that can be hosted anywhere: a GitHub Pages project
 * site (`user.github.io/eviota/`), a user site, a custom domain, or a plain
 * folder served by any static server. A root-absolute path such as
 * "/vendor/x.js" only works in the last two, so every runtime reference to a
 * public file goes through here and is resolved against the document's own
 * location. The router uses hash URLs (`#/read/abc`), so the document path
 * never changes while the reader navigates and this stays correct.
 *
 * Web Workers must not call this with a bare relative path: inside a worker,
 * relative URLs resolve against the worker script (in `assets/`), not the
 * page. Resolve here on the main thread and pass the absolute URL in.
 */
export function assetUrl(path: string, base?: string): string {
  const root =
    base ??
    (typeof document !== "undefined" && document.baseURI ? document.baseURI : "http://localhost/");
  return new URL(path.replace(/^\/+/, ""), root).href;
}
