interface RevealBandProps {
  /** True while the bars are hidden (and no drawer is open). */
  active: boolean;
  onReveal: () => void;
  color: string;
  /** Which bar the strip brings back. */
  edge?: "top" | "bottom";
}

/**
 * A strip along the top or bottom of the reading surface that brings its bar back.
 *
 * It reveals on `click`, not on pointer-down: if the bars slid in under the finger before the
 * tap finished, the tap's click could land on a button that appeared there (the back arrow sits
 * at the top left). With a mouse, moving onto the strip reveals the bar as well, so a desktop
 * reader needs no click at all. It is a real button, so it works from the keyboard and is
 * announced; the grab handle is only a hint and is hidden from assistive technology.
 */
export function RevealBand({ active, onReveal, color, edge = "top" }: RevealBandProps) {
  if (!active) return null;
  const bottom = edge === "bottom";
  return (
    <button
      type="button"
      aria-label={bottom ? "Show page controls" : "Show reading menu"}
      onClick={onReveal}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onReveal();
      }}
      className={
        bottom
          ? "absolute inset-x-0 bottom-0 z-10 flex h-14 items-end justify-center pb-[env(safe-area-inset-bottom)] focus-visible:outline-2 focus-visible:outline-signal"
          : "absolute inset-x-0 top-0 z-10 flex h-12 items-start justify-center focus-visible:outline-2 focus-visible:outline-signal"
      }
      style={{ color }}
    >
      <span
        aria-hidden="true"
        className={`${bottom ? "mb-2" : "mt-2"} h-1 w-9 rounded-full bg-current opacity-30`}
      />
    </button>
  );
}
