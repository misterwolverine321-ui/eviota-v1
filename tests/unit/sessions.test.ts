import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  computeStats,
  currentStreak,
  estimateRemainingMinutes,
  formatDuration,
  minutesPerDay,
  type ReadingSession,
} from "@/lib/sessions";

const NOW = new Date("2026-03-10T12:00:00").getTime();

function session(partial: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: Math.random().toString(36).slice(2),
    bookId: "b1",
    startedAt: NOW,
    endedAt: NOW + 600_000,
    activeMs: 600_000,
    pagesRead: 10,
    fromFraction: 0,
    toFraction: 0.1,
    ...partial,
  } as ReadingSession;
}

describe("currentStreak", () => {
  it("is zero without sessions", () => {
    expect(currentStreak([], NOW)).toBe(0);
  });

  it("counts consecutive days back from today", () => {
    const rows = [0, 1, 2].map((d) => session({ startedAt: NOW - d * DAY_MS }));
    expect(currentStreak(rows, NOW)).toBe(3);
  });

  it("tolerates a gap of today when yesterday was read", () => {
    const rows = [1, 2].map((d) => session({ startedAt: NOW - d * DAY_MS }));
    expect(currentStreak(rows, NOW)).toBe(2);
  });

  it("breaks on a missing day", () => {
    const rows = [0, 3].map((d) => session({ startedAt: NOW - d * DAY_MS }));
    expect(currentStreak(rows, NOW)).toBe(1);
  });
});

describe("minutesPerDay", () => {
  it("returns one bucket per day, oldest first", () => {
    const rows = minutesPerDay([session()], 7, NOW);
    expect(rows).toHaveLength(7);
    expect(rows[6]?.minutes).toBe(10);
    expect(rows[0]?.minutes).toBe(0);
  });
});

describe("computeStats", () => {
  it("aggregates totals, pace and sparkline", () => {
    const stats = computeStats(
      [session(), session({ startedAt: NOW - DAY_MS, pagesRead: 20 })],
      NOW,
    );
    expect(stats.totalMinutes).toBe(20);
    expect(stats.todayMinutes).toBe(10);
    expect(stats.sessions).toBe(2);
    expect(stats.pagesPerHour).toBe(90);
    expect(stats.sparkline).toHaveLength(30);
  });
});

describe("estimateRemainingMinutes", () => {
  it("returns 0 for a finished book", () => {
    expect(estimateRemainingMinutes([], 1)).toBe(0);
  });

  it("returns null without usable sessions", () => {
    expect(estimateRemainingMinutes([session({ activeMs: 1_000 })], 0.2)).toBeNull();
  });

  it("extrapolates from the trailing rate", () => {
    // 10 minutes bought 10% → 90% left ≈ 90 minutes.
    expect(estimateRemainingMinutes([session()], 0.1)).toBe(90);
  });
});

describe("formatDuration", () => {
  it("formats sub-minute, minutes and hours", () => {
    expect(formatDuration(0.4)).toBe("<1m");
    expect(formatDuration(42)).toBe("42m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(135)).toBe("2h 15m");
  });
});
