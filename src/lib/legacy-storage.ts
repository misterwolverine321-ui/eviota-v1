/**
 * One-time carry-over of small localStorage values written before the app was
 * renamed from Folio to Nawiri and then to Eviota. Only preferences are moved (theme, reader
 * settings, install-banner dismissals, per-book read-aloud positions); the
 * Wiktionary/Wikipedia lookup cache is derived data and is simply dropped.
 *
 * It never overwrites a value the new key already holds, and it removes each
 * old key it handled so the work happens once.
 */

const EXACT: readonly (readonly [string, string])[] = [
  ["folio-theme", "nawiri-theme"],
  ["folio-reader-settings", "nawiri-reader-settings"],
  ["folio-install-dismissed", "nawiri-install-dismissed"],
  ["folio-ios-install-dismissed", "nawiri-ios-install-dismissed"],
];

const PREFIX_MOVED: readonly (readonly [string, string])[] = [
  ["folio-tts-position:", "nawiri-tts-position:"],
];

const PREFIX_DROPPED: readonly string[] = ["folio-lookup:"];

/** Returns how many legacy keys were handled (moved or dropped). */
export function migrateLegacyStorage(storage?: Storage): number {
  let handled = 0;
  try {
    const store = storage ?? localStorage;

    for (const [from, to] of EXACT) {
      const value = store.getItem(from);
      if (value === null) continue;
      if (store.getItem(to) === null) store.setItem(to, value);
      store.removeItem(from);
      handled++;
    }

    // Collect first: mutating while iterating by index skips keys.
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      const moved = PREFIX_MOVED.find(([from]) => key.startsWith(from));
      if (moved) {
        const next = moved[1] + key.slice(moved[0].length);
        const value = store.getItem(key);
        if (value !== null && store.getItem(next) === null) store.setItem(next, value);
        store.removeItem(key);
        handled++;
      } else if (PREFIX_DROPPED.some((p) => key.startsWith(p))) {
        store.removeItem(key);
        handled++;
      }
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); nothing to do.
  }
  return handled;
}
