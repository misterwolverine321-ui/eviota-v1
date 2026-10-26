/**
 * Phase 7.1 — reading sessions and derived stats (DB v4).
 *
 * A session opens when the reader mounts, ticks while the tab is visible and
 * the user is active (idle > 60s pauses accrual), and closes on unmount or
 * tab hide. Everything below the tracker is pure so the stats can be unit
 * tested without IndexedDB.
 */
import { getDb } from "./db";

export interface ReadingSession {
  id: string;
  bookId: string;
  startedAt: number;
  endedAt: number;
  /** Accrued active milliseconds — always ≤ endedAt - startedAt. */
  activeMs: number;
  pagesRead: number;
  words: number;
  /** Progress fraction at session open / last tick, for rate estimates. */
  fromFraction: number;
  toFraction: number;
}

export const DAY_MS = 86_400_000;
export const IDLE_MS = 60_000;

const hasIdb = () => typeof indexedDB !== "undefined";

export async function putSession(session: ReadingSession): Promise<void> {
  if (!hasIdb()) return;
  const db = await getDb();
  await db.put("sessions", session);
}

export async function listSessions(): Promise<ReadingSession[]> {
  if (!hasIdb()) return [];
  const db = await getDb();
  return (await db.getAll("sessions")) as ReadingSession[];
}

export async function listSessionsForBook(bookId: string): Promise<ReadingSession[]> {
  if (!hasIdb()) return [];
  const db = await getDb();
  return (await db.getAllFromIndex("sessions", "bookId", bookId)) as ReadingSession[];
}

export async function clearSessions(): Promise<void> {
  if (!hasIdb()) return;
  const db = await getDb();
  await db.clear("sessions");
}

// ---------------------------------------------------------------- pure stats

export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function sessionMinutes(s: ReadingSession): number {
  return Math.max(0, s.activeMs) / 60_000;
}

/** Minutes read per calendar day, most recent last, `days` entries long. */
export function minutesPerDay(
  sessions: ReadingSession[],
  days: number,
  now: number,
): { day: string; minutes: number }[] {
  const buckets = new Map<string, number>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    buckets.set(key, (buckets.get(key) ?? 0) + sessionMinutes(s));
  }
  const out: { day: string; minutes: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(now - i * DAY_MS);
    out.push({ day: key, minutes: Math.round((buckets.get(key) ?? 0) * 10) / 10 });
  }
  return out;
}

/** Consecutive days with any reading, counting back from today (or yesterday). */
export function currentStreak(sessions: ReadingSession[], now: number): number {
  const active = new Set(sessions.filter((s) => s.activeMs > 0).map((s) => dayKey(s.startedAt)));
  if (!active.size) return 0;
  let cursor = now;
  if (!active.has(dayKey(cursor))) {
    cursor -= DAY_MS;
    if (!active.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (active.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY_MS;
  }
  return streak;
}

export interface LibraryStats {
  totalMinutes: number;
  todayMinutes: number;
  streak: number;
  pagesPerHour: number;
  sessions: number;
  sparkline: number[];
}

export function computeStats(sessions: ReadingSession[], now: number = Date.now()): LibraryStats {
  const totalMinutes = sessions.reduce((sum, s) => sum + sessionMinutes(s), 0);
  const today = dayKey(now);
  const todayMinutes = sessions
    .filter((s) => dayKey(s.startedAt) === today)
    .reduce((sum, s) => sum + sessionMinutes(s), 0);
  const pages = sessions.reduce((sum, s) => sum + Math.max(0, s.pagesRead), 0);
  const hours = totalMinutes / 60;
  return {
    totalMinutes: Math.round(totalMinutes),
    todayMinutes: Math.round(todayMinutes),
    streak: currentStreak(sessions, now),
    pagesPerHour: hours > 0 ? Math.round(pages / hours) : 0,
    sessions: sessions.length,
    sparkline: minutesPerDay(sessions, 30, now).map((d) => d.minutes),
  };
}

/**
 * Minutes left in a book, from the trailing 5 sessions' progress rate.
 * Returns null when there isn't enough signal to be honest about it.
 */
export function estimateRemainingMinutes(
  sessions: ReadingSession[],
  fraction: number,
): number | null {
  if (fraction >= 0.999) return 0;
  const recent = sessions
    .filter((s) => s.activeMs >= 30_000 && s.toFraction > s.fromFraction)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5);
  if (!recent.length) return null;
  const gained = recent.reduce((sum, s) => sum + (s.toFraction - s.fromFraction), 0);
  const minutes = recent.reduce((sum, s) => sum + sessionMinutes(s), 0);
  if (gained <= 0 || minutes <= 0) return null;
  const rate = gained / minutes; // fraction per minute
  const remaining = Math.max(0, 1 - fraction) / rate;
  if (!Number.isFinite(remaining)) return null;
  return Math.round(remaining);
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ------------------------------------------------------------------ tracker

export interface TrackerDeps {
  now?: () => number;
  persist?: (s: ReadingSession) => void;
  isVisible?: () => boolean;
}

/**
 * Accrues active reading time. `ping()` is called on any user activity and on
 * a heartbeat; time only accrues when the previous ping is within IDLE_MS and
 * the document is visible.
 */
export class SessionTracker {
  readonly session: ReadingSession;
  private last: number;
  private readonly now: () => number;
  private readonly persist: (s: ReadingSession) => void;
  private readonly isVisible: () => boolean;
  private lastActivity: number;
  private closed = false;

  constructor(bookId: string, fraction: number, deps: TrackerDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.persist = deps.persist ?? ((s) => void putSession(s));
    this.isVisible =
      deps.isVisible ??
      (() => typeof document === "undefined" || document.visibilityState === "visible");
    const started = this.now();
    this.last = started;
    this.lastActivity = started;
    this.session = {
      id: `${bookId}:${started}:${Math.random().toString(36).slice(2, 8)}`,
      bookId,
      startedAt: started,
      endedAt: started,
      activeMs: 0,
      pagesRead: 0,
      words: 0,
      fromFraction: fraction,
      toFraction: fraction,
    };
  }

  /** Mark user activity (input, scroll, page turn). */
  activity(): void {
    this.lastActivity = this.now();
  }

  /** Heartbeat: accrue the elapsed slice if the reader was active and visible. */
  tick(): void {
    if (this.closed) return;
    const t = this.now();
    const elapsed = t - this.last;
    this.last = t;
    if (elapsed <= 0) return;
    if (!this.isVisible()) return;
    if (t - this.lastActivity > IDLE_MS) return;
    this.session.activeMs += elapsed;
    this.session.endedAt = t;
  }

  /** Record reading progress; a changed page counts as activity. */
  report(fraction: number, page?: number): void {
    if (this.closed) return;
    this.activity();
    this.tick();
    if (Number.isFinite(fraction)) this.session.toFraction = fraction;
    if (page != null && page !== this.lastPage) {
      if (this.lastPage != null) this.session.pagesRead += Math.abs(page - this.lastPage);
      this.lastPage = page;
    }
  }

  private lastPage: number | null = null;

  /** Persist the accrued session (skipping trivially short ones). */
  flush(): void {
    this.tick();
    if (this.session.activeMs < 5_000) return;
    this.persist({ ...this.session });
  }

  close(): void {
    this.flush();
    this.closed = true;
  }
}
