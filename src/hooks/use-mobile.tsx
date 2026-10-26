import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * Whether the reader's drawer is a bottom sheet (a narrow screen held upright) rather than a side
 * rail. A short landscape screen is narrow too, but a sheet there is 72% of a 320px height: its
 * content gets about 170px, the search box and toggles use most of that so the first result is
 * below the fold, and the sheet hides nearly all of the page. Those screens get the rail instead,
 * the same as a landscape phone wide enough to pass the width test.
 */
const NARROW_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
const SHORT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 480px)";

/** The answer right now, so the first render already has the right layout (no sheet-to-rail flash). */
function sheetNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia(NARROW_QUERY).matches && !window.matchMedia(SHORT_LANDSCAPE_QUERY).matches
  );
}

export function useBottomSheet() {
  const [sheet, setSheet] = React.useState(sheetNow);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    // Two plain queries rather than one with a nested `not`, which older Safari does not read.
    const narrow = window.matchMedia(NARROW_QUERY);
    const shortLandscape = window.matchMedia(SHORT_LANDSCAPE_QUERY);
    const onChange = () => setSheet(narrow.matches && !shortLandscape.matches);
    narrow.addEventListener("change", onChange);
    shortLandscape.addEventListener("change", onChange);
    onChange();
    return () => {
      narrow.removeEventListener("change", onChange);
      shortLandscape.removeEventListener("change", onChange);
    };
  }, []);

  return sheet;
}
