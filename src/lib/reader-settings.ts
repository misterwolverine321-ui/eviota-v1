import { resolveReaderTheme } from "./reader-theme-resolve";
import type { AnnotationAnchor } from "./annotations";
import type { MatchOptions } from "./search";

export type ReaderThemeId = "match" | "paper" | "sepia" | "dusk";

export interface ReaderTheme {
  id: ReaderThemeId;
  label: string;
  bg: string;
  ink: string;
  sub: string;
  line: string;
}

/** Reading-surface themes. The app chrome follows the active theme. */
export const READER_THEMES: ReaderTheme[] = [
  {
    id: "match",
    label: "Match app",
    bg: "#FDFDFD",
    ink: "#1A1A1A",
    sub: "#737373",
    line: "#E7E7E7",
  },
  { id: "paper", label: "Paper", bg: "#FDFDFD", ink: "#1A1A1A", sub: "#737373", line: "#E7E7E7" },
  { id: "sepia", label: "Sepia", bg: "#F4F1EA", ink: "#3B332A", sub: "#746853", line: "#E2D9C8" },
  { id: "dusk", label: "Dusk", bg: "#131313", ink: "#D9D9D9", sub: "#8A8A8A", line: "#2A2A2A" },
];

/** The single app red; reads the theme token so reader and chrome match. */
export const SIGNAL = "var(--signal)";

export interface ReaderSettings {
  theme: ReaderThemeId;
  fontFamily: "serif" | "sans";
  fontSize: number; // px
  lineHeight: number;
  maxWidth: number; // px column width
  flow: "paginated" | "scrolled";
  pdfScale: "fit" | number;
  spread: boolean; // comic two-page spread
  /** Night mode for scans: invert + contrast curve on the page canvas. */
  /** null = automatic (follows the reading theme); true/false = the reader's explicit choice. */
  pdfInvert: boolean | null;
  /** Saved-settings format. 1 (or absent) stored `false` as the default "off"; 2 uses null for auto. */
  settingsSchema: number;
  /** Auto-trim whitespace margins on paged renders. */
  pdfCrop: boolean;
  /** Search: case-sensitive matching. */
  matchCase: boolean;
  /** Search: require word boundaries around matches. */
  wholeWord: boolean;
  /** Comics: page fit strategy. */
  comicFit: ComicFit;
  /** Comics: right-to-left (manga) reading order. */
  manga: boolean;
  /** Comics: cut wide double-page scans into two panels. */
  splitSpreads: boolean;
  /** Image pipeline: brightness percentage (100 = untouched). */
  brightness: number;
  /** Image pipeline: contrast percentage (100 = untouched). */
  contrast: number;
  /** Image pipeline: unsharp amount, 0..100 (0 = off). */
  sharpen: number;
  /** Phase 15: resample pages at the zoomed size so text stays crisp. */
  enhance: boolean;
  /** Phase 15: unsharp strength applied after an upscale, 0..100. */
  enhanceAmount: number;
  /** Phase 15.4: comics — step through detected panels instead of whole pages. */
  guidedView: boolean;
  /** Reflowable text: paragraph alignment. */
  textAlign: "start" | "justify";
  /** Reflowable text: automatic hyphenation (pairs with justified text). */
  hyphenate: boolean;
  /** Reflowable text: letter spacing in hundredths of an em (-2..8). */
  letterSpacing: number;
  /** Reflowable text: space between paragraphs, in tenths of an em (0..20). */
  paragraphSpacing: number;
  /** Reflowable text: first-line indent on paragraphs. */
  paragraphIndent: boolean;
  /** Read-aloud speech rate, 0.75..2 (see `lib/tts`). */
  ttsRate: number;
  /** Preferred platform voice name, or null to follow the document language. */
  ttsVoice: string | null;
  /** Auto-scroll speed in CSS pixels per second (see `hooks/use-auto-scroll`). */
  autoScrollSpeed: number;
}

/** Comic page fit strategies. `smart` picks per-panel by aspect ratio. */
export type ComicFit = "width" | "height" | "screen" | "original" | "smart";

export const COMIC_FITS: ComicFit[] = ["smart", "screen", "width", "height", "original"];

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "match",
  fontFamily: "serif",
  fontSize: 19,
  lineHeight: 1.7,
  maxWidth: 680,
  flow: "paginated",
  pdfScale: "fit",
  spread: false,
  pdfInvert: null,
  settingsSchema: 2,
  pdfCrop: false,
  matchCase: false,
  wholeWord: false,
  comicFit: "smart",
  manga: false,
  splitSpreads: false,
  brightness: 100,
  contrast: 100,
  sharpen: 0,
  enhance: true,
  enhanceAmount: 45,
  guidedView: false,
  textAlign: "start",
  hyphenate: true,
  letterSpacing: 0,
  paragraphSpacing: 0,
  paragraphIndent: true,
  ttsRate: 1,
  ttsVoice: null,
  autoScrollSpeed: 40,
};

const KEY = "nawiri-reader-settings";
export const SETTINGS_SCHEMA = 2;

/**
 * Bring saved settings up to the current format. Pure, so it can be tested
 * without storage. Schema 1 stored `pdfInvert: false` as the *default*, so on
 * the first load of an old save it means "auto", not "the reader turned it
 * off". From schema 2 on, `false` is an explicit choice and must be kept.
 */
export function migrateSettings(saved: Partial<ReaderSettings>): Partial<ReaderSettings> {
  const out = { ...saved };
  if ((out.settingsSchema ?? 1) < 2 && out.pdfInvert === false) out.pdfInvert = null;
  out.settingsSchema = SETTINGS_SCHEMA;
  return out;
}

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<ReaderSettings>;
    return { ...DEFAULT_SETTINGS, ...migrateSettings(saved) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ReaderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/**
 * Resolves "match" against the app appearance; see `reader-theme-resolve`.
 *
 * The returned theme is always the RESOLVED one: its `id` is "paper", "sepia"
 * or "dusk", never "match". Engines branch on that id (the EPUB engine tints
 * highlights and inverts fixed-layout pages when it is "dusk"), so returning
 * id "match" here would silently switch those off for the default theme in a
 * dark app. Only the theme *picker* (READER_THEMES) lists "match".
 */
export function getTheme(id: ReaderThemeId, app: "light" | "dark" = "light"): ReaderTheme {
  const rid = resolveReaderTheme(id, app);
  return READER_THEMES.find((x) => x.id === rid) ?? READER_THEMES.find((x) => x.id === "paper")!;
}

export const FONT_STACKS = {
  serif: `'Lora Variable', 'Lora', 'Charter', 'Georgia', serif`,
  sans: `'Inter Variable', 'Inter', 'Helvetica Neue', sans-serif`,
};

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

/**
 * One entry of a keyword index (the Index drawer tab; no engine supplies one at the moment). A keyword can point at several
 * topics, and can nest subkeywords.
 */
export interface KeywordEntry {
  keyword: string;
  targets: { label: string; href: string }[];
  subitems?: KeywordEntry[];
}

/**
 * Where a search hit lives, in whatever coordinate system the engine speaks.
 * The kernel never interprets these — it hands them back to `goToHit`.
 */
export type SearchTarget =
  | { kind: "cfi"; cfi: string }
  /** `offset` is a character offset into the unit's indexed text, when known. */
  | { kind: "page"; page: number; offset?: number }
  /** `offset` is a character offset into that block's whitespace-collapsed text, when known. */
  | { kind: "node"; index: number; offset?: number };

export interface SearchHit {
  /** Stable per-query id, used as a React key. */
  id: string;
  excerpt: { pre: string; match: string; post: string };
  /** Chapter / page label for the hit list. */
  label?: string;
  target: SearchTarget;
}

/** Streaming search run: hits arrive incrementally, progress is 0..1. */
export interface SearchRun {
  signal: AbortSignal;
  /** Matching mode, so live engines and the persisted index agree. */
  options?: MatchOptions;
  onHits: (hits: SearchHit[]) => void;
  onProgress: (fraction: number) => void;
}

export interface NavApi {
  next: () => void;
  prev: () => void;
  goTo?: (href: string) => void;
  goToFraction?: (fraction: number) => void;
  goToPage?: (page: number) => void;
  /** Jump to an annotation anchor (Phase 2). */
  goToAnchor?: (anchor: AnnotationAnchor) => void;
  /** Anchor for the current location, used for bookmarks. */
  currentAnchor?: () => AnnotationAnchor | null;
  /** In-book full-text search (Phase 3). Resolves when the pass is done. */
  search?: (query: string, run: SearchRun) => Promise<void>;
  /** Drop any in-page search highlighting. */
  clearSearch?: () => void;
  /** Navigate to a hit produced by `search`. */
  goToHit?: (hit: SearchHit) => void;
  /**
   * Normalized plain text for one page (Phase 4.1 index). Engines that own a
   * text layer expose this so the kernel can build a persisted search index
   * without re-implementing extraction.
   */
  extractPageText?: (page: number) => Promise<string>;
  /**
   * Text of one unit for the persisted search index, when that differs from `extractPageText`.
   * Read-aloud also calls `extractPageText`, and a continuous document is one unit to it; the index
   * wants the document cut into smaller units. The shell prefers this when an engine has it.
   */
  extractIndexText?: (unit: number) => Promise<string>;
  /**
   * False while the engine shows a view the persisted index does not describe (the HTML reader's
   * extracted article). The shell then searches live instead.
   */
  indexUsable?: () => boolean;
  /**
   * Human label for an indexable unit (a section, chapter …) so index-backed
   * hits read "Installing widgets" instead of "Page 7".
   */
  unitLabel?: (page: number) => string;

  /**
   * Render a page preview (Phase 4 thumbnails). Returns a data URL, or null
   * when the page can't be rendered. Engines cache their own results.
   */
  renderThumbnail?: (page: number, width: number) => Promise<string | null>;

  /**
   * Phase 12: nudge the reading surface by `pixels` with no animation, so the
   * auto-scroll drive can move the page a fraction of a line at a time.
   * Paginated engines accumulate the pixels and turn the page when a screenful
   * has gone by.
   */
  scrollByPixels?: (pixels: number) => void;

  /**
   * Phase 12: paint the sentence currently being read aloud, or clear the
   * painted sentence when passed `null`. Engines resolve the sentence inside
   * whichever document they own (scroll container, iframe, foliate section).
   */
  highlightSpoken?: (text: string | null) => void;
}

export interface ProgressUpdate {
  fraction: number;
  cfi?: string;
  page?: number;
  totalPages?: number;
  label?: string;
}

/**
 * The capability contract between an engine and the reader kernel.
 *
 * The shell renders a control ONLY when the active engine declares the
 * matching capability. Engines never touch persistence or chrome — they
 * report what they can do and emit anchors/progress; the kernel does the rest.
 */
export interface RendererCaps {
  /** Navigation tree, when the format carries one. */
  toc?: TocItem[];
  /** Discrete pages (vs continuous scroll) — drives the bottom bar shape. */
  paged?: boolean;
  /** Honors fontFamily / fontSize / lineHeight / maxWidth. */
  typography?: boolean;
  /** Honors paginated vs scrolled flow. */
  flowControl?: boolean;
  /** Anchor model for annotations, or false when unsupported. */
  annotations?: "cfi" | "page-rect" | "text" | false;
  /** In-book full-text search is available. */
  search?: boolean;
  /** Page management (rotate / reorder / delete / extract). */
  pageOps?: boolean;
  /** Brightness / contrast / sharpen pipeline (scans & comics). */
  imageAdjust?: boolean;
  /** Two-page spread toggle. */
  spread?: boolean;
  /** Right-to-left reading order (manga). */
  rtl?: boolean;
  /**
   * Text-to-speech read-aloud. Requires `NavApi.extractPageText`, since the
   * driver speaks whatever the engine can hand over as plain text.
   */
  tts?: boolean;
  /**
   * Hands-free auto-scroll. Requires `NavApi.scrollByPixels`.
   */
  autoScroll?: boolean;
  /**
   * Document language (BCP-47-ish, e.g. `en`, `fr-CA`) when the format carries
   * it. Picks the default speech voice and the dictionary wiki.
   */
  language?: string | null;

  /** OCR pass available for image-only pages. */
  ocr?: boolean;
  /** Continuous zoom control. */
  zoom?: boolean;
  /** `NavApi.renderThumbnail` is implemented (Phase 4 thumbnail rail). */
  thumbnails?: boolean;

  /**
   * Phase 6.1: the engine decodes raw bytes and accepts a charset override.
   * `label` is what was used, `detected` what sniffing chose on its own.
   */
  encoding?: { label: string; detected: string; confidence: number };

  /**
   * Number of extractable text units (foliate sections), for engines that can
   * feed the persisted search index without exposing pageable navigation.
   */
  indexUnits?: number;

  /**
   * For engines that cut the text into index units themselves (plain text, HTML): a value that
   * changes when that text changes (another encoding chosen, say). An index built from other text is
   * rebuilt, and never searched, instead of trusted.
   */
  indexKey?: string;

  /** Total pages, when known — enables the Pages drawer. */
  pageCount?: number;

  /**
   * Phase 6.2: the engine extracted an article body and can render a clean
   * reading view. Gates the Display tab's "Reading view" control.
   */
  cleanView?: boolean;

  /** Keyword index — gates the Index drawer tab (no engine supplies one at the moment). */
  keywords?: KeywordEntry[];

  /** The document carries fillable form fields — gates the Form drawer tab. */
  forms?: boolean;
}

/** Right-drawer tabs. One drawer, many tabs — panels never stack. */
export type DrawerTab = "toc" | "index" | "notes" | "search" | "display" | "pages" | "forms";

/** Which drawer tabs the active engine actually supports. No dead buttons. */
export function availableTabs(caps: RendererCaps): DrawerTab[] {
  const tabs: DrawerTab[] = [];
  if ((caps.toc?.length ?? 0) > 0) tabs.push("toc");
  if ((caps.keywords?.length ?? 0) > 0) tabs.push("index");
  if (caps.annotations) tabs.push("notes");
  if (caps.search) tabs.push("search");
  if (caps.forms) tabs.push("forms");
  tabs.push("display");
  if ((caps.pageCount ?? 0) > 1) tabs.push("pages");
  return tabs;
}
