import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReaderTheme } from "@/lib/reader-settings";

/** Shared reader chrome primitives. Used by the shell and every drawer tab. */

export function IconButton({
  children,
  onClick,
  label,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal disabled:opacity-30 pointer-fine:h-8 pointer-fine:w-8",
        active && "bg-signal text-signal-foreground hover:bg-signal",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A labelled cluster of controls. The label is a real heading (level 3, under the drawer's level 2)
 * and names the group, so "serif" or "Justified" is announced with "Typeface" or "Alignment" and a
 * screen-reader user can jump from section to section by heading.
 */
export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="mb-5" role="group" aria-labelledby={id}>
      <h3
        id={id}
        className="mb-2 font-mono text-[11px] font-normal tracking-[0.18em] uppercase opacity-55"
      >
        {label}
      </h3>
      {children}
    </div>
  );
}

export function Stepper({
  label,
  value,
  onDec,
  onInc,
  onReset,
  theme,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  onReset?: () => void;
  theme: Pick<ReaderTheme, "line">;
}) {
  return (
    <Group label={label}>
      <div
        className="flex items-center justify-between rounded-[3px] border px-1"
        style={{ borderColor: theme.line }}
      >
        <button
          type="button"
          onClick={onDec}
          aria-label={`Decrease ${label}`}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-foreground/5 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            aria-label={`${value}, reset ${label}`}
            className="font-mono text-xs tracking-widest tabular-nums pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            {value}
          </button>
        ) : (
          // Nothing to reset: the value is text, not a button that does nothing.
          <span aria-hidden="true" className="font-mono text-xs tracking-widest tabular-nums">
            {value}
          </span>
        )}
        <button
          type="button"
          onClick={onInc}
          aria-label={`Increase ${label}`}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-foreground/5 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* The new value is spoken after each press; the visible one is not a live region because
          pressing "Decrease" would otherwise read out the whole control. */}
      <span role="status" className="sr-only">
        {label} {value}
      </span>
    </Group>
  );
}

/** Equal-width segmented control over a small option set. */
export function Segments<T extends string>({
  options,
  value,
  onChange,
  theme,
  labelFor,
  styleFor,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  theme: Pick<ReaderTheme, "line"> & Partial<Pick<ReaderTheme, "ink">>;
  labelFor?: (v: T) => string;
  styleFor?: (v: T) => React.CSSProperties;
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={cn(
            "flex-1 rounded-[3px] border px-2 py-2 text-xs capitalize transition-colors pointer-coarse:min-h-11",
            value === opt ? "border-signal-ink text-signal-ink" : "hover:bg-foreground/5",
          )}
          style={{
            borderColor: value === opt ? undefined : theme.line,
            color: value === opt ? undefined : theme.ink,
            ...styleFor?.(opt),
          }}
        >
          {labelFor?.(opt) ?? opt}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-8 text-center text-xs leading-relaxed opacity-55">{children}</p>;
}
