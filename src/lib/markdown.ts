import { marked } from "marked";
import type { TocItem } from "./reader-settings";

/**
 * Markdown as a first-class format.
 *
 * Markdown reuses the HTML engine rather than adding a sixth renderer: we
 * convert to HTML here, give every heading a stable id so the Contents tab can
 * link to it, and sanitize the result. The reader iframe is already sandboxed
 * without `allow-scripts`, so sanitizing is defence in depth rather than the
 * only line of defence.
 */

export interface MarkdownDoc {
  html: string;
  /** YAML front-matter values we recognize, used as import metadata. */
  meta: { title?: string; author?: string };
}

const FRONT_MATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Pull a leading `--- ... ---` block off the source and parse simple keys. */
export function splitFrontMatter(src: string): { body: string; meta: MarkdownDoc["meta"] } {
  const m = FRONT_MATTER.exec(src);
  if (!m) return { body: src, meta: {} };
  const meta: MarkdownDoc["meta"] = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z_-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].replace(/^["']|["']$/g, "");
    if (key === "title") meta.title = value;
    else if (key === "author" || key === "authors") meta.author = value;
  }
  return { body: src.slice(m[0].length), meta };
}

/** Slugify a heading into a stable, unique anchor id. */
export function slugify(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

const VOID_SAFE = /^(script|style|iframe|object|embed|link|meta|form|input|button)$/i;

/**
 * Strip active content from generated HTML: dangerous elements, inline event
 * handlers, and `javascript:` URLs. Everything else is preserved.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*([a-z0-9-]+)([^>]*)>/gi, (tag, name: string, attrs: string) => {
      if (VOID_SAFE.test(name)) return "";
      const safeAttrs = attrs
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s+(href|src|xlink:href)\s*=\s*("|')?\s*javascript:[^"'>\s]*("|')?/gi, "");
      return `<${tag.startsWith("</") ? "/" : ""}${name}${safeAttrs}>`.replace(/^<\/\//, "</");
    });
}

/** Convert Markdown source to sanitized HTML with anchored headings. */
export function markdownToHtml(src: string): MarkdownDoc {
  const { body, meta } = splitFrontMatter(src);
  const used = new Set<string>();
  const renderer = new marked.Renderer();
  const baseHeading = renderer.heading.bind(renderer);
  renderer.heading = (token) => {
    const html = baseHeading(token);
    const id = slugify(token.text ?? "", used);
    return html.replace(/^<h([1-6])/, `<h$1 id="${id}" data-eviota-heading="1"`);
  };

  const raw = marked.parse(body, {
    async: false,
    gfm: true,
    breaks: false,
    renderer,
  }) as string;

  return { html: sanitizeHtml(raw), meta };
}

export function isMarkdownFile(fileName: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(fileName);
}

/**
 * Give every h1–h3 in an HTML document a stable id and a `data-eviota-heading`
 * marker, and derive a two-level TOC from them.
 *
 * Markdown converted by `markdownToHtml` already carries both; running this
 * over it is idempotent and yields the same navigation tree for `.md` and
 * plain `.html`, so the Contents tab behaves identically for either.
 */
export function annotateHeadings(html: string): { html: string; toc: TocItem[] } {
  const used = new Set<string>();
  const toc: TocItem[] = [];

  const out = html.replace(
    /<h([1-3])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi,
    (full, lvlRaw: string, attrsRaw: string, inner: string) => {
      const text = inner
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return full;

      let attrs = attrsRaw;
      const existing = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs);
      let id: string;
      if (existing) {
        id = existing[1];
        used.add(id);
      } else {
        id = slugify(text, used);
        attrs = `${attrs} id="${id}"`;
      }
      if (!/\bdata-eviota-heading\b/.test(attrs)) {
        attrs = `${attrs} data-eviota-heading="${lvlRaw}"`;
      }

      const item: TocItem = { label: text, href: `#${id}` };
      const parent = toc[toc.length - 1];
      if (lvlRaw === "1" || !parent) toc.push(item);
      else (parent.subitems ??= []).push(item);

      return `<h${lvlRaw}${attrs}>${inner}</h${lvlRaw}>`;
    },
  );

  return { html: out, toc };
}
