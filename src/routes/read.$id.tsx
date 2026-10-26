import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getBook, getBookFile, type BookRecord } from "@/lib/db";
import { ReaderShell } from "@/components/reader/reader-shell";
import { BookLoader } from "@/components/loading-book";
import { asNamedFile } from "@/lib/book-file";
import { bookOpenState, checkReattach } from "@/lib/book-open-state";
import { reattachSource } from "@/lib/storage";
import { BackLink } from "@/components/back-link";

export const Route = createFileRoute("/read/$id")({
  head: () => ({
    meta: [
      { title: "Reading — Eviota" },
      {
        name: "description",
        content: "Read EPUB, PDF, MOBI, comics and more directly in your browser with Eviota.",
      },
      { property: "og:title", content: "Reading — Eviota" },
      {
        property: "og:description",
        content: "Your private, offline-first reading room.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; page?: number; at?: number } => ({
    q: typeof search.q === "string" ? search.q : undefined,
    page:
      typeof search.page === "number" && Number.isFinite(search.page)
        ? Math.floor(search.page)
        : undefined,
    // Where in that page or section the match starts (characters into its text).
    at:
      typeof search.at === "number" && Number.isFinite(search.at) && search.at >= 0
        ? Math.floor(search.at)
        : undefined,
  }),
  component: ReaderPage,
});

function ReaderPage() {
  const { id } = Route.useParams();
  const { q, page, at } = Route.useSearch();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; book: BookRecord; file: Blob }
    | { status: "missing" }
    | { status: "evicted"; book: BookRecord }
    | { status: "error" }
  >({ status: "loading" });
  // Bumped after a successful re-attach so the load effect runs again.
  const [loadKey, setLoadKey] = useState(0);
  const [reattachError, setReattachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [book, file] = await Promise.all([getBook(id), getBookFile(id)]);
      if (cancelled) return;
      const openState = bookOpenState(book, file);
      if (openState === "evicted" && book) {
        setState({ status: "evicted", book });
        return;
      }
      if (openState !== "ready" || !book || !file) {
        setState({ status: "missing" });
        return;
      }
      // A restored backup stores a nameless Blob, which foliate cannot open.
      setState({ status: "ready", book, file: asNamedFile(file, book.fileName) });
    })().catch(() => {
      if (!cancelled) setState({ status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [id, loadKey]);

  async function onChooseFile(file: File | undefined) {
    if (!file || state.status !== "evicted") return;
    setReattachError(null);
    if (!checkReattach(state.book, file).ok) {
      setReattachError(
        "That file is a different size from the original, so it can't be the same book. Choose the original file.",
      );
      return;
    }
    try {
      await reattachSource(state.book.id, file);
      setState({ status: "loading" });
      setLoadKey((k) => k + 1);
    } catch {
      setReattachError("Couldn't save the file. Your browser's storage may be full or blocked.");
    }
  }

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <BookLoader label="Opening" sub="Reading from your library" />
      </div>
    );
  }

  if (state.status === "evicted") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center" role="alert">
          <h1 className="font-display text-2xl font-semibold">
            This device doesn't have this book's file
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            “{state.book.title}” is on your shelf with your notes and reading progress, but its file
            was removed or never came with them. Choose the same file again to keep reading.
          </p>
          {reattachError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {reattachError}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose the book file"
            onChange={(e) => {
              void onChooseFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-[3px] bg-signal px-4 py-2 text-xs font-medium text-signal-foreground transition-opacity hover:opacity-90"
            >
              Choose the file
            </button>
            <BackLink className="rounded-[3px] border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-secondary">
              Back to library
            </BackLink>
            <Link
              to="/settings"
              className="rounded-[3px] border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-secondary"
            >
              Open Settings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "missing" || state.status === "error") {
    const missing = state.status === "missing";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center" role="alert">
          <h1 className="font-display text-2xl font-semibold">
            {missing ? "This book isn't on your shelf" : "This book couldn't be opened"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {missing
              ? "It may have been removed, or it was added in another browser. Books live only in the browser you imported them into."
              : "Your browser's storage didn't respond. Reloading usually fixes it; private windows may block storage."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {!missing && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-[3px] border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-secondary"
              >
                Try again
              </button>
            )}
            <BackLink className="rounded-[3px] bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-85">
              Back to library
            </BackLink>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReaderShell
      book={state.book}
      file={state.file}
      initialQuery={q}
      initialPage={page}
      initialAt={at}
    />
  );
}
