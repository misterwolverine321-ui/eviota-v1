import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
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
  type SelectionEvent,
} from "@/lib/annotations";
import type { ReaderTheme } from "@/lib/reader-settings";
import { cn } from "@/lib/utils";

const MARKS: { type: AnnotationType; label: string; icon: typeof Highlighter }[] = [
  { type: "highlight", label: "Highlight", icon: Highlighter },
  { type: "underline", label: "Underline", icon: Underline },
  { type: "strike", label: "Strikeout", icon: Strikethrough },
];

/**
 * Selection popover — the single write surface for text annotations.
 *
 * It positions itself over the engine surface using the viewport rect the
 * engine reported, flipping below the selection when there is no room above.
 * It never persists anything: every action calls back into the kernel.
 */
export function SelectionPopover({
  selection,
  existing,
  theme,
  onMark,
  onNote,
  onDelete,
  onDefine,
  onDismiss,
  bookTitle,
}: {
  bookTitle?: string;
  selection: SelectionEvent;
  existing?: Annotation;
  theme: ReaderTheme;
  onMark: (type: AnnotationType, color: AnnotationColor) => void;
  onNote: (note: string, color: AnnotationColor) => void;
  onDelete: () => void;
  /** Look the selected word up. Absent when the selection isn't a term. */
  onDefine?: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [draft, setDraft] = useState(existing?.note ?? "");
  const [color, setColor] = useState<AnnotationColor>(existing?.color ?? "yellow");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    setNoteMode(false);
    setDraft(existing?.note ?? "");
    setColor(existing?.color ?? "yellow");
  }, [selection, existing]);

  // Clamp into the viewport once measured.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const r = selection.rect;
    const margin = 8;
    let left = r.x + r.width / 2 - box.width / 2;
    left = Math.min(window.innerWidth - box.width - margin, Math.max(margin, left));
    let top = r.y - box.height - 10;
    if (top < 64) top = Math.min(window.innerHeight - box.height - margin, r.y + r.height + 10);
    setPos({ left, top });
  }, [selection, noteMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  const copy = () => {
    void navigator.clipboard?.writeText(selection.text ?? "").catch(() => {});
    onDismiss();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Selection actions"
      className="anim-rise absolute z-40 rounded-[4px] border p-2 shadow-xl"
      style={{
        left: pos?.left ?? selection.rect.x,
        top: pos?.top ?? selection.rect.y,
        visibility: pos ? "visible" : "hidden",
        background: theme.bg,
        borderColor: theme.line,
        color: theme.ink,
        width: noteMode ? 300 : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div role="group" aria-label="Colour" className="flex items-center gap-1">
        {COLOR_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} colour`}
            aria-pressed={color === c}
            title={c}
            onClick={() => {
              setColor(c);
              if (!noteMode) onMark(existing?.type ?? "highlight", c);
            }}
            className={cn(
              "h-6 w-6 shrink-0 rounded-full border transition-transform hover:scale-110",
              color === c && "ring-signal ring-2 ring-offset-1",
            )}
            style={{ background: ANNOTATION_COLORS[c], borderColor: theme.line }}
          />
        ))}
      </div>

      <div
        className="mt-2 flex items-center gap-1 border-t pt-2"
        style={{ borderColor: theme.line }}
      >
        {MARKS.map((m) => (
          <PopButton
            key={m.type}
            label={m.label}
            active={existing?.type === m.type}
            onClick={() => onMark(m.type, color)}
          >
            <m.icon className="h-4 w-4" />
          </PopButton>
        ))}
        <PopButton
          label={existing?.note ? "Edit note" : "Add note"}
          active={noteMode}
          onClick={() => setNoteMode((v) => !v)}
        >
          <StickyNote className="h-4 w-4" />
        </PopButton>
        {onDefine && (
          <PopButton label="Define" onClick={onDefine}>
            <BookOpen className="h-4 w-4" />
          </PopButton>
        )}
        <PopButton label="Copy text" onClick={copy}>
          <Copy className="h-4 w-4" />
        </PopButton>

        {existing && (
          <PopButton label="Delete" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </PopButton>
        )}
      </div>

      {noteMode && (
        <div className="mt-2">
          {selection.text ? (
            <p className="mb-2 line-clamp-3 text-[11px] leading-relaxed italic opacity-60">
              “{selection.text}”
            </p>
          ) : null}
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a note…"
            aria-label="Note"
            rows={3}
            className="w-full resize-none rounded-[3px] border bg-transparent p-2 text-xs outline-none"
            style={{ borderColor: theme.control }}
          />
          <button
            type="button"
            onClick={() => onNote(draft.trim(), color)}
            className="bg-signal text-signal-foreground mt-2 flex w-full items-center justify-center gap-2 rounded-[3px] px-3 py-2 text-xs font-medium"
          >
            <Check className="h-3.5 w-3.5" /> Save note
          </button>
        </div>
      )}
    </div>
  );
}

function PopButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "hover:bg-foreground/5 flex h-8 w-8 items-center justify-center rounded-[3px] transition-colors",
        active && "bg-signal text-signal-foreground hover:bg-signal",
      )}
    >
      {children}
    </button>
  );
}
