import { useCallback, useEffect, useRef, useState } from "react";

/** Quiet time before the bars retreat. */
const HIDE_DELAY = 4500;
/** Longer grace right after opening a book, so the chrome is discoverable. */
const FIRST_DELAY = 6000;

/**
 * Immersive chrome controller.
 *
 * Deliberately tap-driven: moving the pointer over the reading text never
 * reveals the bars. Once they are hidden, a tap on the reading surface or on
 * an edge strip (or a keyboard action / drawer) brings them back, and a mouse
 * resting on an edge strip does too.
 *  - the bars appear on open, then retreat after a quiet delay,
 *  - page turns from the keyboard stay immersive (they call `keepHidden`),
 *  - a drawer (`pinned`) freezes them visible.
 */
export function useImmersiveChrome(pinned: boolean) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const arm = useCallback(() => {
    clear();
    if (pinned) return;
    const delay = first.current ? FIRST_DELAY : HIDE_DELAY;
    first.current = false;
    timer.current = setTimeout(() => setVisible(false), delay);
  }, [pinned]);

  const show = useCallback(() => {
    setVisible(true);
    arm();
  }, [arm]);

  const hide = useCallback(() => {
    clear();
    setVisible(false);
  }, []);

  /**
   * Page turns should not flash the bars back on. If they are already hidden
   * this is a no-op; if they are visible the quiet timer simply restarts.
   */
  const keepHidden = useCallback(() => {
    setVisible((v) => {
      if (v) arm();
      return v;
    });
  }, [arm]);

  const toggle = useCallback(() => {
    setVisible((v) => {
      if (v) {
        clear();
        return false;
      }
      arm();
      return true;
    });
  }, [arm]);

  useEffect(() => {
    if (pinned) {
      clear();
      setVisible(true);
      return;
    }
    arm();
    return clear;
  }, [pinned, arm]);

  return { visible, show, hide, toggle, keepHidden };
}
