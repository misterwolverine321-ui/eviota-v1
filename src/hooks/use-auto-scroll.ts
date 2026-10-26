import { useCallback, useEffect, useRef, useState } from "react";

/** Auto-scroll speed bounds, in CSS pixels per second. */
export const SCROLL_SPEED_MIN = 10;
export const SCROLL_SPEED_MAX = 200;
export const SCROLL_SPEED_STEP = 5;

/** How long a touch, click, wheel or key press holds the drive still. */
const IDLE_DELAY = 1400;

export interface AutoScrollController {
  running: boolean;
  /** True while the drive is held by user input. */
  held: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Continuous auto-scroll driver.
 *
 * A rAF loop accumulates fractional pixels and hands whole ones to the
 * engine's `scrollByPixels`, so slow speeds stay smooth instead of stuttering
 * one pixel per frame. Any interaction with the reading surface — pointer,
 * wheel, touch or key — suspends the drive until the reader is idle again, so
 * you can flick back a paragraph without fighting the animation.
 */
export function useAutoScroll({
  speed,
  scrollBy,
  enabled = true,
}: {
  speed: number;
  scrollBy: (pixels: number) => void;
  enabled?: boolean;
}): AutoScrollController {
  const [running, setRunning] = useState(false);
  const [held, setHeld] = useState(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const scrollRef = useRef(scrollBy);
  scrollRef.current = scrollBy;
  const heldUntil = useRef(0);
  const carry = useRef(0);

  const stop = useCallback(() => {
    setRunning(false);
    setHeld(false);
    carry.current = 0;
  }, []);

  const start = useCallback(() => {
    carry.current = 0;
    setRunning(true);
  }, []);

  const toggle = useCallback(() => {
    setRunning((r) => {
      carry.current = 0;
      return !r;
    });
  }, []);

  // An engine that loses the capability (a remount into another format) must
  // not keep scrolling.
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => {
    if (!running || !enabled || typeof window === "undefined") return;

    const nudge = () => {
      heldUntil.current = performance.now() + IDLE_DELAY;
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      nudge();
    };
    window.addEventListener("pointerdown", nudge, true);
    window.addEventListener("wheel", nudge, { passive: true, capture: true });
    window.addEventListener("touchstart", nudge, { passive: true, capture: true });
    window.addEventListener("keydown", onKey, true);

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(120, now - last);
      last = now;
      const paused = now < heldUntil.current;
      setHeld((cur) => (cur === paused ? cur : paused));
      if (!paused) {
        carry.current += (speedRef.current * dt) / 1000;
        const whole = Math.trunc(carry.current);
        if (whole >= 1) {
          carry.current -= whole;
          scrollRef.current(whole);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", nudge, true);
      window.removeEventListener("wheel", nudge, true);
      window.removeEventListener("touchstart", nudge, true);
      window.removeEventListener("keydown", onKey, true);
      setHeld(false);
    };
  }, [running, enabled]);

  return { running, held, start, stop, toggle };
}
