/**
 * Safe local-file mode.
 *
 * A book is untrusted input that the app renders inside iframes. foliate-js
 * (EPUB, MOBI) gives its iframes `allow-same-origin allow-scripts` because
 * WebKit needs the latter for events, and it does not remove inline scripts or
 * event-handler attributes from a section (its source says so). A script that
 * runs there shares this app's origin and could read the whole IndexedDB
 * library. Defence here has two layers:
 *
 *  1. `hardenDocument` removes active content and neutralises every remote
 *     reference in the parsed DOM before the section is ever loaded. This is
 *     plain DOM manipulation, so it is unit-tested directly.
 *  2. `SAFE_CSP` is injected as a `<meta>` policy. Browsers enforce it, which a
 *     unit test cannot show; it is defence in depth, never the only barrier.
 *
 * Nothing is fetched or sent anywhere. Links are not blocked at load time;
 * they are listed, and opening one needs the reader's confirmation.
 */

export type RemoteKind = "image" | "style" | "media" | "frame" | "other";

export interface RemoteRef {
  kind: RemoteKind;
  url: string;
}

export interface BlockedReport {
  /** `<script>` elements removed. */
  scripts: number;
  /** Inline event handlers and `javascript:` URLs removed. */
  handlers: number;
  /** iframe / embed / applet / non-local object elements removed. */
  frames: number;
  /** Remote resources that would have been requested, de-duplicated by URL. */
  remote: RemoteRef[];
  /** External links present in the text (not blocked; confirmed on click). */
  links: string[];
  /** Meta refresh, `<base>`, `ping`, form actions: smaller vectors removed. */
  other: number;
}

export const emptyReport = (): BlockedReport => ({
  scripts: 0,
  handlers: 0,
  frames: 0,
  remote: [],
  links: [],
  other: 0,
});

export function mergeReports(a: BlockedReport, b: BlockedReport): BlockedReport {
  const remote = [...a.remote];
  for (const r of b.remote) if (!remote.some((x) => x.url === r.url)) remote.push(r);
  return {
    scripts: a.scripts + b.scripts,
    handlers: a.handlers + b.handlers,
    frames: a.frames + b.frames,
    remote,
    links: Array.from(new Set([...a.links, ...b.links])),
    other: a.other + b.other,
  };
}

/** The rows of a report that have something in them, in plain words. */
export function removedRows(report: BlockedReport): { label: string; count: number }[] {
  return [
    { label: "Scripts", count: report.scripts },
    { label: "Event handlers and javascript: links", count: report.handlers },
    { label: "Embedded frames and plugins", count: report.frames },
    { label: "Redirects, base URLs, form actions, link pings", count: report.other },
  ].filter((row) => row.count > 0);
}

/** Engines whose documents are markup, so safe mode has something to report. */
export const SAFE_MODE_KINDS: ReadonlySet<string> = new Set(["foliate", "html"]);

/**
 * The shield in the reader's top bar only appears when something was actually
 * removed from this book. A clean book has nothing to report, and the phone's
 * top bar is crowded. (External links are handled by their own confirmation.)
 */
export function showSafeReadingButton(kind: string | undefined, report: BlockedReport): boolean {
  return SAFE_MODE_KINDS.has(kind ?? "") && blockedTotal(report) > 0;
}

/** Everything that was removed or neutralised (links are not counted). */
export const blockedTotal = (r: BlockedReport): number =>
  r.scripts + r.handlers + r.frames + r.remote.length + r.other;

/** Policy for documents that carry no scripts and make no requests. */
export const SAFE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "img-src blob: data:",
  "media-src blob: data:",
  "font-src blob: data:",
  "style-src 'unsafe-inline' blob: data:",
  "frame-src blob:",
  "object-src blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** The same policy as markup, for documents built as strings (`srcDoc`). */
export const CSP_META_HTML = `<meta http-equiv="Content-Security-Policy" content="${SAFE_CSP}">`;

const XHTML_NS = "http://www.w3.org/1999/xhtml";

// ------------------------------------------------------------------- URLs --

/** Browsers ignore ASCII whitespace/control characters inside a URL scheme. */
const squash = (url: string): string => {
  let out = "";
  for (const ch of url) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += ch;
  }
  return out;
};

const schemeOf = (url: string): string | null => {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(squash(url));
  return m ? m[1]!.toLowerCase() : null;
};

const isScriptUrl = (url: string) => {
  const s = schemeOf(url);
  return s === "javascript" || s === "vbscript";
};

/**
 * True when loading this URL would leave the document: any scheme other than
 * `blob:`/`data:` (the book's own resources), or a protocol-relative `//host`.
 */
export function isRemoteUrl(url: string): boolean {
  const u = squash(url);
  if (!u || u.startsWith("#")) return false;
  if (u.startsWith("//") || u.startsWith("\\\\")) return true;
  const s = schemeOf(u);
  return s !== null && s !== "blob" && s !== "data";
}

export type LinkKind = "fragment" | "external" | "ignored";

/** What a clicked link should do. Only http(s), mailto and tel can leave. */
export function classifyLink(href: string): { kind: LinkKind; url?: string; host?: string } {
  const u = href.trim();
  if (u.startsWith("#")) return { kind: "fragment" };
  const s = schemeOf(u);
  if (s === "http" || s === "https") {
    try {
      const parsed = new URL(squash(u));
      return { kind: "external", url: parsed.href, host: parsed.host };
    } catch {
      return { kind: "ignored" };
    }
  }
  if (s === "mailto" || s === "tel") return { kind: "external", url: squash(u), host: s };
  if (u.startsWith("//")) {
    try {
      const parsed = new URL(`https:${squash(u)}`);
      return { kind: "external", url: parsed.href, host: parsed.host };
    } catch {
      return { kind: "ignored" };
    }
  }
  return { kind: "ignored" };
}

// -------------------------------------------------------------------- CSS --

/**
 * Drop remote `@import`s and replace remote `url(...)` references with an
 * empty URL, which no browser requests. `blob:`/`data:`/relative stay.
 */
export function hardenCss(css: string, found: RemoteRef[] = []): string {
  const withoutImports = css.replace(
    /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?[^;{}]*;?/gi,
    (whole, _q, url: string) => {
      if (!isRemoteUrl(url)) return whole;
      found.push({ kind: "style", url });
      return "";
    },
  );
  return withoutImports.replace(/url\(\s*(["']?)([\s\S]*?)\1\s*\)/gi, (whole, _q, url: string) => {
    if (!isRemoteUrl(url)) return whole;
    found.push({ kind: kindForCssUrl(url), url: url.trim() });
    return 'url("")';
  });
}

const CSS_IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|apng|tiff?)$/i;

/**
 * What a `url(...)` inside CSS would have loaded. A background image is an image; a font file,
 * or a reference with no telling extension, stays with stylesheets and fonts.
 */
function kindForCssUrl(url: string): RemoteKind {
  const path = url.trim().split(/[?#]/, 1)[0] ?? "";
  return CSS_IMAGE_EXT.test(path) ? "image" : "style";
}

// -------------------------------------------------------------------- DOM --

const REMOVE_ALWAYS = new Set(["iframe", "frame", "frameset", "embed", "applet", "portal", "base"]);
const MEDIA_TAGS = new Set(["video", "audio", "source", "track"]);
const RESOURCE_ATTRS = ["src", "poster", "data", "background", "lowsrc", "dynsrc", "codebase"];
const SVG_ANIMATE = new Set(["set", "animate", "animatetransform", "animatemotion"]);

function kindFor(tag: string): RemoteKind {
  if (tag === "img" || tag === "image" || tag === "feimage" || tag === "use") return "image";
  if (MEDIA_TAGS.has(tag)) return "media";
  if (tag === "link" || tag === "style") return "style";
  return "other";
}

function push(report: BlockedReport, ref: RemoteRef) {
  if (!report.remote.some((r) => r.url === ref.url)) report.remote.push(ref);
}

/** Harden a parsed document in place and say what was taken out. */
export function hardenDocument(doc: Document): BlockedReport {
  const report = emptyReport();
  const links = new Set<string>();
  const css: RemoteRef[] = [];

  // Elements first, so attribute work below never touches a removed subtree.
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    if (!el.isConnected && el !== doc.documentElement) continue;
    const tag = el.localName.toLowerCase();

    if (tag === "script") {
      el.remove();
      report.scripts++;
      continue;
    }
    if (REMOVE_ALWAYS.has(tag)) {
      el.remove();
      if (tag === "base") report.other++;
      else report.frames++;
      continue;
    }
    if (tag === "object") {
      if (
        !squash(el.getAttribute("data") ?? "")
          .toLowerCase()
          .startsWith("blob:")
      ) {
        el.remove();
        report.frames++;
        continue;
      }
    }
    if (tag === "meta" && /^refresh$/i.test(el.getAttribute("http-equiv") ?? "")) {
      el.remove();
      report.other++;
      continue;
    }
    if (tag === "link") {
      const href = el.getAttribute("href") ?? "";
      const rel = (el.getAttribute("rel") ?? "").toLowerCase();
      const hint = /\b(preload|prefetch|dns-prefetch|preconnect|prerender|modulepreload)\b/.test(
        rel,
      );
      if (hint || isRemoteUrl(href) || isScriptUrl(href)) {
        if (isRemoteUrl(href)) push(report, { kind: "style", url: href.trim() });
        el.remove();
        continue;
      }
    }
    if (SVG_ANIMATE.has(tag)) {
      const target = (el.getAttribute("attributeName") ?? "").toLowerCase();
      if (/^on/.test(target) || /(^|:)href$/.test(target)) {
        el.remove();
        report.handlers++;
        continue;
      }
    }
    if (tag === "style" && el.textContent) {
      const next = hardenCss(el.textContent, css);
      if (next !== el.textContent) el.textContent = next;
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        report.handlers++;
        continue;
      }
      if (name === "style") {
        const next = hardenCss(value, css);
        if (next !== value) el.setAttribute(attr.name, next);
        continue;
      }
      if (name === "ping") {
        el.removeAttribute(attr.name);
        report.other++;
        continue;
      }
      if (name === "action" || name === "formaction") {
        el.removeAttribute(attr.name);
        report.other++;
        continue;
      }
      if (name === "srcset" || name === "imagesrcset") {
        const kept: string[] = [];
        for (const candidate of value.split(",")) {
          const url = candidate.trim().split(/\s+/)[0] ?? "";
          if (!url) continue;
          if (isRemoteUrl(url) || isScriptUrl(url)) push(report, { kind: kindFor(tag), url });
          else kept.push(candidate.trim());
        }
        if (kept.length) el.setAttribute(attr.name, kept.join(", "));
        else el.removeAttribute(attr.name);
        continue;
      }

      const isHref = name === "href" || name === "xlink:href";
      if (isHref && (tag === "a" || tag === "area")) {
        if (isScriptUrl(value)) {
          el.removeAttribute(attr.name);
          report.handlers++;
        } else {
          const link = classifyLink(value);
          if (link.kind === "external" && link.url) links.add(link.url);
          el.setAttribute("rel", "noopener noreferrer");
          el.removeAttribute("target");
        }
        continue;
      }
      if (isHref || RESOURCE_ATTRS.includes(name)) {
        if (isScriptUrl(value)) {
          el.removeAttribute(attr.name);
          report.handlers++;
        } else if (isRemoteUrl(value)) {
          push(report, { kind: kindFor(tag), url: value.trim() });
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  for (const ref of css) push(report, ref);
  report.links = [...links];
  return report;
}

/** Add the CSP `<meta>` to an HTML/XHTML document. SVG and others are skipped. */
export function injectCsp(doc: Document): void {
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== "html") return;
  let head = Array.from(root.children).find((c) => c.localName.toLowerCase() === "head");
  if (!head) {
    head = doc.createElementNS(root.namespaceURI ?? XHTML_NS, "head");
    root.insertBefore(head, root.firstChild);
  }
  const meta = doc.createElementNS(root.namespaceURI ?? XHTML_NS, "meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", SAFE_CSP);
  head.insertBefore(meta, head.firstChild);
}

export interface HardenedMarkup {
  markup: string;
  report: BlockedReport;
  /** The source could not be parsed, so nothing of it was passed through. */
  failed: boolean;
}

/** What a section shows when it cannot be checked. Never the original bytes. */
export const UNCHECKABLE_SECTION =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><p>This section could not be checked for safety, so it was not displayed.</p></body></html>';

const XML_TYPES = new Set([
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
]);

/** Media types foliate hands over that are markup and therefore need hardening. */
export const isMarkupType = (type: string | undefined): boolean => {
  const t = (type ?? "").split(";")[0]!.trim().toLowerCase();
  return t === "text/html" || XML_TYPES.has(t);
};

/**
 * Harden a serialized document. Fails closed: if it cannot be parsed, the
 * original markup is dropped rather than passed through unchecked.
 */
export function hardenMarkup(source: string, mediaType: string): HardenedMarkup {
  const type = mediaType.split(";")[0]!.trim().toLowerCase();
  try {
    const isXml = XML_TYPES.has(type);
    const doc = new DOMParser().parseFromString(
      source,
      (isXml ? type : "text/html") as DOMParserSupportedType,
    );
    if (isXml && doc.getElementsByTagName("parsererror").length) throw new Error("parse error");
    const report = hardenDocument(doc);
    injectCsp(doc);
    const markup = isXml
      ? new XMLSerializer().serializeToString(doc)
      : `<!doctype html>${doc.documentElement.outerHTML}`;
    return { markup, report, failed: false };
  } catch {
    return { markup: UNCHECKABLE_SECTION, report: emptyReport(), failed: true };
  }
}

/**
 * Harden a body fragment (the HTML reader builds its own page shell and only
 * needs the content cleaned).
 */
export function hardenFragment(html: string): { html: string; report: BlockedReport } {
  try {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><body>${html}</body></html>`,
      "text/html",
    );
    const report = hardenDocument(doc);
    return { html: doc.body.innerHTML, report };
  } catch {
    return {
      html: "<p>This page could not be checked for safety, so it was not displayed.</p>",
      report: emptyReport(),
    };
  }
}

/**
 * Harden a whole saved page and return just its body, which is what the HTML
 * reader drops into its own shell. Parsing the full document (rather than
 * cutting out `<body>` with a regex) means scripts in `<head>` are counted too.
 */
export function hardenPage(source: string): { body: string; report: BlockedReport } {
  try {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const report = hardenDocument(doc);
    return { body: doc.body.innerHTML, report };
  } catch {
    return {
      body: "<p>This page could not be checked for safety, so it was not displayed.</p>",
      report: emptyReport(),
    };
  }
}
