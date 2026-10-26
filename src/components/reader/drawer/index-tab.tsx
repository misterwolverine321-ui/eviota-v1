import { useMemo, useState } from "react";
import type { KeywordEntry, ReaderTheme } from "@/lib/reader-settings";
import { EmptyState } from "../ui";

interface FlatKeyword {
  keyword: string;
  targets: { label: string; href: string }[];
  depth: number;
}

function flatten(items: KeywordEntry[], depth = 0): FlatKeyword[] {
  const out: FlatKeyword[] = [];
  for (const item of items) {
    out.push({ keyword: item.keyword, targets: item.targets, depth });
    if (item.subitems?.length) out.push(...flatten(item.subitems, depth + 1));
  }
  return out;
}

/**
 * Keyword-index tab: a filterable A–Z list (no engine supplies keywords at the moment). A keyword with one
 * target jumps straight there; multi-target keywords expand into their topics,
 * the way the Windows Help viewer's "Index" pane does.
 */
export function IndexTab({
  keywords,
  onNavigate,
  theme,
}: {
  keywords: KeywordEntry[];
  onNavigate: (href: string) => void;
  theme: ReaderTheme;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const flat = useMemo(() => flatten(keywords), [keywords]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return flat;
    return flat.filter(
      (item) =>
        item.keyword.toLocaleLowerCase().includes(needle) ||
        item.targets.some((t) => t.label.toLocaleLowerCase().includes(needle)),
    );
  }, [flat, query]);

  if (!flat.length) return <EmptyState>This help file has no keyword index.</EmptyState>;

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter keywords…"
        aria-label="Filter keywords"
        className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      {!shown.length && <EmptyState>No keyword matches “{query}”.</EmptyState>}
      <ul className="space-y-0.5">
        {shown.map((item, i) => {
          const id = `${item.keyword}-${i}`;
          const single = item.targets.length === 1;
          const expanded = open === id;
          return (
            <li key={id}>
              <button
                type="button"
                aria-expanded={single ? undefined : expanded}
                onClick={() => {
                  if (single) onNavigate(item.targets[0].href);
                  else if (item.targets.length) setOpen(expanded ? null : id);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/5"
                style={{
                  paddingLeft: 8 + item.depth * 14,
                  color: item.depth > 0 ? theme.sub : undefined,
                }}
              >
                {item.keyword}
                {!single && item.targets.length > 1 && (
                  <span className="ml-1 text-xs" style={{ color: theme.sub }}>
                    ({item.targets.length})
                  </span>
                )}
              </button>
              {expanded && (
                <ul className="space-y-0.5">
                  {item.targets.map((target, j) => (
                    <li key={`${target.href}-${j}`}>
                      <button
                        type="button"
                        onClick={() => onNavigate(target.href)}
                        className="w-full rounded px-2 py-1 text-left text-sm transition-colors hover:bg-foreground/5"
                        style={{ paddingLeft: 22 + item.depth * 14, color: theme.sub }}
                      >
                        {target.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
