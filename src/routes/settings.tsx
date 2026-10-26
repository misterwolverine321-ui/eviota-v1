import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, HardDrive, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { listBooks, type BookRecord } from "@/lib/db";
import {
  estimateStorage,
  evictSource,
  formatBytes,
  freeDerived,
  requestPersistence,
  tallyLibrary,
  type BookTally,
  type StorageEstimate,
} from "@/lib/storage";
import { backupFileName, exportBackup, importBackup } from "@/lib/backup";
import { hasLookupConsent, revokeLookupConsent } from "@/lib/lookup-consent";
import { assetUrl } from "@/lib/asset-url";
import { listAllAnnotations } from "@/lib/annotations";
import {
  EXPORT_FORMATS,
  exportFileName,
  groupByBook,
  renderExport,
  type ExportFormat,
} from "@/lib/annotation-export";
import { AppearanceControl } from "@/components/theme-control";
import { cn } from "@/lib/utils";
import { BackLink } from "@/components/back-link";

/** Local so this route doesn't pull the pdf-lib-backed page-ops module in. */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Eviota" },
      {
        name: "description",
        content:
          "See how much space your Eviota library uses, free up derived data, and export or restore your shelf as a .eviota.zip to move it between devices.",
      },
      { property: "og:title", content: "Settings — Eviota" },
      {
        property: "og:description",
        content:
          "Manage on-device storage and back up your books, highlights and collections to a file you keep.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [tallies, setTallies] = useState<BookTally[]>([]);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const rows = await listBooks();
    setBooks(rows);
    setTallies(await tallyLibrary(rows));
    setEstimate(await estimateStorage());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byId = useMemo(() => new Map(tallies.map((t) => [t.bookId, t])), [tallies]);
  const totals = useMemo(
    () =>
      tallies.reduce(
        (acc, t) => ({
          source: acc.source + t.source,
          cover: acc.cover + t.cover,
          index: acc.index + t.index,
          total: acc.total + t.total,
        }),
        { source: 0, cover: 0, index: 0, total: 0 },
      ),
    [tallies],
  );

  const onExport = async (includeBlobs: boolean) => {
    setBusy("export");
    try {
      const blob = await exportBackup({
        includeBlobs,
        onProgress: (step, done, total) => setProgress(`${step} ${done}/${total}`),
      });
      downloadBlob(blob, backupFileName());
      toast.success(includeBlobs ? "Backup exported" : "Metadata-only backup exported");
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const onExportNotes = async (format: ExportFormat) => {
    setBusy("notes");
    try {
      const grouped = groupByBook(books, await listAllAnnotations());
      if (!grouped.length) {
        toast("No highlights, notes or bookmarks to export yet");
        return;
      }
      const out = renderExport(format, grouped);
      downloadBlob(
        new Blob([out.content], { type: `${out.mime};charset=utf-8` }),
        exportFileName(out.extension, null),
      );
      toast.success(
        `Exported notes from ${grouped.length} ${grouped.length === 1 ? "book" : "books"}`,
      );
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(null);
    }
  };

  const onImport = async (file: File) => {
    setBusy("import");
    try {
      const res = await importBackup(file, (step, done, total) =>
        setProgress(`${step} ${done}/${total}`),
      );
      await refresh();
      toast.success(`Restored ${res.booksAdded} new and ${res.booksUpdated} existing books`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That file isn't an Eviota backup");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const usedPct =
    estimate && estimate.quota > 0 ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-6 px-6 py-4">
          <BackLink className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Shelf
          </BackLink>
          <span className="font-mono text-[11px] tracking-[0.24em] text-muted-foreground uppercase">
            Settings
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-24">
        <h1 className="font-display mt-12 text-4xl font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Everything Eviota keeps lives in this browser. Free up derived data to reclaim space
          without losing notes, or export the whole shelf as one file.
        </p>

        <section className="mt-12 border border-border p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <h2 className="font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
                Appearance
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Follow this device, or keep Eviota light or dark.
              </p>
            </div>
            <AppearanceControl />
          </div>
        </section>

        {/* ------------------------------------------------ storage meter */}
        <section className="mt-10 border border-border p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="flex items-center gap-2 font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
              <HardDrive className="h-3.5 w-3.5" aria-hidden />
              On this device
            </h2>
            <p className="font-mono text-xs text-muted-foreground">
              {estimate
                ? `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`
                : "Estimate unavailable"}
            </p>
          </div>

          <div
            aria-hidden="true"
            className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div className="h-full bg-signal transition-[width]" style={{ width: `${usedPct}%` }} />
          </div>

          <StackedBar totals={totals} />

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                const ok = await requestPersistence();
                setEstimate(await estimateStorage());
                toast[ok ? "success" : "message"](
                  ok
                    ? "Your library is marked persistent"
                    : "The browser declined persistent storage",
                );
              }}
              className="inline-flex items-center gap-2 rounded-[3px] border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {estimate?.persisted ? "Persistent storage on" : "Request persistence"}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-[3px] border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recalculate
            </button>
          </div>
        </section>

        {/* -------------------------------------------------- per book */}
        <section className="mt-10 border border-border">
          <h2 className="border-b border-border px-6 py-3 font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
            Per book
          </h2>
          {books.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Your shelf is empty.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {books.map((book) => {
                const tally = byId.get(book.id);
                return (
                  <li
                    key={book.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{book.title}</p>
                      <p className="mt-0.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                        {formatBytes(tally?.total ?? 0)}
                        {tally?.index ? ` · index ${formatBytes(tally.index)}` : ""}
                        {book.blobEvicted ? " · no file on this device" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await freeDerived(book.id);
                          await refresh();
                          toast("Derived data cleared");
                        }}
                        aria-label={`Free up space used by ${book.title}`}
                        className="rounded-[3px] border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
                      >
                        Free up space
                      </button>
                      <button
                        type="button"
                        disabled={book.blobEvicted}
                        onClick={async () => {
                          await evictSource(book.id);
                          await refresh();
                          toast("File removed — notes and progress kept");
                        }}
                        aria-label={`Remove file of ${book.title}`}
                        className="rounded-[3px] border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-40"
                      >
                        Remove file
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------ notes export */}
        {books.length > 0 && (
          <section className="mt-10 border border-border p-6" aria-labelledby="notes-export">
            <h2
              id="notes-export"
              className="font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase"
            >
              Export notes
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Every highlight, note and bookmark from every book in one file, with the chapter or
              page and the words around each mark. Markdown suits Obsidian and note apps, CSV opens
              in a spreadsheet, JSON keeps everything. You can also export one book from its notes
              tab.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {EXPORT_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void onExportNotes(f.id)}
                  className="inline-flex items-center gap-2 rounded-[3px] border border-border px-4 py-2 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {f.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ------------------------------------------------ backup */}
        <section className="mt-10 border border-border p-6">
          <h2 className="font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
            Backup &amp; restore
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            A backup is one <code className="font-mono text-xs">.eviota.zip</code> holding your
            books, highlights, notes, reading sessions, collections and settings. The metadata-only
            option leaves the book files out. Restored on a device that already has the same files,
            your progress and notes attach to those copies; on a device without them, each book
            appears on the shelf and asks for its file. Your data stays on this device unless you
            export it.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.eviota.zip,.nawiri.zip,.folio.zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onImport(file);
            }}
          />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void onExport(true)}
              className={cn(
                "inline-flex items-center gap-2 rounded-[3px] bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-85",
                busy && "opacity-50",
              )}
            >
              <Download className="h-3.5 w-3.5" />
              Export everything
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void onExport(false)}
              className="inline-flex items-center gap-2 rounded-[3px] border border-border px-4 py-2 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Metadata only
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-[3px] border border-border px-4 py-2 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              Restore from file
            </button>
            {progress && (
              <span aria-live="polite" className="font-mono text-[11px] text-muted-foreground">
                {progress}
              </span>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ privacy */}
        <PrivacySection />

        {/* ------------------------------------------------ notices */}
        <NoticesSection />
      </main>
    </div>
  );
}

/**
 * What leaves this device, in plain words. The only thing the reader can start themselves is a
 * word lookup, and it asks first; this is where that answer can be taken back.
 */
function PrivacySection() {
  const [allowed, setAllowed] = useState(hasLookupConsent);
  return (
    <section className="mt-10 border border-border p-6">
      <h2 className="font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
        Privacy
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Your books, notes and reading history stay in this browser, and nothing is uploaded. Eviota
        loads no fonts, scripts or images from other sites, and a book cannot load remote images or
        scripts; a link in a book opens only after you confirm. The one thing you can start yourself
        is <strong className="font-medium text-foreground">Define</strong>: it sends the selected
        word to Wiktionary, and to Wikipedia if Wiktionary has no entry, and it asks before the
        first time.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <p className="text-sm" role="status">
          {allowed ? "Define sends words without asking." : "Define asks before it sends a word."}
        </p>
        {allowed && (
          <button
            type="button"
            onClick={() => {
              revokeLookupConsent();
              setAllowed(hasLookupConsent());
              toast("Define will ask before it sends a word");
            }}
            className="rounded-[3px] border border-border px-4 py-2 text-xs transition-colors hover:bg-secondary"
          >
            Ask before looking up words
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The licences of what Eviota includes (the file is written by `npm run notices`). Most of those
 * licences ask that their notice travel with the software, so it is served with the app and
 * reachable from here.
 */
function NoticesSection() {
  return (
    <section className="mt-10 border border-border p-6">
      <h2 className="font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
        Open-source notices
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Eviota includes software, fonts and data made by other people. Their licences, and the
        notices they ask for, are in one plain-text file.
      </p>
      <a
        href={assetUrl("THIRD_PARTY_NOTICES.txt")}
        target="_blank"
        rel="noopener"
        className="mt-5 inline-block rounded-[3px] border border-border px-4 py-2 text-xs transition-colors hover:bg-secondary"
      >
        Read the notices<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </section>
  );
}

function StackedBar({
  totals,
}: {
  totals: { source: number; cover: number; index: number; total: number };
}) {
  if (!totals.total) return null;
  const segments = [
    { key: "Books", value: totals.source, className: "bg-foreground/80" },
    { key: "Covers", value: totals.cover, className: "bg-signal/70" },
    { key: "Search index", value: totals.index, className: "bg-muted-foreground/50" },
  ];
  return (
    <>
      <div className="mt-6 flex h-3 w-full overflow-hidden rounded-[2px] bg-secondary">
        {segments.map((s) => (
          <span
            key={s.key}
            className={s.className}
            style={{ width: `${(s.value / totals.total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {segments.map((s) => (
          <li
            key={s.key}
            className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
          >
            <span className={cn("h-2 w-2 rounded-[1px]", s.className)} aria-hidden />
            {s.key} {formatBytes(s.value)}
          </li>
        ))}
      </ul>
    </>
  );
}
