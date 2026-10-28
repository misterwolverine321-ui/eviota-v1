import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// With the extension: Vite 8.2 warns about an import without one in the config, because the native
// config loader (planned as the default in a later major) runs it through Node, which needs it.
import { THEME_BOOT_SCRIPT } from "./src/lib/theme-boot.ts";

/**
 * Puts the theme boot script (the one the app and its tests use) inline in
 * <head>, after the theme-color meta it updates, so the page never flashes the
 * wrong theme. Failing loudly if the marker is missing means a refactor of
 * index.html cannot silently drop it.
 */
function injectThemeBoot(): Plugin {
  const MARKER = "<!--theme-boot-->";
  return {
    name: "inject-theme-boot",
    transformIndexHtml(html) {
      if (!html.includes(MARKER)) {
        throw new Error(`index.html is missing the ${MARKER} marker.`);
      }
      return html.replace(MARKER, () => `<script>${THEME_BOOT_SCRIPT}</script>`);
    },
  };
}

/**
 * Hosts allowed to reach the dev and preview servers. Vite answers any other
 * Host header with "Blocked request", which is what a phone sees when it opens
 * a tunnel address (ngrok) instead of localhost. A leading dot matches every
 * subdomain. This affects only `vite` and `vite preview`, never the built site.
 */
const TUNNEL_HOSTS = [
  ".ngrok-free.dev",
  ".ngrok-free.app",
  ".ngrok.app",
  ".ngrok.dev",
  ".ngrok.io",
];

// Eviota is a static app. `base: "./"` makes every built URL relative, and the
// router uses hash URLs, so one build works from any path: a GitHub Pages
// project site, a user site, a custom domain, or a plain static server.
export default defineConfig({
  base: "./",
  // Vite reads the "paths" of tsconfig.json itself, so "@/..." imports resolve without a plugin.
  resolve: { tsconfigPaths: true },
  server: { allowedHosts: TUNNEL_HOSTS },
  preview: { allowedHosts: TUNNEL_HOSTS },
  plugins: [
    // Must run before the React plugin so generated routes are in the module graph.
    tanstackRouter({ target: "react" }),
    react(),
    tailwindcss(),
    injectThemeBoot(),
    VitePWA({
      // Registration lives in src/lib/pwa.ts so dev can refuse it.
      injectRegister: null,
      registerType: "autoUpdate",
      filename: "sw.js",
      devOptions: { enabled: false },
      manifest: false, // public/manifest.webmanifest is authored by hand.
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
        // Sample books are big and optional; they are fetched on demand.
        globIgnores: ["**/samples/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Hash routing means every launch loads the same document, so one
        // precached index.html is the whole offline shell.
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // The DjVu decoder's WebAssembly (two builds, about 0.6 MB each; a device runs one).
            // It is kept after the first DjVu file is opened rather than precached for everyone.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/djvu_rs_bg-[\w-]+\.wasm$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "nawiri-djvu",
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 90 },
              // A cached answer is only usable when it is a whole, successful one.
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Vendor data that is not precached (wasm, language data).
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes("/vendor/"),
            handler: "CacheFirst",
            options: {
              cacheName: "nawiri-vendor",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
});
