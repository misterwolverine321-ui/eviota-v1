/**
 * A short, subtle slide of the reading surface when a page turns. It tells the eye which way the
 * page went without holding it up: about 180 ms, 16 px, with a slight fade. Reduced motion turns
 * it off, as the rest of the app does.
 *
 * Every engine calls this before it turns, so the cue works the same for text, e-books, PDFs,
 * scans and comics. The surface is found by its `data-reading-surface` attribute.
 */
const DURATION_MS = 180;
const DISTANCE_PX = 16;

export function cuePageTurn(dir: 1 | -1): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const surface = document.querySelector<HTMLElement>("[data-reading-surface]");
  if (!surface || typeof surface.animate !== "function") return;
  // Forward: the new page arrives from the right. Back: from the left.
  surface.animate(
    [
      { transform: `translate3d(${dir * DISTANCE_PX}px, 0, 0)`, opacity: 0.55 },
      { transform: "translate3d(0, 0, 0)", opacity: 1 },
    ],
    { duration: DURATION_MS, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
  );
}
