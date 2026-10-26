import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * The same specs in Apple's engine, for checking Safari behaviour without a Mac or a phone in the
 * loop: `npm run test:e2e:webkit`.
 *
 * Two projects:
 *  - `webkit`: the whole suite in Playwright's "Desktop Safari" profile (WebKit, desktop viewport).
 *  - `iphone`: only `phone.spec.ts` (touch, narrow viewport) with an iPhone profile. The rest of
 *    the suite assumes a desktop layout, so running it at phone size would fail for reasons that
 *    say nothing about Safari.
 *
 * Needs a WebKit build: `npx playwright install webkit` once on a machine that can download it.
 * It has NEVER been run by the person who wrote it: the sandbox it was written in has no WebKit
 * build and cannot download one. Until someone has run it, nothing here is "tested in Safari".
 *
 * It is a stand-in, not Safari: Playwright's WebKit is built from WebKit's source and is not the
 * Safari that ships on an iPhone (no iOS keyboard, no address bar resizing, no home-screen mode,
 * no real touch screen). A real iPhone check is still owed. `a11y.spec.ts` runs its explicit
 * role-and-name assertions and its DOM structure audit here; the audit of the browser's own
 * accessibility tree reads Chromium's and is skipped.
 */
export default defineConfig({
  ...base,
  projects: [
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "iphone",
      use: { ...devices["iPhone 15"] },
      testMatch: /phone\.spec\.ts/,
    },
  ],
});
