import { useEffect, useMemo, useState } from "react";
import { Flame } from "lucide-react";
import { computeStats, formatDuration, listSessions, type ReadingSession } from "@/lib/sessions";

/**
 * Compact reading stats strip: streak, today, all-time, pace and
 * a 30-day sparkline. Renders nothing until at least one session exists so a
 * fresh library isn't dominated by zeroes.
 */
export function StatsStrip({ sessions }: { sessions: ReadingSession[] }) {
  // Worked out while drawing, not in an effect: the strip then appears in the same commit as the
  // shelf around it, so nothing below it moves (see the shelf region in routes/index.tsx).
  const stats = useMemo(
    () => (sessions.length ? computeStats(sessions, Date.now()) : null),
    [sessions],
  );

  if (!stats) return null;

  const items = [
    { label: "Streak", value: `${stats.streak}d`, icon: true },
    { label: "Today", value: formatDuration(stats.todayMinutes) },
    { label: "All time", value: formatDuration(stats.totalMinutes) },
    {
      label: "Pace",
      value: stats.pagesPerHour ? `${stats.pagesPerHour} pg/h` : "—",
    },
    { label: "Sessions", value: `${stats.sessions}` },
  ];

  return (
    <section
      aria-label="Reading stats"
      className="flex flex-wrap items-end justify-between gap-6 border-b border-border py-5"
    >
      <dl className="flex flex-wrap items-end gap-x-8 gap-y-4">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
              {item.label}
            </dt>
            <dd className="mt-1 flex items-center gap-1.5 font-display text-2xl font-semibold tracking-tight">
              {item.icon && stats.streak > 0 && (
                <Flame className="h-4 w-4 text-signal-ink" aria-hidden />
              )}
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      <Sparkline values={stats.sparkline} />
    </section>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const peak = Math.max(1, ...values);
  return (
    <div
      className="flex h-10 items-end gap-[3px]"
      role="img"
      aria-label={`Minutes read each of the last ${values.length} days`}
    >
      {values.map((minutes, i) => (
        <span
          key={i}
          title={`${Math.round(minutes)} min`}
          className={
            minutes > 0 ? "w-[4px] rounded-[1px] bg-signal" : "w-[4px] rounded-[1px] bg-border"
          }
          style={{ height: `${Math.max(2, (minutes / peak) * 40)}px` }}
        />
      ))}
    </div>
  );
}

/** Loads every session once; the library page owns refresh timing. */
/**
 * The reading sessions, and whether they have been read yet, so the shelf can wait for them with the
 * books. A failed read counts as "read, none", so the shelf is never held back for good.
 */
export function useSessions(): { sessions: ReadingSession[]; ready: boolean } {
  const [state, setState] = useState<{ sessions: ReadingSession[]; ready: boolean }>({
    sessions: [],
    ready: false,
  });
  useEffect(() => {
    let cancelled = false;
    const settle = (sessions: ReadingSession[]) => {
      if (!cancelled) setState({ sessions, ready: true });
    };
    void listSessions().then(settle, () => settle([]));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
