import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, Trash2 } from "lucide-react";
import { useObjectUrl } from "@/hooks/use-object-url";
import type { BookRecord } from "@/lib/db";
import { formatSize } from "@/lib/books";
import { FORMATS } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/sessions";
import { TagEditor } from "./tag-editor";

interface Props {
  book: BookRecord;
  onDelete: (id: string) => void;
  index: number;
  /** Trailing-rate estimate of reading time left, if confident. */
  remainingMinutes?: number | null;
  /** Omit to hide inline tag editing (e.g. in compact views). */
  onTagsChange?: (id: string, tags: string[]) => void;
}

export function BookCard({ book, onDelete, index, remainingMinutes = null, onTagsChange }: Props) {
  const coverUrl = useObjectUrl(book.cover ?? null);
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => setCoverFailed(false), [coverUrl]);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);

  const fraction = book.progress?.fraction ?? 0;
  const pct = Math.round(fraction * 100);
  const info = FORMATS[book.format];
  const initials = book.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className="group anim-rise relative"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/eviota-book", book.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {/* The cover and the title below it open the same book. One link is enough for a screen
          reader and for the Tab key, so the cover is left to the mouse and the finger; the title
          link carries the name and the keyboard focus. */}
      <Link
        to="/read/$id"
        params={{ id: book.id }}
        className="block focus:outline-none"
        aria-hidden="true"
        tabIndex={-1}
      >
        <div className="cover-shadow group-hover:cover-shadow-hover relative aspect-[2/3] overflow-hidden rounded-[3px] bg-secondary transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5">
          {coverUrl && !coverFailed ? (
            <img
              src={coverUrl}
              alt={`Cover of ${book.title}`}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col justify-between border border-border bg-card p-4">
              <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                {info?.label ?? book.format}
              </span>
              <span className="font-display text-5xl font-semibold text-foreground/85">
                {initials}
              </span>
              <span className="line-clamp-3 text-xs leading-snug font-medium text-muted-foreground">
                {book.title}
              </span>
            </div>
          )}
          {/* reading progress */}
          {pct > 0 && (
            <div className="absolute right-0 bottom-0 left-0 h-[3px] bg-foreground/10">
              <div className="h-full bg-signal transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          )}
          {remainingMinutes != null && remainingMinutes > 0 && fraction > 0 && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-[3px] font-mono text-[11px] tracking-[0.08em] text-foreground/80 backdrop-blur">
              <Clock className="h-2.5 w-2.5" aria-hidden />
              &asymp;{formatDuration(remainingMinutes)} left
            </span>
          )}
        </div>
      </Link>

      <button
        type="button"
        onClick={() => (armed ? onDelete(book.id) : setArmed(true))}
        aria-label={armed ? `Confirm removal of ${book.title}` : `Remove ${book.title}`}
        className={cn(
          "absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur transition-all focus-visible:opacity-100",
          armed
            ? "border-signal bg-signal text-signal-foreground opacity-100"
            : "border-border bg-background/85 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span role="status" className="sr-only">
        {armed ? `Press the button again to remove ${book.title}. This is not undone.` : ""}
      </span>

      <div className="mt-3 px-0.5">
        <Link to="/read/$id" params={{ id: book.id }} className="block">
          <h3 className="line-clamp-2 text-sm leading-snug font-medium tracking-tight">
            {book.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{book.author}</p>
        </Link>
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          <span className="text-foreground/70">{info?.label ?? book.format}</span>
          <span aria-hidden>·</span>
          <span>{formatSize(book.size)}</span>
          {pct > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-signal-ink">
                {pct}%<span className="sr-only"> read</span>
              </span>
            </>
          )}
        </div>
        {onTagsChange && (
          <TagEditor
            tags={book.tags ?? []}
            bookTitle={book.title}
            onChange={(tags) => onTagsChange(book.id, tags)}
          />
        )}
      </div>
    </div>
  );
}
