#!/usr/bin/env node
/**
 * Checks that `dist/` is a self-contained static site that works from any
 * hosting path. It only reads and reports; it never writes claims anywhere.
 *
 *   npm run build && npm run verify:static
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const failures = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
};
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const exists = (rel) => existsSync(join(DIST, rel));
const read = (rel) => readFileSync(join(DIST, rel), "utf8");

if (!exists("index.html")) {
  console.error("dist/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}

// ---- index.html -----------------------------------------------------------
console.log("index.html");
const html = read("index.html");
const local = [...html.matchAll(/\s(?:href|src)="([^"#]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u)); // drop https:, data:, //cdn
check(local.length > 0, `references ${local.length} local files`);
const absolute = local.filter((u) => u.startsWith("/"));
check(
  absolute.length === 0,
  `no root-absolute URLs${absolute.length ? ": " + absolute.join(", ") : ""}`,
);
for (const u of local) check(exists(u.replace(/^\.\//, "")), `exists: ${u}`);
check(!html.includes("<!--theme-boot-->"), "theme boot marker was replaced");
check(
  /<script>\(function\(\)\{try\{var c=localStorage/.test(html),
  "theme boot script is inline in <head>",
);
check(
  html.indexOf('name="theme-color"') < html.indexOf("localStorage"),
  "theme-color meta comes before the boot script",
);
check(
  /<meta name="referrer" content="no-referrer"\s*\/?>/.test(html),
  "a no-referrer policy is set (a request the app makes does not name the page it came from)",
);

// ---- nothing is fetched from another host at start-up -----------------------------
// The interface fonts used to come from Google on every visit. A page that names another
// host in a link, script, preconnect or stylesheet import tells that host who opened the app.
console.log("outside hosts");
const outsideRefs = [...html.matchAll(/\s(?:href|src)="((?:https?:)?\/\/[^"]+)"/gi)].map(
  (m) => m[1],
);
check(
  outsideRefs.length === 0,
  `index.html loads nothing from another host${outsideRefs.length ? ": " + outsideRefs.join(", ") : ""}`,
);
const cssOutside = readdirSync(join(DIST, "assets"))
  .filter((f) => f.endsWith(".css"))
  .flatMap((f) =>
    [
      ...read(`assets/${f}`).matchAll(
        /(?:@import\s+(?:url\()?|url\()\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi,
      ),
    ].map((m) => `${f}: ${m[1]}`),
  );
check(
  cssOutside.length === 0,
  `no stylesheet imports or loads anything from another host${cssOutside.length ? ": " + cssOutside.join(", ") : ""}`,
);

// ---- manifest -------------------------------------------------------------
console.log("manifest");
const manifest = JSON.parse(read("manifest.webmanifest"));
check(!manifest.start_url.startsWith("/"), `start_url is relative (${manifest.start_url})`);
check(!manifest.scope.startsWith("/"), `scope is relative (${manifest.scope})`);
for (const icon of manifest.icons) {
  check(!icon.src.startsWith("/") && exists(icon.src), `icon exists and is relative: ${icon.src}`);
}

// ---- notices ----------------------------------------------------------------
// MIT, BSD, Apache and OFL all ask that the notices travel with what is distributed.
console.log("notices");
check(
  exists("THIRD_PARTY_NOTICES.txt") &&
    read("THIRD_PARTY_NOTICES.txt").includes("PART 3 - npm PACKAGES"),
  "THIRD_PARTY_NOTICES.txt is part of the built site",
);

// ---- no copyleft text ships without being looked at ------------------------------
// DjVu.js (GNU General Public License, Version 2) was removed from the site in checkpoint 14 because
// it could not sit next to the Apache-2.0 parts. A file in the built site that names a copyleft
// licence in words, other than the notices file (which quotes them), has to be looked at by a
// person: add its entry to scripts/make-notices.mjs and ask the owner. Only text files are read, and
// only the licence's name in words is looked for, so binary data and base64 cannot trip it.
console.log("copyleft");
const TEXT = new Set([".js", ".css", ".html", ".json", ".txt", ".webmanifest", ".svg", ".map"]);
const COPYLEFT = /general public licen[sc]e|mozilla public licen[sc]e|\bDjVu\.js\b/i;
const walk = (dir) =>
  readdirSync(join(DIST, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const named = walk("")
  .filter((f) => TEXT.has(extname(f)) && f !== "THIRD_PARTY_NOTICES.txt")
  .filter((f) => COPYLEFT.test(read(f)));
check(
  named.length === 0,
  `no shipped file names a copyleft licence${named.length ? ": " + named.join(", ") : ""}`,
);
check(!exists("vendor/djvu"), "the DjVu.js bundle is not in the site");

// ---- service worker -------------------------------------------------------
console.log("service worker");
const sw = read("sw.js");
const precache = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
check(precache.length > 0, `precaches ${precache.length} files`);
check(precache.includes("index.html"), "index.html is precached (it is the whole offline shell)");
const fallback = sw.match(/createHandlerBoundToURL\("([^"]+)"\)/)?.[1];
check(fallback !== undefined, `navigation fallback is bound to "${fallback}"`);
// Workbox throws `non-precached-url` at startup if this is not true.
check(
  precache.includes(fallback),
  "the fallback target is in the precache (otherwise the worker fails to start)",
);
// A runtime-caching rule is usually a regular expression, which the minifier keeps with its
// escapes (`/^https:\/\/fonts\.googleapis\.com\/.*\/`), so the backslashes are dropped before looking.
// Only an address written with its scheme is found; a bare hostname test is not.
const swOutside = [
  ...new Set([...sw.replace(/\\/g, "").matchAll(/https?:\/\/[^"'`\s)]+/g)].map((m) => m[0])),
];
check(
  swOutside.length === 0,
  `the service worker names no other host${swOutside.length ? ": " + swOutside.join(", ") : ""}`,
);
const missing = precache.filter((u) => !exists(u));
check(
  missing.length === 0,
  `every precached file exists${missing.length ? ": " + missing.join(", ") : ""}`,
);

// ---- served from a sub-path, the way GitHub Pages serves a project site ----
console.log("served under /some/sub/path/");
const PREFIX = "/some/sub/path/";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".epub": "application/epub+zip",
  ".wasm": "application/wasm",
};
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (!path.startsWith(PREFIX)) {
    res.writeHead(404).end("not found");
    return;
  }
  const rel = normalize(path.slice(PREFIX.length) || "index.html").replace(/^(\.\.[/\\])+/, "");
  const file = join(DIST, rel.endsWith("/") ? rel + "index.html" : rel);
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res
    .writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" })
    .end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
try {
  const page = await fetch(base);
  check(page.status === 200, `GET ${PREFIX} -> ${page.status}`);
  const urls = new Set(local.map((u) => new URL(u, base).href));
  for (const u of precache) urls.add(new URL(u, base).href);
  let bad = 0;
  for (const u of urls) {
    const r = await fetch(u);
    if (r.status !== 200) {
      bad++;
      fail(`GET ${u.replace(base, PREFIX)} -> ${r.status}`);
    }
  }
  if (!bad) ok(`all ${urls.size} referenced and precached URLs return 200 under the sub-path`);
  const root = await fetch(new URL("/", base));
  check(
    root.status === 404,
    "nothing is expected at the server root (proves URLs are not root-absolute)",
  );
} finally {
  server.close();
}

console.log(
  failures.length ? `\n${failures.length} check(s) FAILED` : "\nAll static-site checks passed.",
);
process.exit(failures.length ? 1 : 0);
