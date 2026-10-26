import { useEffect, useState } from "react";

/**
 * The latest `value` once it has stopped changing for `ms` milliseconds.
 *
 * For text a screen reader announces: reading progress changes many times a second while a page
 * scrolls, and a live region that follows it would queue an announcement for every step. A live
 * region fed by this hook speaks once, after the reader has settled.
 */
export function useSettledValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
