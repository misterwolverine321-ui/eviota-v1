/**
 * Reduced motion. A person who has asked their system for less motion (a vestibular disorder, or
 * plain preference) gets jumps instead of glides, and no transitions. The interface itself is
 * covered by one media block in `styles.css`; this file is for what CSS cannot reach: scroll calls
 * made from script, and the documents inside the reader iframes.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the person asked for reduced motion. False where the browser cannot say. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * The `behavior` for a scroll the app starts (a contents entry, a search hit, a page-sized step):
 * a glide normally, a jump under reduced motion. Read at the moment of the scroll, so a change of
 * the system setting applies without a reload.
 */
export function smoothScroll(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/**
 * The same rule for a document that is not ours (a book in an iframe): its own animations and
 * transitions stop, and it does not glide to an anchor. The media query is evaluated by the iframe
 * against the same system setting.
 */
export const REDUCED_MOTION_BOOK_CSS = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
