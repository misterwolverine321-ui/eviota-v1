import { useEffect, useRef, useState } from "react";
import { Download, FileOutput, RotateCw, Scissors, Trash2, Plus } from "lucide-react";
import type { ReaderTheme } from "@/lib/reader-settings";
import { cn } from "@/lib/utils";

export interface PageOpsApi {
  rotate: (page: number) => void;
  remove: (page: number) => void;
  move: (from: number, to: number) => void;
  extract: (page: number) => void;
  splitAt: (page: number) => void;
  merge: (files: File[]) => void;
  exportFlattened: () => void;
  busy: boolean;
}

const THUMB_WIDTH = 150;

/**
 * Pages tab: rendered thumbnails with page jump, drag-to-reorder and page ops.
 * Thumbnails come from the engine's own render pipeline (`renderThumbnail`);
 * without one the tab falls back to a number grid.
 */
export function PagesTab({
  pageCount,
  currentPage,
  onGoToPage,
  theme,
  renderThumbnail,
  pageOps,
  revision = 0,
}: {
  pageCount: number;
  currentPage: number;
  onGoToPage: (page: number) => void;
  theme: ReaderTheme;
  renderThumbnail?: (page: number, width: number) => Promise<string | null>;
  pageOps?: PageOpsApi;
  /**
   * Bumped whenever the underlying file is rewritten (rotate / reorder /
   * delete / merge). Used as the rail's key so cached thumbnails are dropped
   * instead of showing the pre-op render.
   */
  revision?: number;
}) {
  if (!renderThumbnail) {
    return (
      <div role="group" aria-label="Pages" className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onGoToPage(page)}
            aria-label={`Go to page ${page}`}
            aria-current={page === currentPage ? "page" : undefined}
            className={cn(
              "rounded-[3px] border py-2 font-mono text-[11px] tabular-nums transition-colors hover:bg-foreground/5",
              page === currentPage && "border-signal-ink text-signal-ink",
            )}
            style={{ borderColor: page === currentPage ? undefined : theme.line }}
          >
            {page}
          </button>
        ))}
      </div>
    );
  }

  return (
    <ThumbnailRail
      key={revision}
      pageCount={pageCount}
      currentPage={currentPage}
      onGoToPage={onGoToPage}
      theme={theme}
      renderThumbnail={renderThumbnail}
      pageOps={pageOps}
    />
  );
}

function ThumbnailRail({
  pageCount,
  currentPage,
  onGoToPage,
  theme,
  renderThumbnail,
  pageOps,
}: {
  pageCount: number;
  currentPage: number;
  onGoToPage: (page: number) => void;
  theme: ReaderTheme;
  renderThumbnail: (page: number, width: number) => Promise<string | null>;
  pageOps?: PageOpsApi;
}) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [attempt, setAttempt] = useState(0);

  const [visible, setVisible] = useState<number[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTo, setDropTo] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const queued = useRef<Set<number>>(new Set());

  // Only render thumbnails that scroll into the rail.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const seen: number[] = [];
        for (const e of entries) {
          const page = Number((e.target as HTMLElement).dataset.thumb);
          if (page && e.isIntersecting) seen.push(page);
        }
        if (seen.length) setVisible((prev) => [...new Set([...prev, ...seen])]);
      },
      { root, rootMargin: "300px 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-thumb]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pageCount]);

  // The parent builds a new `renderThumbnail` function on every render, so it
  // is read through a ref. Listing it as an effect dependency cancelled the draw
  // that was in flight each time the reader re-rendered, and page 1 (first in
  // line, so always in flight) was dropped for good while marked as queued.
  const renderRef = useRef(renderThumbnail);
  useEffect(() => {
    renderRef.current = renderThumbnail;
  });
  /** Bumped when a page op rewrites the file: results drawn from the old file are discarded. */
  const generation = useRef(0);
  const alive = useRef(true);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (retry.current) clearTimeout(retry.current);
    };
  }, []);

  useEffect(() => {
    // A newer run took over: stop starting pages, but let the one in flight land.
    let superseded = false;
    (async () => {
      let missed = false;
      for (const page of visible) {
        if (superseded || !alive.current) break;
        if (queued.current.has(page)) continue;
        queued.current.add(page);
        const gen = generation.current;
        const url = await renderRef.current(page, THUMB_WIDTH);
        if (!alive.current || gen !== generation.current) return;
        if (url) setThumbs((prev) => ({ ...prev, [page]: url }));
        else {
          // The engine remounts after a page op and has no document for a
          // moment; un-queue so the page is retried instead of staying blank.
          queued.current.delete(page);
          missed = true;
        }
      }
      if (missed && alive.current && !retry.current) {
        retry.current = setTimeout(() => {
          retry.current = undefined;
          setAttempt((n) => n + 1);
        }, 400);
      }
    })().catch(() => {});
    return () => {
      superseded = true;
    };
  }, [visible, attempt]);

  // A page op rewrites the file; drop stale previews.
  useEffect(() => {
    if (pageOps?.busy) {
      generation.current += 1;
      queued.current.clear();
      setThumbs({});
      setVisible((prev) => [...prev]);
    }
  }, [pageOps?.busy]);

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  // Roving tabindex: one stop for the whole rail, arrows move within it.
  const [focusPage, setFocusPage] = useState(currentPage);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    setFocusPage((p) => Math.min(Math.max(1, p), Math.max(1, pageCount)));
  }, [pageCount]);

  const focusThumb = (page: number) => {
    const next = Math.min(Math.max(1, page), pageCount);
    setFocusPage(next);
    rootRef.current?.querySelector<HTMLElement>(`[data-thumb="${next}"] button[data-nav]`)?.focus();
  };

  const onGridKeyDown = (e: React.KeyboardEvent, page: number) => {
    const cols = 2;
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
    };
    if (e.key in deltas) {
      e.preventDefault();
      const target = page + deltas[e.key];
      if (target < 1 || target > pageCount) return;
      // Alt + arrow reorders instead of moving focus.
      if (e.altKey) {
        if (!pageOps || pageOps.busy) return;
        pageOps.move(page, target);
        setAnnouncement(`Moved page ${page} to position ${target}.`);
        focusThumb(target);
        return;
      }
      focusThumb(target);
      setAnnouncement(`Page ${target}`);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusThumb(e.key === "Home" ? 1 : pageCount);
    }
  };

  return (
    <div>
      {pageOps && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <ToolButton
            theme={theme}
            disabled={pageOps.busy}
            onClick={() => pageOps.exportFlattened()}
            icon={<Download className="h-3.5 w-3.5" />}
            label="Export annotated"
          />
          <ToolButton
            theme={theme}
            disabled={pageOps.busy}
            onClick={() => mergeInput.current?.click()}
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Merge PDFs"
          />
          <input
            ref={mergeInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) pageOps.merge(files);
            }}
          />
        </div>
      )}

      <div ref={rootRef} role="list" aria-label="Pages" className="grid grid-cols-2 gap-2">
        {pages.map((page) => (
          <div
            key={page}
            role="listitem"
            data-thumb={page}
            draggable={!!pageOps && !pageOps.busy}
            onDragStart={() => setDragFrom(page)}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDropTo(page);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropTo(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (pageOps && dragFrom !== null && dragFrom !== page) pageOps.move(dragFrom, page);
              setDragFrom(null);
              setDropTo(null);
            }}
            className={cn(
              "group relative rounded-[3px] border p-1 transition-colors",
              page === currentPage ? "border-signal-ink" : "hover:bg-foreground/5",
              dropTo === page && dragFrom !== null && "ring-2 ring-signal",
            )}
            style={{ borderColor: page === currentPage ? undefined : theme.line }}
          >
            <button
              type="button"
              data-nav
              onClick={() => {
                setFocusPage(page);
                onGoToPage(page);
              }}
              onFocus={() => setFocusPage(page)}
              onKeyDown={(e) => onGridKeyDown(e, page)}
              tabIndex={page === focusPage ? 0 : -1}
              aria-current={page === currentPage ? "page" : undefined}
              className="block w-full"
              aria-label={`Go to page ${page}`}
            >
              {thumbs[page] ? (
                <img
                  src={thumbs[page]}
                  alt={`Page ${page}`}
                  className="block w-full bg-white"
                  loading="lazy"
                />
              ) : (
                <span
                  className="block w-full animate-pulse bg-foreground/5"
                  style={{ aspectRatio: "1 / 1.414" }}
                />
              )}
              <span
                className={cn(
                  "mt-1 block font-mono text-[11px] tabular-nums",
                  page === currentPage && "text-signal-ink",
                )}
                style={{ color: page === currentPage ? undefined : theme.sub }}
              >
                {page}
              </span>
            </button>

            {pageOps && (
              <div className="absolute inset-x-1 top-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <MiniButton
                  label={`Rotate page ${page}`}
                  disabled={pageOps.busy}
                  onClick={() => pageOps.rotate(page)}
                >
                  <RotateCw className="h-3 w-3" />
                </MiniButton>
                <MiniButton
                  label={`Extract page ${page}`}
                  disabled={pageOps.busy}
                  onClick={() => pageOps.extract(page)}
                >
                  <FileOutput className="h-3 w-3" />
                </MiniButton>
                <MiniButton
                  label={`Split after page ${page}`}
                  disabled={pageOps.busy || page >= pageCount}
                  onClick={() => pageOps.splitAt(page)}
                >
                  <Scissors className="h-3 w-3" />
                </MiniButton>
                <MiniButton
                  label={`Delete page ${page}`}
                  disabled={pageOps.busy || pageCount <= 1}
                  onClick={() => pageOps.remove(page)}
                >
                  <Trash2 className="h-3 w-3" />
                </MiniButton>
              </div>
            )}
          </div>
        ))}
      </div>

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {pageOps && (
        <p
          className="mt-3 font-mono text-[11px] leading-relaxed tracking-wide"
          style={{ color: theme.sub }}
        >
          Drag a thumbnail onto another to reorder, or use arrow keys to move between pages and Alt
          + arrow to reorder. Page edits rewrite the stored file.
        </p>
      )}
    </div>
  );
}

function ToolButton({
  theme,
  icon,
  label,
  onClick,
  disabled,
}: {
  theme: ReaderTheme;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-[3px] border px-2 py-1.5 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors hover:bg-foreground/5 disabled:opacity-40"
      style={{ borderColor: theme.line }}
    >
      {icon}
      {label}
    </button>
  );
}

function MiniButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-background/90 shadow-sm transition-colors hover:bg-signal hover:text-signal-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}
