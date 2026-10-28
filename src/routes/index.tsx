import { assetUrl } from "@/lib/asset-url";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Upload, Library, BookOpen, Settings } from "lucide-react";
import { toast } from "sonner";
import { BookCard } from "@/components/library/book-card";
import { CollectionsSidebar } from "@/components/library/collections-sidebar";
import { StatsStrip, useSessions } from "@/components/library/stats-strip";
import { useObjectUrl } from "@/hooks/use-object-url";
import { deleteBook, listBooks, type BookRecord } from "@/lib/db";
import { importFiles, type ImportPending } from "@/lib/import-books";
import { ImportingCard } from "@/components/library/importing-card";
import { SeriesCard } from "@/components/library/series-card";
import { groupBySeries } from "@/lib/comicinfo";
import { InstallBanner } from "@/components/library/install-banner";
import { ThemeToggle } from "@/components/theme-control";

import { ACCEPT_STRING, FORMATS, FORMAT_STRIP_ORDER } from "@/lib/formats";
import { hitOffset, hitPage, searchLibrary, type LibraryBookResult } from "@/lib/library-search";
import { indexShelfHeadless, type ShelfIndexStatus } from "@/lib/headless-index";
import { SAMPLE_BOOKS } from "@/lib/samples";
import { missingSamples, shelfState } from "@/lib/first-run";
import {
  loadShelfTopHeights,
  saveShelfTopHeights,
  WIDE_SCREEN_QUERY,
  withShelfTopHeight,
  type ShelfTopHeights,
} from "@/lib/shelf-top-height";
import {
  allTags,
  bookStatus,
  collectionBooks,
  createCollection,
  deleteCollection as removeCollection,
  filterBooks,
  listCollections,
  setBookTags,
  toggleBookInCollection,
  type BookStatus,
  type Collection,
} from "@/lib/collections";
import { estimateRemainingMinutes, type ReadingSession } from "@/lib/sessions";
import { requestPersistence } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { EviotaLogo } from "@/components/brand/logo";
import { useSettledValue } from "@/hooks/use-settled-value";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Eviota — Read every e-book format in your browser" },
      {
        name: "description",
        content:
          "Your books stay on this device. Eviota is an offline-first reading room for EPUB, PDF, MOBI, AZW3, FB2, CBZ, CBR, TXT, RTF and HTML.",
      },
      { property: "og:title", content: "Eviota — Your browser reading room" },
      {
        property: "og:description",
        content:
          "Import EPUB, PDF, MOBI, comics and more. Beautiful typography, saved progress, fully offline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

type SortKey = "recent" | "added" | "title" | "author";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "added", label: "Added" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
];

function LibraryPage() {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Everything above the shelf grid (the hero or "Your shelf", the stats, the search and sort, and
  // the index line) is drawn once the books and sessions have loaded. Until then it is an empty box
  // of the height it had on the last visit on this device, so the grid does not jump (see
  // src/lib/shelf-top-height.ts). Read once, at mount: the reserve is what this visit starts with.
  const shelfTopRef = useRef<HTMLDivElement>(null);
  const [shelfTop] = useState<ShelfTopHeights>(loadShelfTopHeights);
  const shelfTopStyle = {
    "--shelf-top-narrow": `${shelfTop.narrow}px`,
    "--shelf-top-wide": `${shelfTop.wide}px`,
  } as CSSProperties;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [busy, setBusy] = useState(false);
  /** Files mid-ingest: real cards with covers + loader, ahead of the DB write. */
  const [pending, setPending] = useState<ImportPending[]>([]);

  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Phase 7.2 — collections + tag filters, composed with search and sort.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // Phase 7.4 — derived reading-status facet.
  const [activeStatus, setActiveStatus] = useState<BookStatus | null>(null);
  // Phase 7.1 — sessions drive the stats strip and per-book time estimates.
  const { sessions, ready: sessionsReady } = useSessions();
  const regionReady = loaded && sessionsReady;

  const refresh = useCallback(async () => {
    setBooks(await listBooks());
    setCollections(await listCollections());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Once the region has been drawn, record its height for this screen width. The next visit reserves
  // that height while the books load. Only a change writes storage.
  useEffect(() => {
    const el = shelfTopRef.current;
    if (!regionReady || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const viewport = window.matchMedia(WIDE_SCREEN_QUERY).matches ? "wide" : "narrow";
      const next = withShelfTopHeight(loadShelfTopHeights(), viewport, el.offsetHeight);
      if (next) saveShelfTopHeights(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [regionReady]);

  // Comics added before cover extraction shipped show a blank card. Repair them
  // once in the background, patching each card in place as its cover lands.
  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const { backfillCovers } = await import("@/lib/cover-backfill");
      await backfillCovers({
        signal: controller.signal,
        onCover: (book) => {
          if (cancelled) return;
          setBooks((prev) => prev.map((b) => (b.id === book.id ? { ...b, ...book } : b)));
        },
      });
    })().catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Runs once per mount, after the first load.
  }, [loaded]);

  const ingest = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy(true);
      try {
        // §10.3: ask once, on the first import, so the browser stops evicting.
        void requestPersistence();
        const res = await importFiles(files, {
          onQueued: (rows) => setPending(rows),
          onMeta: (row) => setPending((prev) => prev.map((p) => (p.key === row.key ? row : p))),
          onSettled: (key) => setPending((prev) => prev.filter((p) => p.key !== key)),
        });
        await refresh();
        if (res.added.length)
          toast.success(`Added ${res.added.length} ${res.added.length === 1 ? "book" : "books"}`);
        if (res.skipped.length) toast(`${res.skipped.length} already on your shelf`);
        const refused = [...res.failed, ...res.rejected.map((r) => `${r.name} (${r.reason})`)];
        if (refused.length) toast.error(`Couldn't read: ${refused.join(", ")}`);
      } finally {
        setPending([]);
        setBusy(false);
      }
    },
    [refresh],
  );

  const loadSamples = useCallback(async () => {
    setBusy(true);
    try {
      const wanted = missingSamples(await listBooks(), SAMPLE_BOOKS);
      const settled = await Promise.allSettled(
        wanted.map(async (s) => {
          const res = await fetch(assetUrl(s.url));
          if (!res.ok) throw new Error(s.fileName);
          const blob = await res.blob();
          return new File([blob], s.fileName, { type: "application/epub+zip" });
        }),
      );
      const files = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (files.length < wanted.length) toast.error("Some sample books couldn't be loaded");
      await ingest(files);
    } catch {
      toast.error("Couldn't load the sample shelf");
    } finally {
      setBusy(false);
    }
  }, [ingest]);

  const onDelete = useCallback(
    async (id: string) => {
      await deleteBook(id);
      await refresh();
      toast("Removed from shelf");
    },
    [refresh],
  );

  const continueBook = useMemo(() => {
    const opened = books.filter((b) => b.lastOpenedAt);
    if (!opened.length) return null;
    return opened.reduce((a, b) => ((b.lastOpenedAt ?? 0) > (a.lastOpenedAt ?? 0) ? b : a));
  }, [books]);

  const collection = useMemo(
    () => collections.find((c) => c.id === activeCollection) ?? null,
    [collections, activeCollection],
  );

  const tags = useMemo(() => allTags(books), [books]);
  const samplesLeft = useMemo(() => missingSamples(books, SAMPLE_BOOKS).length, [books]);
  const clearFilters = useCallback(() => {
    setQuery("");
    setActiveCollection(null);
    setActiveTags([]);
    setActiveStatus(null);
  }, []);

  const visible = useMemo(() => {
    const scoped = filterBooks(books, {
      collection,
      tags: activeTags,
      status: activeStatus,
    });
    const q = query.trim().toLowerCase();
    const filtered = q
      ? scoped.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q) ||
            b.format.includes(q),
        )
      : scoped.slice();
    filtered.sort((a, b) => {
      switch (sort) {
        case "title":
          return a.title.localeCompare(b.title);
        case "author":
          return a.author.localeCompare(b.author);
        case "added":
          return b.addedAt - a.addedAt;
        default:
          return (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt);
      }
    });
    return filtered;
  }, [books, collection, activeTags, activeStatus, query, sort]);

  // Phase 15.3 — comics of the same series collapse into one stack on the
  // shelf; opening a stack drills into its issues.
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const { stacks, loose } = useMemo(() => groupBySeries(visible), [visible]);
  const state = shelfState({
    loaded,
    total: books.length,
    visible: visible.length,
    pending: pending.length,
  });
  const openStack = useMemo(
    () => stacks.find((s) => s.key === openSeries) ?? null,
    [stacks, openSeries],
  );
  const filtering =
    query.trim() !== "" || activeCollection !== null || activeTags.length > 0 || !!activeStatus;
  const filterSummary = useSettledValue(
    filtering && visible.length > 0 ? `${visible.length} of ${books.length} books shown` : "",
    700,
  );
  useEffect(() => {
    if (openSeries && !stacks.some((s) => s.key === openSeries)) setOpenSeries(null);
  }, [stacks, openSeries]);

  /** Trailing-rate estimate of minutes left, per book id (§10.1). */
  const remaining = useMemo(() => {
    const byBook = new Map<string, ReadingSession[]>();
    for (const session of sessions) {
      const rows = byBook.get(session.bookId) ?? [];
      rows.push(session);
      byBook.set(session.bookId, rows);
    }
    const out: Record<string, number | null> = {};
    for (const book of books) {
      out[book.id] = estimateRemainingMinutes(
        byBook.get(book.id) ?? [],
        book.progress?.fraction ?? 0,
      );
    }
    return out;
  }, [books, sessions]);

  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of collections) {
      counts[c.id] = collectionBooks(c, books).length;
    }
    return counts;
  }, [collections, books]);

  const statusCounts = useMemo(() => {
    const counts: Record<BookStatus, number> = { unread: 0, reading: 0, finished: 0 };
    for (const book of books) counts[bookStatus(book)] += 1;
    return counts;
  }, [books]);

  const onCreateCollection = useCallback(async (name: string) => {
    const created = await createCollection(name);
    setCollections(await listCollections());
    setActiveCollection(created.id);
  }, []);

  const onDeleteCollection = useCallback(async (id: string) => {
    await removeCollection(id);
    setActiveCollection((cur) => (cur === id ? null : cur));
    setCollections(await listCollections());
    toast("Collection removed");
  }, []);

  const onDropBook = useCallback(async (collectionId: string, bookId: string) => {
    const next = await toggleBookInCollection(collectionId, bookId);
    setCollections(await listCollections());
    if (next) {
      toast(next.bookIds.includes(bookId) ? "Filed" : "Removed from collection");
    }
  }, []);

  const onTagsChange = useCallback(async (id: string, next: string[]) => {
    await setBookTags(id, next);
    setBooks(await listBooks());
  }, []);

  // ---- cross-book search over the persisted per-book indexes (§6.1) ----
  const [insideResults, setInsideResults] = useState<LibraryBookResult[]>([]);
  const [insideBusy, setInsideBusy] = useState(false);

  // Books that have never been opened are indexed in the background (checkpoint 17), so a search
  // reaches them too. Keyed by the ids, so a tag or a title change does not start the work again.
  const [indexStatus, setIndexStatus] = useState<ShelfIndexStatus | null>(null);
  const booksKey = books.map((b) => b.id).join("|");
  useEffect(() => {
    if (!booksKey) return undefined;
    const controller = new AbortController();
    void indexShelfHeadless(books, {
      signal: controller.signal,
      onStatus: setIndexStatus,
    }).catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booksKey]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !books.length) {
      setInsideResults([]);
      setInsideBusy(false);
      return undefined;
    }
    const controller = new AbortController();
    setInsideBusy(true);
    const t = setTimeout(() => {
      searchLibrary(q, books, { signal: controller.signal })
        .then((res) => {
          if (!controller.signal.aborted) setInsideResults(res);
        })
        .catch(() => {
          if (!controller.signal.aborted) setInsideResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setInsideBusy(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query, books]);

  return (
    <div
      className="min-h-screen bg-background"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        ingest(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_STRING}
        className="hidden"
        onChange={(e) => {
          ingest(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6 py-4">
          <Link to="/" className="flex items-end gap-2.5 text-foreground">
            <EviotaLogo className="h-6 w-auto sm:h-7" />
            {/* mb-1 puts the label on the wordmark's baseline at the sm:h-7 size
                (JetBrains Mono: 1.54px baseline inset + 4px = 20% of 28px).
                Hidden on phones, where the logo and the buttons need the room. */}
            <span className="mb-1 hidden font-mono text-[11px] leading-none tracking-[0.24em] text-signal-ink uppercase sm:block">
              Reader
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              to="/settings"
              aria-label="Settings"
              className="inline-flex items-center gap-2 rounded-[3px] border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              aria-label="Add books"
              className="inline-flex items-center gap-2 rounded-[3px] bg-foreground px-3 py-2 sm:px-4 text-xs font-medium tracking-wide text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden min-[360px]:inline">Add books</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <InstallBanner />
        <div
          ref={shelfTopRef}
          style={regionReady ? undefined : shelfTopStyle}
          className={cn(!regionReady && "h-[var(--shelf-top-narrow)] sm:h-[var(--shelf-top-wide)]")}
        >
          {regionReady && (
            <>
              {/* Hero */}
              {(continueBook || books.length === 0) && (
                <section className="anim-rise border-b border-border py-14">
                  {continueBook ? (
                    <ContinueHero book={continueBook} />
                  ) : (
                    <div className="max-w-2xl">
                      <p className="font-mono text-[11px] tracking-[0.24em] text-muted-foreground uppercase">
                        Offline · Private · In-browser
                      </p>
                      <h1 className="font-display mt-4 text-5xl leading-[1.05] font-semibold tracking-[-0.03em] sm:text-6xl">
                        Every book you own,
                        <br />
                        <span className="text-signal-ink">in one quiet shelf.</span>
                      </h1>
                      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                        Your books stay on this device. Drop in EPUB, PDF, MOBI, AZW3, FB2, comics,
                        plain text or saved web pages and Eviota reads them right here.
                      </p>
                      <div className="mt-8 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => inputRef.current?.click()}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-[3px] bg-signal px-5 py-2.5 text-sm font-medium text-signal-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <Upload className="h-4 w-4" /> Add books
                        </button>
                        {samplesLeft > 0 && (
                          <button
                            type="button"
                            onClick={loadSamples}
                            disabled={busy || !loaded}
                            className="inline-flex items-center gap-2 rounded-[3px] border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
                          >
                            <Library className="h-4 w-4" />
                            {samplesLeft === SAMPLE_BOOKS.length
                              ? "Try three sample books"
                              : "Add the other sample books"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {books.length > 0 && (
                <section className="border-b border-border py-8">
                  <h1 className="font-display text-2xl font-semibold">Your shelf</h1>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {books.length} {books.length === 1 ? "book" : "books"}
                  </p>
                </section>
              )}

              {/* Reading stats (§10.1) */}
              <StatsStrip sessions={sessions} />

              {/* Controls */}
              <section className="flex flex-wrap items-center justify-between gap-4 py-6">
                <div className="relative w-full max-w-xs">
                  <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search shelf"
                    aria-label="Search shelf"
                    className="w-full rounded-[3px] border border-input bg-card py-2 pr-3 pl-9 text-sm outline-none focus:border-foreground/40"
                  />
                </div>
                <div className="flex items-center gap-1" role="group" aria-label="Sort shelf">
                  <span
                    aria-hidden="true"
                    className="mr-2 hidden font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase min-[360px]:inline"
                  >
                    Sort
                  </span>
                  {SORTS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSort(s.key)}
                      aria-pressed={sort === s.key}
                      className={cn(
                        "rounded-[3px] px-1.5 py-1.5 text-xs transition-colors min-[360px]:px-2.5",
                        sort === s.key
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Held from the first book, so the grid below does not move when the status arrives. */}
              {books.length > 0 && (
                <IndexLine status={indexStatus && indexStatus.eligible > 0 ? indexStatus : null} />
              )}
            </>
          )}
        </div>

        {/* Inside-book results */}
        {query.trim().length >= 2 && (
          <InsideBooks
            results={insideResults}
            searching={insideBusy}
            query={query}
            status={indexStatus}
          />
        )}

        {/* Shelf */}
        <h2 className="sr-only">Books</h2>
        {/* How many books a search or filter left, spoken once the typing has paused. */}
        <p role="status" className="sr-only">
          {filterSummary}
        </p>
        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          <CollectionsSidebar
            collections={collections}
            activeId={activeCollection}
            counts={collectionCounts}
            totalBooks={books.length}
            tags={tags}
            activeTags={activeTags}
            onSelect={setActiveCollection}
            onCreate={onCreateCollection}
            onDelete={onDeleteCollection}
            onDropBook={onDropBook}
            onToggleTag={(tag) =>
              setActiveTags((cur) =>
                cur.some((t) => t.toLowerCase() === tag.toLowerCase())
                  ? cur.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                  : [...cur, tag],
              )
            }
            onClearTags={() => setActiveTags([])}
            activeStatus={activeStatus}
            statusCounts={statusCounts}
            onSelectStatus={setActiveStatus}
          />

          <div className="min-w-0 flex-1">
            {state === "loading" ? (
              <div
                className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4"
                aria-busy="true"
              >
                <span role="status" className="sr-only">
                  Loading your shelf
                </span>
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="aspect-[2/3] rounded-[3px] bg-secondary" />
                    <div className="mt-3 h-3 w-3/4 rounded bg-secondary" />
                    <div className="mt-2 h-2.5 w-1/2 rounded bg-secondary" />
                  </div>
                ))}
              </div>
            ) : state === "empty" ? (
              <div className="border border-dashed border-border px-6 py-16 text-center sm:py-24">
                <BookOpen className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <h2 className="font-display mt-4 text-lg font-semibold">Your shelf is empty</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  Drop your books anywhere on this page to add them to your shelf.
                </p>
              </div>
            ) : state === "filtered-empty" ? (
              <div
                className="border border-dashed border-border px-6 py-16 text-center"
                role="status"
              >
                <Search className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <p className="mt-4 text-sm text-muted-foreground">Nothing on your shelf matches.</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-5 rounded-[3px] border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-secondary"
                >
                  Clear search and filters
                </button>
              </div>
            ) : openStack ? (
              <div>
                <div className="mb-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setOpenSeries(null)}
                    className="rounded-[3px] border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
                  >
                    ← All books
                  </button>
                  <h2 className="font-display text-lg font-semibold tracking-tight">
                    {openStack.name}
                  </h2>
                  <span className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    {openStack.issues.length} issues
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
                  {openStack.issues.map((b, i) => (
                    <BookCard
                      key={b.id}
                      book={b}
                      index={i}
                      onDelete={onDelete}
                      remainingMinutes={remaining[b.id] ?? null}
                      onTagsChange={onTagsChange}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
                {pending.map((p, i) => (
                  <ImportingCard key={p.key} pending={p} index={i} />
                ))}
                {stacks.map((s, i) => (
                  <SeriesCard key={s.key} stack={s} index={i} onOpen={setOpenSeries} />
                ))}
                {loose.map((b, i) => (
                  <BookCard
                    key={b.id}
                    book={b}
                    index={stacks.length + i}
                    onDelete={onDelete}
                    remainingMinutes={remaining[b.id] ?? null}
                    onTagsChange={onTagsChange}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Format strip */}
        <section className="mt-24 border-t border-border pt-8">
          <p className="font-mono text-[11px] tracking-[0.24em] text-muted-foreground uppercase">
            Supported formats
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
            {FORMAT_STRIP_ORDER.map((ext) => {
              const f = FORMATS[ext];
              if (!f) return null;
              return (
                <span
                  key={ext}
                  title={f.blurb}
                  className="font-mono text-xs tracking-[0.12em] text-foreground/70 uppercase"
                >
                  {f.label}
                </span>
              );
            })}
          </div>
        </section>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-[3px] border-2 border-dashed border-signal-ink px-10 py-8 text-center">
            <p className="font-display text-2xl font-semibold">Drop to import</p>
            <p className="mt-1 text-xs text-muted-foreground">
              EPUB · PDF · MOBI · CBZ · TXT and more
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Cross-book hits (§6.1): while the shelf filter narrows by metadata, this
 * section shows matches *inside* indexed books and deep-links each snippet
 * straight into the reader's search drawer.
 */
/** What the shelf's index line says, in words. */
function indexLineText(status: ShelfIndexStatus): string {
  const done = status.ready + status.failed >= status.eligible;
  const books = status.eligible === 1 ? "book or document" : "books and documents";
  const failed = status.failed ? `, ${status.failed} could not be read` : "";
  return `Shelf search: ${status.ready} of ${status.eligible} ${books} indexed${failed}${done ? "" : "…"}`;
}

/**
 * The index line: visible, with its progress spoken once it has settled. With no status yet, or
 * nothing to index, the row is still there (a non-breaking space), so its height never changes.
 */
function IndexLine({ status }: { status: ShelfIndexStatus | null }) {
  const text = status ? indexLineText(status) : "";
  const spoken = useSettledValue(text, 1200);
  return (
    <>
      <p
        aria-hidden="true"
        className="min-h-[calc(2lh+1rem)] pb-4 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase sm:min-h-0"
      >
        {text || " "}
      </p>
      <span role="status" className="sr-only">
        {spoken}
      </span>
    </>
  );
}

function InsideBooks({
  results,
  searching,
  query,
  status,
}: {
  results: LibraryBookResult[];
  searching: boolean;
  query: string;
  status: ShelfIndexStatus | null;
}) {
  if (!results.length) {
    if (searching) {
      return (
        <p className="pb-6 font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          Searching your books…
        </p>
      );
    }
    // Say what was searched, so an empty result is not read as "not in your books".
    const indexed = status ? status.ready : 0;
    const eligible = status ? status.eligible : 0;
    const scope =
      eligible > 0
        ? `No matches for \u201c${query.trim()}\u201d in ${indexed} of ${eligible} indexed books and documents.${
            eligible > indexed + (status?.failed ?? 0) ? " Some are still being indexed." : ""
          } `
        : "";
    return (
      <p className="pb-6 text-xs leading-relaxed text-muted-foreground">
        {scope}Comic and DjVu books are searched inside their reader only.
      </p>
    );
  }
  const q = query.trim();
  return (
    <section className="mb-8 border border-border">
      <p className="border-b border-border px-4 py-3 font-mono text-[11px] tracking-[0.24em] text-muted-foreground uppercase">
        In your books
      </p>
      <ul className="divide-y divide-border">
        {results.map((book) => (
          <li key={book.bookId} className="px-4 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{book.title}</p>
                <p className="truncate text-xs text-muted-foreground">{book.author}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                {book.total} {book.total === 1 ? "match" : "matches"}
              </span>
            </div>
            <div className="mt-3 space-y-1">
              {book.hits.map((hit) => (
                <Link
                  key={hit.id}
                  to="/read/$id"
                  params={{ id: book.bookId }}
                  search={{ q, page: hitPage(hit) ?? undefined, at: hitOffset(hit) ?? undefined }}
                  className="block rounded-[3px] px-2 py-1.5 text-xs leading-relaxed transition-colors hover:bg-secondary"
                >
                  {hit.label && (
                    <span className="mb-0.5 block truncate font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                      {hit.label}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {hit.excerpt.pre}
                    <mark className="rounded-[2px] bg-signal/20 px-[1px] text-foreground">
                      {hit.excerpt.match}
                    </mark>
                    {hit.excerpt.post}
                  </span>
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContinueHero({ book }: { book: BookRecord }) {
  const coverUrl = useObjectUrl(book.cover ?? null);
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => setCoverFailed(false), [coverUrl]);
  const pct = Math.round((book.progress?.fraction ?? 0) * 100);

  return (
    <div className="flex flex-col gap-8 sm:flex-row sm:items-end">
      <Link
        to="/read/$id"
        params={{ id: book.id }}
        className="cover-shadow block w-32 shrink-0 overflow-hidden rounded-[3px] bg-secondary sm:w-40"
      >
        {coverUrl && !coverFailed ? (
          <img
            src={coverUrl}
            alt={`Cover of ${book.title}`}
            className="aspect-[2/3] h-full w-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center border border-border bg-card">
            <span className="font-display text-3xl">{book.title.slice(0, 1)}</span>
          </div>
        )}
      </Link>
      <div className="min-w-0">
        <p className="font-mono text-[11px] tracking-[0.24em] text-signal-ink uppercase">
          Continue reading
        </p>
        <h1 className="font-display mt-3 text-4xl leading-tight font-semibold tracking-[-0.02em] sm:text-5xl">
          {book.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{book.author}</p>
        <div className="mt-5 flex items-center gap-4">
          <div className="h-px w-40 bg-border">
            <div className="h-px bg-signal" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">{pct}%</span>
        </div>
        <Link
          to="/read/$id"
          params={{ id: book.id }}
          className="mt-7 inline-flex items-center gap-2 rounded-[3px] bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85"
        >
          <BookOpen className="h-4 w-4" />
          Resume
        </Link>
      </div>
    </div>
  );
}
