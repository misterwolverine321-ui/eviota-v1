/**
 * The book is drawn in an iframe, and the app's own `@font-face` rules do not reach into it. Without
 * these rules a book set in Lora falls back to whichever serif the device has (Charter, Georgia), so
 * the same book looked different on each device. This copies the bundled Lora and Inter faces into
 * the book's stylesheet. Their URLs are made absolute first, because a book's base address is a
 * `blob:` URL where a relative path does not resolve. The book's policy allows fonts from the app's
 * own origin (`'self'`) and from nowhere else.
 */

/** Families a book can be set in (see FONT_STACKS in reader-settings.ts). */
export const BOOK_FONT_FAMILIES: readonly string[] = ["Lora Variable", "Inter Variable"];

/** One `@font-face` rule, as the browser reports it. */
export interface FontFaceRule {
  family: string;
  src: string;
  style: string;
  weight: string;
  range: string;
}

/** `@font-face` CSS for the rules that name a book font, with every `url()` resolved against `base`. */
export function bookFontFaceCss(faces: readonly FontFaceRule[], base: string): string {
  return faces
    .filter((f) => BOOK_FONT_FAMILIES.includes(f.family) && f.src.includes("url("))
    .map((f) => {
      const src = f.src.replace(
        /url\(\s*(["']?)([^"')]+)\1\s*\)/g,
        (_match, _quote: string, url: string) => `url("${new URL(url, base).href}")`,
      );
      const decls = [
        `font-family: "${f.family}"`,
        `src: ${src}`,
        `font-style: ${f.style || "normal"}`,
        `font-weight: ${f.weight || "400"}`,
        "font-display: swap",
      ];
      if (f.range) decls.push(`unicode-range: ${f.range}`);
      return `@font-face { ${decls.join("; ")}; }`;
    })
    .join("\n");
}

let cached: string | null = null;

/** The bundled book faces, read once from the app's stylesheets. Empty until those are loaded. */
export function bookFontFaces(): string {
  if (cached !== null) return cached;
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a sheet from another origin cannot be read
    }
    const base = sheet.href ?? document.baseURI;
    const faces: FontFaceRule[] = [];
    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const s = (rule as CSSFontFaceRule).style;
      faces.push({
        family: s.getPropertyValue("font-family").replace(/["']/g, "").trim(),
        src: s.getPropertyValue("src"),
        style: s.getPropertyValue("font-style"),
        weight: s.getPropertyValue("font-weight"),
        range: s.getPropertyValue("unicode-range"),
      });
    }
    const css = bookFontFaceCss(faces, base);
    if (css) parts.push(css);
  }
  const out = parts.join("\n");
  if (out) cached = out;
  return out;
}
