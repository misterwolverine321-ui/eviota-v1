import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  Highlighter,
  StickyNote,
  Strikethrough,
  Trash2,
  Underline,
} from "lucide-react";
import {
  ANNOTATION_COLORS,
  COLOR_ORDER,
  type Annotation,
  type AnnotationColor,
  type AnnotationType,
} from "@/lib/annotations";
import type { ReaderTheme } from "@/lib/reader-settings";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/pdf-ops";
import {
  EXPORT_FORMATS,
  exportFileName,
  renderExport,
  toRows,
  type ExportBook,
  type ExportFormat,
} from "@/lib/annotation-export";
import { EmptyState } from "../ui";

const TYPE_ICON: Record<AnnotationType, typeof Highlighter> = {
  highlight: Highlighter,
  underline: Underline,
  strike: Strikethrough,
  note: StickyNote,
  ink: Highlighter,
  bookmark: Bookmark,
};

type Filter = "all" | "marks" | "notes" | "bookmarks";

/**
 * What a screen reader is told a mark is: its kind and the first words it covers, so that the
 * twentieth "Delete" button in the list says which mark it deletes.
 */
function describeMark(a: Annotation): string {
  const kind = a.type === "bookmark" ? "bookmark" : a.note ? "note" : "highlight";
  const words = (a.text ?? "").replace(/\s+/g, " ").trim();
  if (!words) return kind;
  return `${kind} “${words.length > 40 ? `${words.slice(0, 40)}…` : words}”`;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "marks", label: "Marks" },
  { id: "notes", label: "Notes" },
  { id: "bookmarks", label: "Marks·B" },
];

/**
 * Notes tab: every highlight, note and bookmark for the active book.
 *
 * The kernel owns the records; this tab reads them, jumps to anchors, edits
 * note bodies, recolors and deletes. Engines are never involved.
 */
export function NotesTab({
  anchor,
  annotations,
  theme,
  onJump,
  onUpdate,
  onDelete,
  exportBook,
}: {
  anchor: Annotation["anchor"]["kind"] | "page-rect" | "cfi" | false | undefined;
  annotations: Annotation[];
  theme: ReaderTheme;
  onJump: (a: Annotation) => void;
  onUpdate: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  exportBook?: ExportBook;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // The note field leaves the page on Save and Cancel; put the keyboard back where it was.
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    if (editing !== null || !returnTo.current) return;
    const id = returnTo.current;
    returnTo.current = null;
    document.querySelector<HTMLElement>(`[data-note-edit="${CSS.escape(id)}"]`)?.focus();
  }, [editing]);

  const visible = annotations.filter((a) => {
    if (filter === "marks")
      return a.type === "highlight" || a.type === "underline" || a.type === "strike";
    if (filter === "notes") return !!a.note;
    if (filter === "bookmarks") return a.type === "bookmark";
    return true;
  });

  const exportAs = (format: ExportFormat) => {
    if (!exportBook) return;
    const out = renderExport(format, [{ book: exportBook, rows: toRows(annotations) }]);
    downloadBlob(
      new Blob([out.content], { type: `${out.mime};charset=utf-8` }),
      exportFileName(out.extension, exportBook),
    );
  };

  return (
    <>
      {exportBook && annotations.length > 0 && (
        <div role="group" aria-label="Export notes" className="mb-3 flex items-center gap-1">
          <span className="mr-1 text-xs opacity-60">Export</span>
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => exportAs(f.id)}
              aria-label={`Export notes as ${f.label}`}
              className="hover:bg-foreground/5 rounded-[3px] border px-2 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal"
              style={{ borderColor: theme.line }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex gap-1" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              "hover:bg-foreground/5 flex-1 rounded-[3px] border px-1 py-1.5 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors pointer-coarse:min-h-11",
              filter === f.id && "border-signal-ink text-signal-ink",
            )}
            style={{ borderColor: filter === f.id ? undefined : theme.line }}
          >
            {f.id === "bookmarks" ? "Saved" : f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState>
          {annotations.length === 0
            ? anchor === "page-rect"
              ? "No marks yet. Select text on a page to highlight it, or bookmark the page you're on."
              : "No highlights yet. Select text to highlight or add a note."
            : "Nothing matches this filter."}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {visible.map((a) => {
            const Icon = TYPE_ICON[a.type];
            const isEditing = editing === a.id;
            const page = a.anchor.kind !== "cfi" ? a.anchor.page : null;
            const orphaned = !!a.orphaned;
            return (
              <li
                key={a.id}
                className={cn(
                  "rounded-[3px] border p-2 transition-colors",
                  orphaned && "border-dashed opacity-60",
                )}
                style={{ borderColor: orphaned ? theme.sub : theme.line }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px]"
                    style={{ background: ANNOTATION_COLORS[a.color] }}
                  >
                    <Icon className="h-3 w-3 text-black/70" />
                  </span>
                  <button
                    type="button"
                    onClick={() => onJump(a)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {a.text ? (
                      <p className="line-clamp-3 text-xs leading-relaxed">{a.text}</p>
                    ) : (
                      <p className="text-xs leading-relaxed opacity-70">
                        {a.type === "bookmark" ? "Bookmark" : "Marked passage"}
                      </p>
                    )}
                    <p
                      className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase"
                      style={{ color: theme.sub }}
                    >
                      {orphaned && (
                        <span
                          data-testid="orphan-badge"
                          className="inline-flex items-center gap-1 rounded-[2px] border border-dashed px-1 py-0.5"
                          style={{ borderColor: theme.sub }}
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {page ? `Anchor lost — page ${page}` : "Anchor lost"}
                        </span>
                      )}
                      <span>{a.label ?? (page ? `Page ${page}` : a.type)}</span>
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      // The row is about to disappear; keep the keyboard in the panel.
                      e.currentTarget.closest<HTMLElement>('[role="tabpanel"]')?.focus();
                      onDelete(a.id);
                    }}
                    aria-label={`Delete ${describeMark(a)}`}
                    title="Delete"
                    className="hover:bg-foreground/5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {a.note && !isEditing && (
                  <p
                    className="mt-2 border-l-2 pl-2 text-xs leading-relaxed opacity-80"
                    style={{ borderColor: ANNOTATION_COLORS[a.color] }}
                  >
                    {a.note}
                  </p>
                )}

                {isEditing ? (
                  <div className="mt-2">
                    <textarea
                      autoFocus
                      rows={3}
                      aria-label={`Note on ${describeMark(a)}`}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="w-full resize-none rounded-[3px] border bg-transparent p-2 text-xs outline-none"
                      style={{ borderColor: theme.line }}
                    />
                    <div className="mt-1 flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onUpdate(a.id, { note: draft.trim() || undefined });
                          returnTo.current = a.id;
                          setEditing(null);
                        }}
                        className="bg-signal text-signal-foreground flex-1 rounded-[3px] px-2 py-1.5 text-[11px] font-medium"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          returnTo.current = a.id;
                          setEditing(null);
                        }}
                        className="rounded-[3px] border px-2 py-1.5 text-[11px]"
                        style={{ borderColor: theme.line }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      data-note-edit={a.id}
                      onClick={() => {
                        setEditing(a.id);
                        setDraft(a.note ?? "");
                      }}
                      aria-label={`${a.note ? "Edit note" : "Add note"} on ${describeMark(a)}`}
                      className="hover:bg-foreground/5 rounded-[3px] px-1.5 py-1 font-mono text-[11px] tracking-[0.14em] uppercase opacity-60"
                    >
                      {a.note ? "Edit note" : "Add note"}
                    </button>
                    <span className="flex-1" />
                    <div
                      role="group"
                      aria-label={`Colour of ${describeMark(a)}`}
                      className="flex items-center gap-1"
                    >
                      {COLOR_ORDER.map((c: AnnotationColor) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Colour ${c}`}
                          aria-pressed={a.color === c}
                          onClick={() => onUpdate(a.id, { color: c })}
                          className={cn(
                            "h-3.5 w-3.5 rounded-full border transition-transform hover:scale-125",
                            a.color === c && "ring-signal ring-1 ring-offset-1",
                          )}
                          style={{ background: ANNOTATION_COLORS[c], borderColor: theme.line }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
