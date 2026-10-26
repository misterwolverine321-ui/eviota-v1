import { useState } from "react";
import { ChevronDown, FolderPlus, Layers, Sparkles, Tag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSmartCollection } from "@/lib/collections";
import type { BookStatus, Collection } from "@/lib/collections";

const STATUS_FACETS: { key: BookStatus; label: string }[] = [
  { key: "unread", label: "Unread" },
  { key: "reading", label: "Reading" },
  { key: "finished", label: "Finished" },
];

interface Props {
  collections: Collection[];
  activeId: string | null;
  counts: Record<string, number>;
  totalBooks: number;
  tags: string[];
  activeTags: string[];
  activeStatus: BookStatus | null;
  statusCounts: Record<BookStatus, number>;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onDropBook: (collectionId: string, bookId: string) => void;
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  onSelectStatus: (status: BookStatus | null) => void;
}

/**
 * Phase 7.2 — collections rail plus the tag chip row. A cover dragged from the
 * shelf can be dropped straight onto a collection to file it.
 * Phase 7.4 — smart collections (computed membership) get a distinct icon and
 * reject drops, and a Status facet row filters by derived reading state.
 */
export function CollectionsSidebar({
  collections,
  activeId,
  counts,
  totalBooks,
  tags,
  activeTags,
  activeStatus,
  statusCounts,
  onSelect,
  onCreate,
  onDelete,
  onDropBook,
  onToggleTag,
  onClearTags,
  onSelectStatus,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [over, setOver] = useState<string | null>(null);
  // Phones: the rail is collapsed behind a toggle so books stay near the top.
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = collections.find((c) => c.id === activeId)?.name ?? "Collections & filters";
  const filterCount = activeTags.length + (activeStatus ? 1 : 0);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed);
    setName("");
    setAdding(false);
  };

  return (
    <aside className="w-full shrink-0 md:w-52" aria-label="Collections and tags">
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        aria-controls="collections-panel"
        className="flex w-full items-center justify-between rounded-[3px] border border-border px-3 py-2.5 text-xs text-foreground transition-colors hover:bg-secondary md:hidden"
      >
        <span className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          {activeLabel}
          {filterCount > 0 && (
            <span className="rounded-full bg-signal px-1.5 font-mono text-[11px] text-signal-foreground">
              {filterCount}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", mobileOpen && "rotate-180")}
          aria-hidden
        />
      </button>
      <div
        id="collections-panel"
        className={cn("mt-4 md:mt-0 md:block", mobileOpen ? "block" : "hidden")}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
            <Layers className="h-3 w-3" aria-hidden />
            Collections
          </h3>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-label="New collection"
            aria-expanded={adding}
            className="rounded-[3px] p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        {adding && (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setName("");
                setAdding(false);
              }
            }}
            placeholder="Collection name"
            aria-label="Collection name"
            className="mt-3 w-full rounded-[3px] border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-foreground/40"
          />
        )}

        <ul className="mt-3 space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              aria-current={activeId === null ? "true" : undefined}
              className={cn(
                "flex w-full items-center justify-between rounded-[3px] px-2 py-1.5 text-left text-xs transition-colors",
                activeId === null
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              <span>All books</span>
              <span className="font-mono text-[11px]">{totalBooks}</span>
            </button>
          </li>
          {collections.map((collection) => {
            const smart = isSmartCollection(collection);
            return (
              <li key={collection.id} className="group/col relative">
                <button
                  type="button"
                  onClick={() => onSelect(collection.id)}
                  aria-current={activeId === collection.id ? "true" : undefined}
                  onDragOver={(e) => {
                    if (smart) return;
                    e.preventDefault();
                    setOver(collection.id);
                  }}
                  onDragLeave={() => setOver((c) => (c === collection.id ? null : c))}
                  onDrop={(e) => {
                    if (smart) return;
                    e.preventDefault();
                    setOver(null);
                    const bookId = e.dataTransfer.getData("text/eviota-book");
                    if (bookId) onDropBook(collection.id, bookId);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-xs transition-colors",
                    activeId === collection.id
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60",
                    over === collection.id && "ring-1 ring-signal",
                  )}
                >
                  {smart ? (
                    <Sparkles
                      aria-label="Smart collection"
                      className="h-3 w-3 shrink-0"
                      style={{ color: collection.color }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: collection.color }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                  <span className="font-mono text-[11px]">{counts[collection.id] ?? 0}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(collection.id)}
                  aria-label={`Delete collection ${collection.name}`}
                  className="absolute top-1/2 right-1 -translate-y-1/2 rounded-[3px] bg-background/90 p-1 text-muted-foreground opacity-0 transition-opacity group-focus-within/col:opacity-100 group-hover/col:opacity-100 hover:text-foreground"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-8" role="group" aria-labelledby="status-filter-title">
          <h3
            id="status-filter-title"
            className="font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase"
          >
            Status
          </h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STATUS_FACETS.map((facet) => {
              const active = activeStatus === facet.key;
              return (
                <button
                  key={facet.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectStatus(active ? null : facet.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    active
                      ? "border-signal bg-signal text-signal-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {facet.label}
                  <span className="font-mono text-[11px] opacity-70">
                    {statusCounts[facet.key] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 font-mono text-[11px] font-normal tracking-[0.24em] text-muted-foreground uppercase">
                <Tag className="h-3 w-3" aria-hidden />
                Tags
              </h3>
              {activeTags.length > 0 && (
                <button
                  type="button"
                  onClick={onClearTags}
                  aria-label="Clear tag filters"
                  className="rounded-[3px] p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div role="group" aria-label="Filter by tag" className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = activeTags.some((t) => t.toLowerCase() === tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggleTag(tag)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                      active
                        ? "border-signal bg-signal text-signal-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
