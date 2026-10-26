import { LOGO_VIEWBOX, SYMBOL_FOLD_PATH, SYMBOL_PAGE_PATH, WORDMARK_PATH } from "./paths";

interface LogoProps {
  className?: string;
  /** Accessible name. The visible text is outlines, so this is what a screen reader hears. */
  title?: string;
}

/**
 * The Eviota symbol and wordmark as one inline SVG. Every letter is an
 * outline (see `scripts/brand/make_brand.py`), so nothing depends on a font.
 * The page and the letters follow the surrounding text colour; the fold takes
 * the signal red for the current theme.
 *
 * Size it with height only (`h-7 w-auto`): the width/height attributes carry
 * the aspect ratio, which keeps Safari from collapsing an auto-width SVG.
 */
export function EviotaLogo({ className, title = "Eviota" }: LogoProps) {
  return (
    <svg
      viewBox={`0 0 ${LOGO_VIEWBOX.width} ${LOGO_VIEWBOX.height}`}
      width={LOGO_VIEWBOX.width}
      height={LOGO_VIEWBOX.height}
      role="img"
      aria-label={title}
      className={className}
    >
      <path d={SYMBOL_PAGE_PATH} fill="currentColor" fillRule="evenodd" />
      <path d={SYMBOL_FOLD_PATH} style={{ fill: "var(--signal-ink)" }} />
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}

/** The symbol alone: a page with an N cut out of it and a red folded corner. */
export function EviotaSymbol({ className, title = "Eviota" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 320 320"
      width={320}
      height={320}
      role="img"
      aria-label={title}
      className={className}
    >
      <path d={SYMBOL_PAGE_PATH} fill="currentColor" fillRule="evenodd" />
      <path d={SYMBOL_FOLD_PATH} style={{ fill: "var(--signal-ink)" }} />
    </svg>
  );
}
