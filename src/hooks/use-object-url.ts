import { useEffect, useState } from "react";

/**
 * Re-buffer a blob in memory. A Blob read back from IndexedDB can be a handle
 * onto a file that the browser owns, and WebKit can invalidate such handles
 * (after the app is suspended, for instance), which shows up as a broken image.
 * Covers are a few tens of kilobytes, so copying is cheap. Do not use this for
 * book files.
 */
async function rebuffer(blob: Blob): Promise<Blob> {
  if (typeof blob.arrayBuffer !== "function") return blob;
  return new Blob([await blob.arrayBuffer()], { type: blob.type });
}

/** How long a replaced URL stays alive, so an image that is mid-load never loses its source. */
export const REVOKE_DELAY_MS = 2000;

/** An object URL for a small blob (a cover), created and released with the component. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let mine: string | null = null;
    rebuffer(blob)
      .then((copy) => {
        if (cancelled) return;
        mine = URL.createObjectURL(copy);
        setUrl(mine);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (mine) {
        const stale = mine;
        window.setTimeout(() => URL.revokeObjectURL(stale), REVOKE_DELAY_MS);
      }
    };
  }, [blob]);
  return url;
}

export const createObjectUrl = (blob: Blob) => URL.createObjectURL(blob);
