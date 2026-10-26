import { useObjectUrl } from "@/hooks/use-object-url";
import { BookLoader } from "@/components/loading-book";
import { FORMATS } from "@/lib/formats";
import type { ImportPending } from "@/lib/import-books";

/**
 * A shelf slot for a file that is still being ingested. It lands in the grid
 * immediately with the filename, then swaps in the real cover the moment the
 * decoder hands one over — the loader stays until the book is stored.
 */
export function ImportingCard({ pending, index }: { pending: ImportPending; index: number }) {
  const coverUrl = useObjectUrl(pending.cover ?? null);
  const info = FORMATS[pending.format];

  return (
    <div
      className="anim-rise relative"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
      aria-busy
    >
      <div className="cover-shadow relative aspect-[2/3] overflow-hidden rounded-[3px] bg-secondary">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${pending.title}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col justify-between border border-border bg-card p-4">
            <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
              {info?.label ?? pending.format}
            </span>
            <span className="line-clamp-3 text-xs leading-snug font-medium text-muted-foreground">
              {pending.title}
            </span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-background/55 backdrop-blur-[1px]">
          <BookLoader label="Opening" />
        </div>
        <div className="absolute right-0 bottom-0 left-0 h-[3px] overflow-hidden bg-foreground/10">
          <div className="h-full w-1/3 animate-pulse bg-signal" />
        </div>
      </div>
      <div className="mt-3 px-0.5">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium tracking-tight">
          {pending.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {pending.author || "Reading file…"}
        </p>
      </div>
    </div>
  );
}
