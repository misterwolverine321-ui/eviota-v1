import { cn } from "@/lib/utils";

/**
 * The app's one loading identity: a book whose pages riffle while work is in
 * flight. Used while a file is being ingested on the shelf and while an engine
 * is opening a book in the reader.
 */
export function BookLoader({
  label,
  sub,
  size = "md",
  className,
}: {
  label?: string;
  sub?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "h-8 w-8" : "h-12 w-12";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <div className={cn("relative", box)} role="status" aria-live="polite">
        <svg viewBox="0 0 48 48" className="h-full w-full" aria-hidden>
          {/* spine + covers */}
          <path
            d="M24 12v27M24 12c-4-2.6-9-3.6-14-3v27c5-.6 10 .4 14 3M24 12c4-2.6 9-3.6 14-3v27c-5-.6-10 .4-14 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
          />
          {/* riffling pages */}
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d="M24 13c3.4-2.2 7.6-3.2 11.8-2.7v24.4c-4.2-.5-8.4.5-11.8 2.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              className="origin-[24px_24px] animate-[riffle_1.5s_ease-in-out_infinite]"
              style={{ animationDelay: `${i * 0.22}s` }}
            />
          ))}
        </svg>
      </div>
      {label && (
        <p className="font-mono text-[11px] tracking-[0.24em] uppercase opacity-70">{label}</p>
      )}
      {sub && (
        <p className="font-mono text-[11px] tracking-[0.14em] tabular-nums opacity-50">{sub}</p>
      )}
    </div>
  );
}

/** Small inline spinner for cards and buttons. */
export function PageSpinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}
