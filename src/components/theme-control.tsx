import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

/** Segmented System / Light / Dark control used in Settings. */
export function AppearanceControl() {
  const { choice, setChoice } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex max-w-full flex-wrap rounded-[3px] border border-border p-0.5"
    >
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={choice === id}
          onClick={() => setChoice(id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[2px] px-2 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-signal-ink min-[360px]:gap-2 min-[360px]:px-3",
            choice === id
              ? "bg-signal text-signal-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Small header button: cycles System → Light → Dark. */
export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const idx = OPTIONS.findIndex((o) => o.id === choice);
  const next = OPTIONS[(idx + 1) % OPTIONS.length];
  const { Icon, label } = OPTIONS[idx];
  return (
    <button
      type="button"
      onClick={() => setChoice(next.id)}
      aria-label={`Theme: ${label}. Switch to ${next.label}`}
      title={`Theme: ${label}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-signal-ink"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
