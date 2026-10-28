/**
 * Dictionary / encyclopedia lookup.
 *
 * Wiktionary's REST definition endpoint first; when the word has no entry we
 * fall back to a Wikipedia summary, which covers names, places and jargon.
 * Both APIs are public, key-free and CORS-enabled. Parsing is pure so it can
 * be unit tested; only `lookupTerm` touches the network and sessionStorage.
 */

export interface LookupSense {
  partOfSpeech?: string;
  definitions: string[];
}

export interface LookupResult {
  term: string;
  source: "wiktionary" | "wikipedia";
  senses: LookupSense[];
  /** Prose summary — Wikipedia only. */
  extract?: string;
  /** Canonical page, for the "Read more" link. */
  url?: string;
}

/** Longest phrase worth looking up. Beyond this it's a passage, not a term. */
const MAX_WORDS = 6;
const CACHE_PREFIX = "nawiri-lookup:";

/**
 * Clean a raw selection into something an API will recognise: strip wrapping
 * punctuation and quotes, collapse whitespace, drop a trailing possessive.
 */
export function normalizeLookupTerm(raw: string): string {
  let term = (raw ?? "").replace(/\s+/g, " ").trim();
  // Unicode-safe outer trim: keep letters, digits and inner hyphens/apostrophes.
  term = term.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
  term = term.replace(/[’']s$/u, "");
  if (!term) return "";
  const words = term.split(" ");
  if (words.length > MAX_WORDS) return "";
  return term;
}

/**
 * Is this a page on a Wikipedia or Wiktionary language site, over https, with no credentials or
 * port? The "Read more" link comes from a server's reply, so it is checked before it is shown.
 */
export function isLookupUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    /^[a-z]+(?:-[a-z]+)*\.(?:wikipedia|wiktionary)\.org$/.test(url.hostname)
  );
}

/** Map a document language (`en-GB`, `pt_BR`, undefined) to a wiki subdomain. */
export function wikiLang(lang?: string | null): string {
  const base = (lang ?? "")
    .replace("_", "-")
    .split("-")[0]
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return base || "en";
}

/** Strip the light HTML Wiktionary embeds in definition strings. */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse `/api/rest_v1/page/definition/<term>`: an object keyed by language
 * code, each holding parts of speech with definition lists.
 */
export function parseWiktionary(payload: unknown, lang = "en"): LookupSense[] {
  if (!payload || typeof payload !== "object") return [];
  const byLang = payload as Record<string, unknown>;
  const entries = Array.isArray(byLang[lang])
    ? (byLang[lang] as unknown[])
    : Array.isArray(byLang["en"])
      ? (byLang["en"] as unknown[])
      : ((Object.values(byLang).find(Array.isArray) as unknown[] | undefined) ?? []);

  const senses: LookupSense[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { partOfSpeech?: unknown; definitions?: unknown };
    const defs: string[] = [];
    if (Array.isArray(row.definitions)) {
      for (const d of row.definitions) {
        const text =
          d && typeof d === "object"
            ? stripHtml(String((d as { definition?: unknown }).definition ?? ""))
            : "";
        if (text) defs.push(text);
      }
    }
    if (!defs.length) continue;
    const pos = typeof row.partOfSpeech === "string" ? row.partOfSpeech : undefined;
    senses.push({ ...(pos ? { partOfSpeech: pos } : {}), definitions: defs.slice(0, 4) });
  }
  return senses.slice(0, 4);
}

/** Parse `/api/rest_v1/page/summary/<term>`. Disambiguation pages are useless. */
export function parseWikipediaSummary(
  payload: unknown,
): { extract: string; url?: string; title?: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as {
    extract?: unknown;
    type?: unknown;
    title?: unknown;
    content_urls?: { desktop?: { page?: unknown } };
  };
  if (row.type === "disambiguation") return null;
  const extract = typeof row.extract === "string" ? row.extract.trim() : "";
  if (!extract) return null;
  const page = row.content_urls?.desktop?.page;
  const url = isLookupUrl(page) ? page : undefined;
  return {
    extract,
    ...(url ? { url } : {}),
    ...(typeof row.title === "string" ? { title: row.title } : {}),
  };
}

function cacheKey(lang: string, term: string): string {
  return `${CACHE_PREFIX}${lang}:${term.toLowerCase()}`;
}

function readCache(lang: string, term: string): LookupResult | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(lang, term));
    return raw ? (JSON.parse(raw) as LookupResult) : null;
  } catch {
    return null;
  }
}

function writeCache(lang: string, term: string, value: LookupResult | null): void {
  try {
    if (value) sessionStorage.setItem(cacheKey(lang, term), JSON.stringify(value));
  } catch {
    /* private mode / quota — lookups just stay uncached */
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Look a term up. Resolves to `null` when neither source knows the word;
 * network failures behave the same way, so the card shows one honest message.
 */
export async function lookupTerm(
  raw: string,
  options: { lang?: string | null; signal?: AbortSignal } = {},
): Promise<LookupResult | null> {
  const term = normalizeLookupTerm(raw);
  if (!term) return null;
  const lang = wikiLang(options.lang);
  const cached = readCache(lang, term);
  if (cached) return cached;

  const slug = encodeURIComponent(term.replace(/ /g, "_"));
  const definition = await getJson(
    `https://${lang}.wiktionary.org/api/rest_v1/page/definition/${slug}`,
    options.signal,
  );
  let senses = parseWiktionary(definition, lang);

  // Wiktionary headwords are usually lowercase; retry once for a capitalised
  // selection before giving up on the dictionary.
  if (!senses.length && /^[\p{Lu}]/u.test(term)) {
    const lower = await getJson(
      `https://${lang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(
        term.toLowerCase().replace(/ /g, "_"),
      )}`,
      options.signal,
    );
    senses = parseWiktionary(lower, lang);
  }

  if (senses.length) {
    const result: LookupResult = {
      term,
      source: "wiktionary",
      senses,
      url: `https://${lang}.wiktionary.org/wiki/${slug}`,
    };
    writeCache(lang, term, result);
    return result;
  }

  const summary = parseWikipediaSummary(
    await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${slug}`, options.signal),
  );
  if (!summary) return null;

  const result: LookupResult = {
    term: summary.title || term,
    source: "wikipedia",
    senses: [],
    extract: summary.extract,
    ...(summary.url ? { url: summary.url } : {}),
  };
  writeCache(lang, term, result);
  return result;
}
