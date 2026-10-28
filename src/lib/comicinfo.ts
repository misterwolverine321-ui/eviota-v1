/**
 * ComicInfo.xml metadata + series stacking.
 *
 * Comic archives (CBZ/CBR/CB7) commonly carry a `ComicInfo.xml` sidecar with
 * the series name, issue number and credits. Parsing is pure and string-based
 * (no DOMParser) so it runs in the worker, in a test, or on the server.
 *
 * Grouping is pure too: the shelf hands in its already filtered/sorted list
 * and gets back series stacks plus the loose remainder.
 */

export interface ComicMeta {
  series?: string;
  /** Issue number; may be fractional (e.g. 1.5) in some series. */
  number?: number;
  /** Total issues in the series, when the file declares it. */
  count?: number;
  volume?: string;
  title?: string;
  writer?: string;
  summary?: string;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/** First value of `<Tag>…</Tag>`, trimmed, or "" when absent/empty. */
function tag(xml: string, name: string): string {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = re.exec(xml);
  if (!m) return "";
  return decodeEntities(m[1] ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const num = (v: string): number | undefined => {
  if (!v) return undefined;
  const m = /-?\d+(?:\.\d+)?/.exec(v.replace(",", "."));
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Parse a ComicInfo.xml document. Unknown or missing fields are simply left
 * out, so a partial sidecar still contributes what it has.
 */
export function parseComicInfo(xml: string): ComicMeta {
  if (!xml || !/<ComicInfo/i.test(xml)) return {};
  const meta: ComicMeta = {};
  const series = tag(xml, "Series");
  if (series) meta.series = series;
  const number = num(tag(xml, "Number"));
  if (number !== undefined) meta.number = number;
  const count = num(tag(xml, "Count"));
  if (count !== undefined) meta.count = count;
  const volume = tag(xml, "Volume");
  if (volume) meta.volume = volume;
  const title = tag(xml, "Title");
  if (title) meta.title = title;
  const writer = tag(xml, "Writer") || tag(xml, "Penciller");
  if (writer) meta.writer = writer;
  const summary = tag(xml, "Summary");
  if (summary) meta.summary = summary;
  return meta;
}

/**
 * Series name guessed from a file name when there is no sidecar, e.g.
 * "Saga 012 (2013).cbz" → { series: "Saga", number: 12 }.
 */
export function seriesFromFileName(fileName: string): ComicMeta {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(.*?)[\s-]+#?(\d{1,4})(?:\.(\d))?$/.exec(base);
  if (!m) return {};
  const series = m[1].replace(/[\s-]+$/, "").trim();
  if (!series) return {};
  const number = Number(m[3] ? `${Number(m[2])}.${m[3]}` : String(Number(m[2])));
  return { series, number: Number.isFinite(number) ? number : undefined };
}

/** Case/spacing-insensitive identity for a series name. */
export const seriesKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface SeriesStack<T> {
  key: string;
  /** Display name, taken from the first book in the stack. */
  name: string;
  issues: T[];
}

/**
 * Split a shelf into series stacks (2+ issues sharing a series) and the loose
 * books. Issues are ordered by issue number, then title; stacks keep the order
 * in which their first issue appeared in the input, so the caller's sort still
 * drives the page.
 */
export function groupBySeries<T extends { series?: string; seriesIndex?: number; title: string }>(
  books: T[],
): { stacks: SeriesStack<T>[]; loose: T[] } {
  const byKey = new Map<string, SeriesStack<T>>();
  const order: string[] = [];
  const loose: T[] = [];

  for (const book of books) {
    const name = (book.series ?? "").trim();
    const key = name ? seriesKey(name) : "";
    if (!key) {
      loose.push(book);
      continue;
    }
    let stack = byKey.get(key);
    if (!stack) {
      stack = { key, name, issues: [] };
      byKey.set(key, stack);
      order.push(key);
    }
    stack.issues.push(book);
  }

  const stacks: SeriesStack<T>[] = [];
  for (const key of order) {
    const stack = byKey.get(key)!;
    if (stack.issues.length < 2) {
      loose.push(...stack.issues);
      continue;
    }
    stack.issues.sort(
      (a, b) =>
        (a.seriesIndex ?? Number.POSITIVE_INFINITY) - (b.seriesIndex ?? Number.POSITIVE_INFINITY) ||
        a.title.localeCompare(b.title),
    );
    stacks.push(stack);
  }
  return { stacks, loose };
}

/** Label for one issue, e.g. "#12" or the plain title when unnumbered. */
export const issueLabel = (book: { seriesIndex?: number; title: string }) =>
  book.seriesIndex === undefined ? book.title : `#${book.seriesIndex}`;

// ------------------------------------------------------- archive extraction --

const COMIC_EXT = /\.(cbz|cbr|cb7|cbt|zip)$/i;

/** True when this file name looks like a comic archive worth probing. */
export const isComicArchive = (fileName: string) => COMIC_EXT.test(fileName);

/**
 * Read `ComicInfo.xml` out of a zip-based comic archive (CBZ). Returns `{}`
 * for RAR/7z archives or when the sidecar is missing — the shelf then falls
 * back to the file name. Only the sidecar is inflated, never the pages.
 */
export async function readComicInfo(file: Blob, fileName: string): Promise<ComicMeta> {
  if (!isComicArchive(fileName)) return {};
  try {
    const { unzip } = await import("fflate");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const xml = await new Promise<string>((resolve, reject) => {
      unzip(bytes, { filter: (f) => /(^|\/)comicinfo\.xml$/i.test(f.name) }, (err, files) => {
        if (err) return reject(err);
        const entry = Object.values(files ?? {})[0];
        if (!entry || !entry.length) return resolve("");
        resolve(new TextDecoder().decode(entry));
      });
    });
    return xml ? parseComicInfo(xml) : {};
  } catch {
    return {};
  }
}

/** Sidecar metadata when present, otherwise a file-name guess. */
export async function comicSeriesMeta(file: Blob, fileName: string): Promise<ComicMeta> {
  const meta = await readComicInfo(file, fileName);
  if (meta.series) return meta;
  const guess = seriesFromFileName(fileName);
  return { ...meta, ...guess };
}
