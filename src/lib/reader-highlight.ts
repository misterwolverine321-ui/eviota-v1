import { highlightFill, type ResolvedReaderTheme } from "./reader-theme-resolve";

/** Current reader surface, set by the reader shell so painters pick the right tint. */
let current: ResolvedReaderTheme = "paper";
/**
 * False until the first call. The stylesheet defaults follow the APP theme, but
 * the reader theme can differ (a Paper page inside a dark app), so the very
 * first call must write the variables even when it matches `current`.
 */
let applied = false;
const listeners = new Set<() => void>();

export function setReaderHighlightTheme(theme: ResolvedReaderTheme): void {
  const changed = theme !== current;
  if (!changed && applied) return;
  current = theme;
  applied = true;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--reader-hit", highlightFill(theme));
    document.documentElement.style.setProperty("--reader-hit-strong", highlightFill(theme));
  }
  if (changed) listeners.forEach((l) => l());
}

export function readerHighlightTheme(): ResolvedReaderTheme {
  return current;
}

export function hitFill(): string {
  return highlightFill(current);
}

export function onReaderHighlightTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
