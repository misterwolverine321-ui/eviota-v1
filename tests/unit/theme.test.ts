// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readThemeChoice, resolveTheme, THEME_COLORS, THEME_KEY } from "@/lib/theme";

const matchMedia = vi.fn<(query: string) => MediaQueryList>();

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  document.head.innerHTML = '<meta name="theme-color" content="#fdfdfd">';
  matchMedia.mockReturnValue({ matches: false } as MediaQueryList);
  vi.stubGlobal("matchMedia", matchMedia);
});

afterEach(() => vi.unstubAllGlobals());

describe("theme selection", () => {
  it("defaults invalid or missing storage to system", () => {
    expect(readThemeChoice()).toBe("system");
    localStorage.setItem(THEME_KEY, "sepia");
    expect(readThemeChoice()).toBe("system");
  });

  it("resolves system appearance from the device preference", () => {
    matchMedia.mockReturnValue({ matches: true } as MediaQueryList);
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("applies the root class, native color scheme, and browser color", () => {
    expect(applyTheme("dark")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEME_COLORS.dark,
    );
  });
});
