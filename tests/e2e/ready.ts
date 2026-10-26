import type { Page } from "@playwright/test";

/**
 * Waits until the app has mounted: the root route sets `data-app-ready="1"` on `<html>` (see
 * `src/lib/app-ready.ts`). The shelf's import input is server-rendered, so a file set on it before
 * React is live is dropped without a change event; every spec that touches the app waits here first.
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.documentElement.dataset["appReady"] === "1",
    undefined,
    {
      timeout: 30_000,
    },
  );
}
