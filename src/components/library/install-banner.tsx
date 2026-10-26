import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import {
  dismissInstall,
  dismissIosInstall,
  iosInstallDismissed,
  installDismissed,
  isStandalone,
  type InstallPromptEvent,
} from "@/lib/pwa";
import { shouldShowIosInstall } from "@/lib/ios-install";

/**
 * Phase 13 — install affordance.
 *
 * Only rendered once the browser actually offers `beforeinstallprompt`, so
 * there is no dead button on platforms that can't install (and none at all
 * inside an already-installed window).
 */
export function InstallBanner() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (
      shouldShowIosInstall({
        ua: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: isStandalone(),
        dismissed: iosInstallDismissed(),
      })
    ) {
      setIos(true);
      return;
    }
    if (installDismissed()) return;
    setHidden(false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (ios) {
    return (
      <div className="anim-rise mt-4 flex items-start justify-between gap-4 rounded-[3px] border border-border bg-secondary/50 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Install Eviota on your iPhone or iPad</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            In your browser, tap{" "}
            <Share className="inline h-3.5 w-3.5 align-[-2px]" aria-label="Share" /> Share, then
            “Add to Home Screen”. Read offline; your books stay on this device.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            dismissIosInstall();
            setIos(false);
          }}
          aria-label="Dismiss install tip"
          className="shrink-0 rounded-[3px] border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (hidden || !prompt) return null;

  const install = async () => {
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } finally {
      setPrompt(null);
    }
  };

  const close = () => {
    dismissInstall();
    setHidden(true);
  };

  return (
    <div className="anim-rise mt-4 flex items-center justify-between gap-4 rounded-[3px] border border-border bg-secondary/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Install Eviota</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Keep your shelf one tap away and read offline — your books stay on this device.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={install}
          className="inline-flex items-center gap-2 rounded-[3px] bg-foreground px-3 py-2 text-xs font-medium tracking-wide text-background transition-opacity hover:opacity-85"
        >
          <Download className="h-3.5 w-3.5" />
          Install
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss install prompt"
          className="rounded-[3px] border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
