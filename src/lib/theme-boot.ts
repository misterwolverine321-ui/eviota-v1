/**
 * Theme constants and the pre-paint script, kept free of imports so that
 * `vite.config.ts` can inject the exact same script into `index.html`
 * (see the `inject-theme-boot` plugin) that the app and its tests use.
 */
export const THEME_KEY = "nawiri-theme";
/** Key used before the rename; read as a fallback until the app migrates it. */
export const LEGACY_THEME_KEY = "folio-theme";
export const THEME_COLORS = { light: "#fdfdfd", dark: "#111111" } as const;

/**
 * Runs inline in <head> before first paint (no white flash). Must stay
 * self-contained — it is stringified, not bundled.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem("${THEME_KEY}")||localStorage.getItem("${LEGACY_THEME_KEY}");if(c!=="light"&&c!=="dark")c="system";var d=c==="dark"||(c==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")}catch(e){}})();`;
