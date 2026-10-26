interface RevealBandProps {
  /** True while the bars are hidden (and no drawer is open). */
  active: boolean;
  onReveal: () => void;
  color: string;
}

/**
 * A strip along the top of the reading surface that brings the bars back.
 *
 * It reveals on `click`, not on pointer-down: if the bars slid in under the
 * finger before the tap finished, the tap's click could land on the button that
 * appeared there (the back arrow sits at the top left). It is a real button, so
 * it works from the keyboard and is announced; the small grab handle is only a
 * hint and is hidden from assistive technology.
 */
export function RevealBand({ active, onReveal, color }: RevealBandProps) {
  if (!active) return null;
  return (
    <button
      type="button"
      aria-label="Show reading menu"
      onClick={onReveal}
      className="absolute inset-x-0 top-0 z-10 flex h-12 items-start justify-center focus-visible:outline-2 focus-visible:outline-signal"
      style={{ color }}
    >
      <span aria-hidden="true" className="mt-2 h-1 w-9 rounded-full bg-current opacity-30" />
    </button>
  );
}
