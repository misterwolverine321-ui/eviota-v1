// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyStorage } from "@/lib/legacy-storage";
import { LEGACY_THEME_KEY, THEME_BOOT_SCRIPT, THEME_KEY } from "@/lib/theme-boot";

beforeEach(() => localStorage.clear());

describe("migrateLegacyStorage", () => {
  it("moves the preference keys written under the old name", () => {
    localStorage.setItem("folio-theme", "dark");
    localStorage.setItem("folio-reader-settings", '{"fontSize":20}');
    localStorage.setItem("folio-install-dismissed", "1");
    localStorage.setItem("folio-ios-install-dismissed", "1");
    expect(migrateLegacyStorage()).toBe(4);
    expect(localStorage.getItem("nawiri-theme")).toBe("dark");
    expect(localStorage.getItem("nawiri-reader-settings")).toBe('{"fontSize":20}');
    expect(localStorage.getItem("nawiri-install-dismissed")).toBe("1");
    expect(localStorage.getItem("nawiri-ios-install-dismissed")).toBe("1");
    expect(localStorage.getItem("folio-theme")).toBeNull();
  });

  it("never overwrites a value the new key already holds", () => {
    localStorage.setItem("folio-theme", "dark");
    localStorage.setItem("nawiri-theme", "light");
    migrateLegacyStorage();
    expect(localStorage.getItem("nawiri-theme")).toBe("light");
    expect(localStorage.getItem("folio-theme")).toBeNull();
  });

  it("moves every per-book read-aloud position and drops the lookup cache", () => {
    for (let i = 0; i < 5; i++) localStorage.setItem(`folio-tts-position:book${i}`, String(i));
    localStorage.setItem("folio-lookup:en:word", "cached");
    localStorage.setItem("unrelated", "keep");
    expect(migrateLegacyStorage()).toBe(6);
    for (let i = 0; i < 5; i++) {
      expect(localStorage.getItem(`nawiri-tts-position:book${i}`)).toBe(String(i));
    }
    expect(localStorage.getItem("folio-lookup:en:word")).toBeNull();
    expect(localStorage.getItem("nawiri-lookup:en:word")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("is a no-op the second time", () => {
    localStorage.setItem("folio-theme", "dark");
    expect(migrateLegacyStorage()).toBe(1);
    expect(migrateLegacyStorage()).toBe(0);
  });
});

describe("pre-paint theme script", () => {
  const run = (setup: () => void) => {
    localStorage.clear();
    document.documentElement.className = "";
    setup();
    new Function(THEME_BOOT_SCRIPT)();
    return document.documentElement.classList.contains("dark");
  };

  it("honours a theme saved under the old key before migration has run", () => {
    expect(run(() => localStorage.setItem(LEGACY_THEME_KEY, "dark"))).toBe(true);
  });

  it("prefers the new key over the old one", () => {
    expect(
      run(() => {
        localStorage.setItem(LEGACY_THEME_KEY, "dark");
        localStorage.setItem(THEME_KEY, "light");
      }),
    ).toBe(false);
  });
});
