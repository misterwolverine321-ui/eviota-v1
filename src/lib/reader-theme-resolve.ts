/** Pure resolution of the reader theme and PDF night-scan state. */
export type StoredReaderTheme = "match" | "paper" | "sepia" | "dusk";
export type ResolvedReaderTheme = Exclude<StoredReaderTheme, "match">;

/** "match" follows the app: Paper when light, Dusk when dark. */
export function resolveReaderTheme(
  id: StoredReaderTheme,
  app: "light" | "dark",
): ResolvedReaderTheme {
  if (id === "match") return app === "dark" ? "dusk" : "paper";
  return id;
}

/** Tri-state night scan: null = auto (on for Dusk); an explicit choice wins. */
export function resolvePdfInvert(pdfInvert: boolean | null, theme: ResolvedReaderTheme): boolean {
  return pdfInvert ?? theme === "dusk";
}

/** Search/spoken highlight fill for the resolved reader theme. */
export function highlightFill(theme: ResolvedReaderTheme): string {
  return theme === "dusk" ? "rgba(255,85,65,0.46)" : "rgba(222,45,30,0.28)";
}
