import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prefersReducedMotion,
  REDUCED_MOTION_BOOK_CSS,
  REDUCED_MOTION_QUERY,
  smoothScroll,
} from "@/lib/motion";

/** A `matchMedia` that answers for the reduced-motion query only. */
function stubMotion(reduce: boolean) {
  const asked: string[] = [];
  vi.stubGlobal("matchMedia", (query: string) => {
    asked.push(query);
    return { matches: query === REDUCED_MOTION_QUERY ? reduce : false };
  });
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe("smoothScroll", () => {
  it("glides when the person has not asked for less motion", () => {
    stubMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(smoothScroll()).toBe("smooth");
  });

  it("jumps when the person has", () => {
    const asked = stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(smoothScroll()).toBe("auto");
    expect(asked).toContain("(prefers-reduced-motion: reduce)");
  });

  it("reads the setting at the moment of the scroll, not once", () => {
    stubMotion(false);
    expect(smoothScroll()).toBe("smooth");
    stubMotion(true);
    expect(smoothScroll()).toBe("auto");
  });

  it("glides where the browser cannot say, and when asking fails", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(smoothScroll()).toBe("smooth");
    vi.stubGlobal("matchMedia", () => {
      throw new Error("blocked");
    });
    expect(smoothScroll()).toBe("smooth");
  });
});

describe("the stylesheet for a book", () => {
  it("stops the book's own animations, transitions and glides under the same query", () => {
    expect(REDUCED_MOTION_BOOK_CSS).toContain(`@media ${REDUCED_MOTION_QUERY}`);
    for (const rule of [
      "animation-duration: 0.01ms !important",
      "animation-iteration-count: 1 !important",
      "transition-duration: 0.01ms !important",
      "scroll-behavior: auto !important",
    ]) {
      expect(REDUCED_MOTION_BOOK_CSS).toContain(rule);
    }
  });
});

/** Every source file under src/, with its text. */
function sources(dir: string, out: { path: string; text: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push({ path, text: readFileSync(path, "utf8") });
  }
  return out;
}

describe("how the app scrolls", () => {
  const files = sources(join(__dirname, "../../src"));

  it("starts no scroll with a fixed smooth behaviour: it asks smoothScroll()", () => {
    const offenders = files
      .filter((f) => !f.path.endsWith("lib/motion.ts"))
      .filter((f) => /behavior:\s*["']smooth["']/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("lets CSS glide only for people who have not asked for less motion", () => {
    for (const f of files.filter((x) => /scroll-behavior:\s*smooth/.test(x.text))) {
      // Every `scroll-behavior: smooth` has to sit inside a no-preference media block.
      const at = f.text.search(/scroll-behavior:\s*smooth/);
      const before = f.text.slice(0, at);
      expect(before.lastIndexOf("(prefers-reduced-motion: no-preference)"), f.path).toBeGreaterThan(
        before.lastIndexOf("}\n"),
      );
    }
  });

  it("never turns on foliate's animated page turns", () => {
    // The paginator glides between pages only when its element has an `animated` attribute; the app
    // does not set it, and a page turn is a jump. Setting it would need to follow the setting too.
    const offenders = files
      .filter((f) =>
        /["'`]animated["'`]|\banimated\s*=\s*["{]|<foliate-[\w-]+[^>]*\banimated\b/.test(f.text),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("has the global reduced-motion block in the stylesheet", () => {
    const css = files.find((f) => f.path.endsWith("src/styles.css"))!.text;
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/transition-duration: 0\.01ms !important/);
    expect(css).toMatch(/animation-duration: 0\.01ms !important/);
  });
});
