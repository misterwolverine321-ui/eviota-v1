import { existsSync, readdirSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Sandboxes preinstall a Chromium build (under /opt/ms-playwright or
 * /opt/pw-browsers, or wherever PLAYWRIGHT_BROWSERS_PATH points) that may not
 * match the revision this @playwright/test version expects, and downloading a
 * fresh one is not possible offline. Fall back to any working preinstalled
 * build. On a normal machine none of these exist, this resolves to undefined
 * and Playwright uses its own browser.
 */
function sandboxChromium(): string | undefined {
  if (process.platform !== "linux") return undefined;
  const roots = [process.env["PLAYWRIGHT_BROWSERS_PATH"], "/opt/ms-playwright", "/opt/pw-browsers"];
  for (const root of roots) {
    if (!root || root === "0" || !existsSync(root)) continue;
    const candidate = readdirSync(root)
      .filter((entry) => entry.startsWith("chromium-"))
      .sort()
      .reverse()
      .map((entry) => `${root}/${entry}/chrome-linux/chrome`)
      .find((bin) => existsSync(bin));
    if (candidate) return candidate;
  }
  return undefined;
}

const CHROMIUM_PATH = sandboxChromium();

const PORT = Number(process.env["EVIOTA_E2E_PORT"] ?? 4173);
const BASE_URL = process.env["EVIOTA_E2E_URL"] ?? `http://127.0.0.1:${PORT}`;

/**
 * E2E config. It builds the static site and serves it with `vite preview`, the
 * closest thing to what the Cloudflare Worker serves. Set EVIOTA_E2E_URL to test a
 * deployed copy instead. A server already listening on the port is reused and the build is
 * skipped, so free port 4173 first or the specs test whatever that server serves. The full run
 * takes about ten minutes: keep the session open until it prints its summary.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 1000 },
    trace: "retain-on-failure",
  },

  // The sandbox's Chromium path belongs to this project only: `playwright.webkit.config.ts` reuses
  // this file for other engines, and a Chromium binary handed to WebKit would not start.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: CHROMIUM_PATH
          ? {
              executablePath: CHROMIUM_PATH,
              // Chromium refuses to start as root (a container) without this.
              args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
            }
          : {},
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
