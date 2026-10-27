import type { ReaderTheme, TocItem } from "@/lib/reader-settings";
import { EmptyState } from "../ui";

/** Contents tab: the navigation tree as nested lists, so a screen reader announces the depth. */
export function TocTab({
  toc,
  onNavigate,
  theme,
}: {
  toc: TocItem[];
  onNavigate: (href: string) => void;
  theme: ReaderTheme;
}) {
  if (toc.length === 0) return <EmptyState>This book has no table of contents.</EmptyState>;
  return <TocList items={toc} depth={0} onNavigate={onNavigate} theme={theme} />;
}

function TocList({
  items,
  depth,
  onNavigate,
  theme,
}: {
  items: TocItem[];
  depth: number;
  onNavigate: (href: string) => void;
  theme: ReaderTheme;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={`${item.href}-${i}`}>
          <button
            type="button"
            onClick={() => onNavigate(item.href)}
            className="w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/5 pointer-coarse:min-h-11"
            style={{
              paddingLeft: 8 + depth * 14,
              color: depth > 0 ? theme.sub : undefined,
            }}
          >
            {item.label}
          </button>
          {item.subitems?.length ? (
            <TocList
              items={item.subitems}
              depth={depth + 1}
              onNavigate={onNavigate}
              theme={theme}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
