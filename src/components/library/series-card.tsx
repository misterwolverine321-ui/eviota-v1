import { Layers } from "lucide-react";
import { useObjectUrl } from "@/hooks/use-object-url";
import type { BookRecord } from "@/lib/db";
import type { SeriesStack } from "@/lib/comicinfo";

interface Props {
  stack: SeriesStack<BookRecord>;
  index: number;
  onOpen: (key: string) => void;
}

/**
 * A comic series shown as one stacked card on the shelf. The
 * cover of the first issue is fanned behind two paper edges so the pile reads
 * as "more inside"; clicking drills into the issues.
 */
export function SeriesCard({ stack, index, onOpen }: Props) {
  const first = stack.issues[0];
  const coverUrl = useObjectUrl(first?.cover ?? null);
  const count = stack.issues.length;

  return (
    <div
      className="group anim-rise relative"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(stack.key)}
        className="block w-full text-left focus:outline-none"
        aria-label={`Open ${stack.name}, ${count} issues`}
      >
        <div className="relative aspect-[2/3]">
          {/* Two paper edges peeking out behind the top cover. */}
          <div className="absolute inset-y-2 right-[-6px] left-[6px] rounded-[3px] border border-border bg-card" />
          <div className="absolute inset-y-1 right-[-3px] left-[3px] rounded-[3px] border border-border bg-secondary" />
          <div className="cover-shadow group-hover:cover-shadow-hover relative h-full w-full overflow-hidden rounded-[3px] bg-secondary transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`Cover of ${stack.name}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full flex-col justify-between border border-border bg-card p-4">
                <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                  Series
                </span>
                <span className="font-display line-clamp-3 text-2xl leading-tight font-semibold text-foreground/85">
                  {stack.name}
                </span>
              </div>
            )}
            <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-[3px] font-mono text-[11px] tracking-[0.08em] text-foreground/80 backdrop-blur">
              <Layers className="h-2.5 w-2.5" aria-hidden />
              {count} issues
            </span>
          </div>
        </div>
      </button>

      <div className="mt-3 px-0.5">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium tracking-tight">
          {stack.name}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {first?.author || "Comic series"}
        </p>
        <div className="mt-1.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Series · {count} issues
        </div>
      </div>
    </div>
  );
}
