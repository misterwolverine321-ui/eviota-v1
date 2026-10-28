import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { normalizeTags } from "@/lib/collections";

/**
 * Inline tag editing for a single book, used on the book card.
 */
export function TagEditor({
  tags,
  bookTitle,
  onChange,
}: {
  tags: string[];
  /** Names the book in each control, so six cards do not offer six identical "Add tag" buttons. */
  bookTitle?: string;
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addRef = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const of = bookTitle ? ` ${bookTitle}` : "";

  // The keyboard was in the field, which is about to disappear: once the button that opened it is
  // back on the page, give it the focus, so the next Tab starts from the same place.
  useEffect(() => {
    if (adding || !refocus.current) return;
    refocus.current = false;
    addRef.current?.focus();
  }, [adding]);

  /** `fromKeyboard`: Enter or Escape in the field, as opposed to clicking away. */
  const commit = (fromKeyboard = false) => {
    const next = normalizeTags([...tags, draft]);
    refocus.current = fromKeyboard;
    setDraft("");
    setAdding(false);
    if (next.length !== tags.length) onChange(next);
  };

  return (
    <div
      role="group"
      aria-label={`Tags${bookTitle ? ` for ${bookTitle}` : ""}`}
      className="mt-1.5 flex flex-wrap items-center gap-1"
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-[2px] text-[11px] text-muted-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}${bookTitle ? ` from ${bookTitle}` : ""}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="transition-colors hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Without this, the same Enter goes on to "press" the button focus has just moved
              // to, and the field opens again.
              e.preventDefault();
              commit(true);
            }
            if (e.key === "Escape") {
              refocus.current = true;
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder="tag"
          aria-label={`New tag${bookTitle ? ` for ${bookTitle}` : ""}`}
          className="w-16 rounded-full border border-input bg-card px-2 py-[2px] text-[11px] outline-none focus:border-foreground/40"
        />
      ) : (
        <button
          ref={addRef}
          type="button"
          onClick={() => setAdding(true)}
          aria-label={`Add tag to${of || " book"}`}
          className="inline-flex items-center rounded-full border border-dashed border-border px-1.5 py-[2px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
