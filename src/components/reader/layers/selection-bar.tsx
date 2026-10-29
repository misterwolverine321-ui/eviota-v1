import { useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Highlighter,
  StickyNote,
  Strikethrough,
  Trash2,
  Underline,
  X,
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
 * Selection actions, shown in the reader's top bar while text is selected.
 *
 * They used to float over the selection, where iOS also puts its own Copy, Look Up and Translate
 * menu, so the two covered each other. In the bar they sit clear of that menu. It is the single
 * write surface for text annotations: it never persists anything, every action calls back into
 * the reader.
 */
export function SelectionBar({
  selection,
  existing,
  theme,
  onMark,
  onNote,
  onDelete,
  onDefine,
  onDismiss,
}: {
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
  const [noteMode, setNoteMode] = useState(false);
  const [draft, setDraft] = useState(existing?.note ?? "");
  const [color, setColor] = useState<AnnotationColor>(existing?.color ?? "yellow");

  useEffect(() => {
    setNoteMode(false);
    setDraft(existing?.note ?? "");
    setColor(existing?.color ?? "yellow");
  }, [selection, existing]);

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
      role="toolbar"
      aria-label="Selection actions"
      className="mx-auto flex w-full flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Colour" className="flex items-center gap-2">
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
                "h-7 w-7 shrink-0 rounded-full border transition-transform hover:scale-110",
                color === c && "ring-signal ring-2 ring-offset-1",
              )}
              style={{ background: ANNOTATION_COLORS[c], borderColor: theme.line }}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Close selection actions"
          onClick={onDismiss}
          className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-foreground/5 pointer-fine:h-8 pointer-fine:w-8"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {MARKS.map((m) => (
          <ActionButton
            key={m.type}
            label={m.label}
            active={existing?.type === m.type}
            onClick={() => onMark(m.type, color)}
          >
            <m.icon className="h-4 w-4" />
          </ActionButton>
        ))}
        <ActionButton
          label={existing?.note ? "Edit note" : "Add note"}
          active={noteMode}
          onClick={() => setNoteMode((v) => !v)}
        >
          <StickyNote className="h-4 w-4" />
        </ActionButton>
        {onDefine && (
          <ActionButton label="Define" onClick={onDefine}>
            <BookOpen className="h-4 w-4" />
          </ActionButton>
        )}
        <ActionButton label="Copy text" onClick={copy}>
          <Copy className="h-4 w-4" />
        </ActionButton>
        {existing && (
          <ActionButton label="Delete" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </ActionButton>
        )}
      </div>

      {noteMode && (
        <div className="flex flex-col gap-2">
          {selection.text ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed italic opacity-60">
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
            className="bg-signal text-signal-foreground flex w-full items-center justify-center gap-2 rounded-[3px] px-3 py-2 text-xs font-medium"
          >
            <Check className="h-3.5 w-3.5" /> Save note
          </button>
        </div>
      )}
    </div>
  );
}

function ActionButton({
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
        "hover:bg-foreground/5 flex h-10 w-10 items-center justify-center rounded-[3px] transition-colors pointer-fine:h-8 pointer-fine:w-8",
        active && "bg-signal text-signal-foreground hover:bg-signal",
      )}
    >
      {children}
    </button>
  );
}
