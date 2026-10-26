import { useEffect, useRef } from "react";
import { SessionTracker } from "@/lib/sessions";

const HEARTBEAT_MS = 15_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Phase 7.1 — opens a reading session for the mounted book and returns a
 * reporter the kernel calls on every progress update.
 *
 * The tracker itself is pure-ish (see `sessions.ts`); this hook only owns the
 * browser wiring: an activity listener set, a heartbeat, a flush when the tab
 * hides, and a close on unmount.
 */
export function useReadingSession(
  bookId: string,
  initialFraction: number,
): (fraction: number, page?: number) => void {
  const trackerRef = useRef<SessionTracker | null>(null);
  // Read once: a later progress update must not restart the session.
  const startFraction = useRef(initialFraction);

  useEffect(() => {
    const tracker = new SessionTracker(bookId, startFraction.current);
    trackerRef.current = tracker;

    const activity = () => tracker.activity();
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, activity, { passive: true });
    }

    const beat = setInterval(() => tracker.tick(), HEARTBEAT_MS);

    // Hiding the tab is the last reliable moment to write on mobile.
    const onVisibility = () => {
      tracker.tick();
      if (document.visibilityState === "hidden") tracker.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onVisibility);

    return () => {
      clearInterval(beat);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, activity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onVisibility);
      tracker.close();
      trackerRef.current = null;
    };
  }, [bookId]);

  return (fraction: number, page?: number) => {
    trackerRef.current?.report(fraction, page);
  };
}
