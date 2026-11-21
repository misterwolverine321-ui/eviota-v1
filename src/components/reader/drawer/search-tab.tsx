import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { ReaderTheme, SearchHit, SearchRun } from "@/lib/reader-settings";
import { MAX_HITS } from "@/lib/search";
import type { IndexStatus } from "@/lib/search-index";
import { cn } from "@/lib/utils";
import { EmptyState } from "../ui";

const DEBOUNCE_MS = 150;

/**
 * Search tab: in-book full-text search.
 *
 * Typing runs a debounced pass; Enter / Shift+Enter step through the hit list;
 * the match-case and whole-word toggles persist in reader settings and travel
 * with the run so the persisted index and live engines agree.
 */
export function SearchTab({
  theme,
  onSearch,
  onClearSearch,
  onJumpHit,
  matchCase,
  wholeWord,
  onMatchOptions,
  indexStatus,
  indexProgress,
  indexKind,
  initialQuery,
  takeDeepHit,
}: {
  theme: ReaderTheme;
  onSearch: (query: string, run: SearchRun) => Promise<void>;
  onClearSearch: () => void;
  onJumpHit: (hit: SearchHit) => void;
  matchCase: boolean;
  wholeWord: boolean;
  onMatchOptions: (patch: { matchCase?: boolean; wholeWord?: boolean }) => void;
  /** When "building", results come from a live pass until the index lands. */
  indexStatus?: IndexStatus;
  /** 0..1 build fraction while the index is being built. */
  indexProgress?: number;
  /** What is being built — an OCR build is minutes, so it gets a louder bar. */
  indexKind?: "text" | "ocr";
  /** Deep-linked query (?q=): seeds the input and runs once on mount. */
  initialQuery?: string;
  /**
   * Called once, when the first search has finished: the page (or section) and offset of the match
   * the reader was opened from, or null. If the results hold a hit at that place it is selected and
   * the reader is taken to it, with the mark a click on it would leave.
   */
  takeDeepHit?: () => { page: number; at: number } | null;
}) {
  const [query, setQuery] = useState(() => initialQuery?.trim() ?? "");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [progress, setProgress] = useState(1);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The shell hands these down as fresh arrow functions on every render, and it renders whenever
  // the reading position moves. If the search depended on their identity it would run again (and
  // wipe the mark a jump had just left on the page, and the hit list with it) each time the reader
  // scrolled. The search reads the latest of them when it runs, and depends only on what changes it.
  const onSearchRef = useRef(onSearch);
  const onClearSearchRef = useRef(onClearSearch);
  const onJumpHitRef = useRef(onJumpHit);
  const takeDeepHitRef = useRef(takeDeepHit);
  onSearchRef.current = onSearch;
  onClearSearchRef.current = onClearSearch;
  onJumpHitRef.current = onJumpHit;
  takeDeepHitRef.current = takeDeepHit;

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const run = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      abortRef.current?.abort();
      onClearSearchRef.current();
      if (q.length < 2) {
        setHits([]);
        setRan(false);
        setRunning(false);
        setActiveIndex(-1);
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setHits([]);
      setActiveIndex(-1);
      setProgress(0);
      setRunning(true);
      setRan(true);
      let collected: SearchHit[] = [];
      try {
        await onSearchRef.current(q, {
          signal: controller.signal,
          options: { matchCase, wholeWord },
          onProgress: (f) => {
            if (!controller.signal.aborted) setProgress(f);
          },
          onHits: (batch) => {
            if (controller.signal.aborted || !batch.length) return;
            collected = collected.concat(batch).slice(0, MAX_HITS);
            setHits(collected);
          },
        });
      } catch {
        /* engine gave up — treated as "no results" */
      }
      if (!controller.signal.aborted) {
        setProgress(1);
        setRunning(false);
        const want = takeDeepHitRef.current?.();
        if (want) {
          const at = collected.findIndex(
            (h) =>
              h.target.kind === "page" &&
              h.target.page === want.page &&
              h.target.offset === want.at,
          );
          if (at >= 0) {
            setActiveIndex(at);
            onJumpHitRef.current(collected[at]!);
          }
        }
      }
    },
    [matchCase, wholeWord],
  );

  // Debounced typing + immediate re-run when a match toggle flips.
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, matchCase, wholeWord, run]);

  const step = (delta: number) => {
    if (!hits.length) return;
    const next = (activeIndex + delta + hits.length * 2) % hits.length;
    setActiveIndex(next);
    onJumpHit(hits[next]);
  };

  const clear = () => {
    abortRef.current?.abort();
    onClearSearch();
    setQuery("");
    setHits([]);
    setRan(false);
    setRunning(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const toggleClass = (on: boolean) =>
    cn(
      "h-6 rounded-[3px] px-2 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors pointer-coarse:h-11 pointer-coarse:min-w-11",
      on ? "bg-signal text-signal-foreground" : "hover:bg-foreground/5",
    );

  return (
    <div>
      {/* A named search landmark: a screen reader can jump to it, and the form has a name in every
          engine (an unnamed form is not exposed as a form in every browser). */}
      <form
        role="search"
        aria-label="Search in book"
        onSubmit={(e) => e.preventDefault()}
        className="flex items-center gap-2 rounded-[3px] border px-2"
        style={{ borderColor: theme.line }}
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin opacity-60" />
        ) : (
          <Search className="h-3.5 w-3.5 opacity-50" />
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }}
          placeholder="Search in book"
          autoFocus
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-40 pointer-coarse:h-11"
          aria-label="Search in book"
        />
        {(query || ran) && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-foreground/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onMatchOptions({ matchCase: !matchCase })}
          aria-pressed={matchCase}
          title="Match case"
          className={toggleClass(matchCase)}
          style={matchCase ? undefined : { color: theme.sub }}
        >
          <span aria-hidden="true">Aa</span>
          <span className="sr-only">Match case</span>
        </button>
        <button
          type="button"
          onClick={() => onMatchOptions({ wholeWord: !wholeWord })}
          aria-pressed={wholeWord}
          title="Whole word"
          className={toggleClass(wholeWord)}
          style={wholeWord ? undefined : { color: theme.sub }}
        >
          <span aria-hidden="true">Ab|</span>
          <span className="sr-only">Whole word</span>
        </button>
        {ran && (
          <>
            <span
              aria-hidden="true"
              className="ml-auto font-mono text-[11px] tracking-[0.16em] uppercase"
              style={{ color: theme.sub }}
            >
              {hits.length === 0
                ? running
                  ? "Searching…"
                  : "0 results"
                : `${activeIndex >= 0 ? activeIndex + 1 : 0}/${hits.length}${
                    hits.length >= MAX_HITS ? "+" : ""
                  }`}
            </span>
            {/* One sentence per outcome, not the stream of counts the matches arrive in. */}
            <span role="status" className="sr-only">
              {running
                ? "Searching"
                : hits.length === 0
                  ? "No results"
                  : activeIndex >= 0
                    ? `Result ${activeIndex + 1} of ${hits.length}${hits.length >= MAX_HITS ? " or more" : ""}`
                    : `${hits.length}${hits.length >= MAX_HITS ? " or more" : ""} results`}
            </span>
          </>
        )}
      </div>

      {indexStatus === "building" && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((indexProgress ?? 0) * 100)}
          aria-label={indexKind === "ocr" ? "Recognizing text" : "Building search index"}
          className="mt-2"
        >
          <div className="h-[2px] w-full overflow-hidden" style={{ background: theme.line }}>
            <div
              className="bg-signal h-full transition-[width] duration-300"
              style={{ width: `${Math.round((indexProgress ?? 0) * 100)}%` }}
            />
          </div>
          <div
            className="mt-1 font-mono text-[11px] tracking-[0.16em] uppercase"
            style={{ color: theme.sub }}
          >
            {indexKind === "ocr"
              ? `Recognizing text… ${Math.round((indexProgress ?? 0) * 100)}%`
              : "Indexing for faster search…"}
          </div>
        </div>
      )}

      {running && (
        <div className="mt-2 h-[2px] w-full overflow-hidden" style={{ background: theme.line }}>
          <div
            className="bg-signal h-full transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}

      {!ran && (
        <EmptyState>
          Type to search this book. Enter and Shift+Enter step through matches.
        </EmptyState>
      )}
      {ran && !running && hits.length === 0 && (
        <EmptyState>No matches for “{query.trim()}”.</EmptyState>
      )}

      <ul className="mt-2 space-y-1" aria-label={hits.length ? "Search results" : undefined}>
        {hits.map((hit, i) => (
          <li key={hit.id}>
            <button
              type="button"
              onClick={() => {
                setActiveIndex(i);
                onJumpHit(hit);
              }}
              aria-current={activeIndex === i ? "true" : undefined}
              className={`w-full rounded-[3px] px-2 py-2 text-left transition-colors hover:bg-foreground/5 ${
                activeIndex === i ? "bg-foreground/5" : ""
              }`}
            >
              {hit.label && (
                <span
                  className="mb-1 block truncate font-mono text-[11px] tracking-[0.16em] uppercase"
                  style={{ color: theme.sub }}
                >
                  {hit.label}
                </span>
              )}
              <span className="block text-xs leading-relaxed">
                <span style={{ color: theme.sub }}>{hit.excerpt.pre}</span>
                <mark
                  className="rounded-[2px] px-[1px]"
                  style={{ background: "var(--reader-hit)", color: theme.ink }}
                >
                  {hit.excerpt.match}
                </mark>
                <span style={{ color: theme.sub }}>{hit.excerpt.post}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
