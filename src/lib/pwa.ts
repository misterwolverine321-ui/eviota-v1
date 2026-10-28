import { assetUrl } from "./asset-url";
import { IOS_INSTALL_DISMISS_KEY } from "./ios-install";
/**
 * Install + offline plumbing.
 *
 * The generated service worker (vite-plugin-pwa) is registered from here only,
 * and only from a production build: in dev it would shadow the module graph
 * and serve stale chunks after every edit. Append `?sw=off` to the address to
 * unregister it. `?sw=on` is the default and only matters in a production build:
 * the dev server never registers the worker, whatever the address says.
 */

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "nawiri-install-dismissed";
/** The worker sits next to index.html, wherever the app is hosted. */
const SW_FILE = "sw.js";

function shouldRegister(): boolean {
  if (!import.meta.env.PROD) return false;
  if (window.self !== window.top) return false;
  return new URLSearchParams(window.location.search).get("sw") !== "off";
}

async function unregisterExisting(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((r) =>
          (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(`/${SW_FILE}`),
        )
        .map((r) => r.unregister()),
    );
  } catch {
    // Nothing to clean up.
  }
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!shouldRegister()) {
    void unregisterExisting();
    return;
  }
  const register = () => {
    navigator.serviceWorker.register(assetUrl(SW_FILE)).catch(() => {
      // No offline shell this session; the app still works online.
    });
  };
  // This runs from a React effect, which in a real browser runs after the
  // window `load` event. A listener added then never fires, so check first.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** True when the app is already running as an installed window. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function installDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstall(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Private mode: the banner simply returns next visit.
  }
}

export function iosInstallDismissed(): boolean {
  try {
    return localStorage.getItem(IOS_INSTALL_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissIosInstall(): void {
  try {
    localStorage.setItem(IOS_INSTALL_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}
