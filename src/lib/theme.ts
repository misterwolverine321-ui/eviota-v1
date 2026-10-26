import { useCallback, useEffect, useState } from "react";

/** App-wide colour theme. Client-only; stored in localStorage. */
export type ThemeChoice = "light" | "dark" | "system";
import { THEME_COLORS, THEME_KEY } from "./theme-boot";

export { THEME_BOOT_SCRIPT, THEME_COLORS, THEME_KEY } from "./theme-boot";

export function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? (systemDark() ? "dark" : "light") : choice;
}

export function applyTheme(choice: ThemeChoice) {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", THEME_COLORS[resolved]));
  return resolved;
}

const EVENT = "eviota-theme-change";

/** Shared hook: every caller stays in sync (same tab and other tabs). */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = (event?: Event) => {
      const eventChoice =
        event instanceof CustomEvent &&
        (event.detail === "light" || event.detail === "dark" || event.detail === "system")
          ? event.detail
          : null;
      const c = eventChoice ?? readThemeChoice();
      setChoiceState(c);
      setResolved(applyTheme(c));
    };
    sync();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onStorage = (e: StorageEvent) => e.key === THEME_KEY && sync();
    mq.addEventListener("change", sync);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setChoice = useCallback((c: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_KEY, c);
    } catch {
      /* private mode: still apply for this session */
    }
    applyTheme(c);
    setChoiceState(c);
    setResolved(applyTheme(c));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: c }));
  }, []);

  return { choice, resolved, setChoice };
}
