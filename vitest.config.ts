import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Standalone Vitest config.
 *
 * It intentionally does NOT reuse vite.config.ts: the build config carries the
 * router, PWA and HTML plugins, which a plain unit run does not need. The units
 * under test are pure modules, so a bare transform plus the "@" alias is enough.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    globals: false,
    reporters: ["default"],
  },
});
