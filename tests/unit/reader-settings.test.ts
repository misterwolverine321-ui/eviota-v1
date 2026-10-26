// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  getTheme,
  loadSettings,
  migrateSettings,
  saveSettings,
} from "@/lib/reader-settings";

const KEY = "nawiri-reader-settings";

describe("getTheme returns the RESOLVED theme", () => {
  // Regression: getTheme used to stamp id "match" on its result. The EPUB engine
  // branches on `theme.id === "dusk"` (fixed-layout inversion, dark highlight
  // tuning), so the default theme silently lost both in a dark app.
  it("maps match to Dusk in a dark app and Paper in a light one, with the resolved id", () => {
    expect(getTheme("match", "dark").id).toBe("dusk");
    expect(getTheme("match", "light").id).toBe("paper");
  });
  it("uses Dusk's actual colors for match + dark", () => {
    expect(getTheme("match", "dark").bg).toBe(getTheme("dusk", "light").bg);
  });
  it("never returns match, whatever the input", () => {
    for (const app of ["light", "dark"] as const) {
      for (const id of ["match", "paper", "sepia", "dusk"] as const) {
        expect(getTheme(id, app).id).not.toBe("match");
      }
    }
  });
  it("keeps explicit choices regardless of the app theme", () => {
    expect(getTheme("sepia", "dark").id).toBe("sepia");
    expect(getTheme("paper", "dark").id).toBe("paper");
    expect(getTheme("dusk", "light").id).toBe("dusk");
  });
});

describe("migrateSettings", () => {
  it("turns an old default `false` into automatic", () => {
    expect(migrateSettings({ pdfInvert: false }).pdfInvert).toBeNull();
    expect(migrateSettings({ pdfInvert: false, settingsSchema: 1 }).pdfInvert).toBeNull();
  });
  it("keeps an explicit `false` once the save is on the current schema", () => {
    expect(migrateSettings({ pdfInvert: false, settingsSchema: 2 }).pdfInvert).toBe(false);
  });
  it("never changes true or null", () => {
    expect(migrateSettings({ pdfInvert: true }).pdfInvert).toBe(true);
    expect(migrateSettings({ pdfInvert: null, settingsSchema: 2 }).pdfInvert).toBeNull();
  });
  it("stamps the current schema", () => {
    expect(migrateSettings({}).settingsSchema).toBe(2);
  });
});

describe("explicit night-scan choices survive a reload", () => {
  beforeEach(() => localStorage.clear());

  // Regression for the lost "off": the loader needed a `pdfInvertSet` flag that
  // nothing ever wrote, so an explicit `false` was read back as automatic.
  it("an explicit OFF is still OFF after save and load", () => {
    localStorage.setItem(KEY, JSON.stringify({ fontSize: 20, pdfInvert: false })); // legacy save
    const afterUpgrade = loadSettings();
    expect(afterUpgrade.pdfInvert).toBeNull(); // legacy default -> automatic
    saveSettings({ ...afterUpgrade, pdfInvert: false }); // the reader turns it off on purpose
    expect(loadSettings().pdfInvert).toBe(false);
  });
  it("an explicit ON is still ON after save and load", () => {
    saveSettings({ ...DEFAULT_SETTINGS, pdfInvert: true });
    expect(loadSettings().pdfInvert).toBe(true);
  });
  it("returning to automatic is also remembered", () => {
    saveSettings({ ...DEFAULT_SETTINGS, pdfInvert: false });
    saveSettings({ ...loadSettings(), pdfInvert: null });
    expect(loadSettings().pdfInvert).toBeNull();
  });
  it("fresh installs start on Match app with automatic night scan", () => {
    const s = loadSettings();
    expect(s.theme).toBe("match");
    expect(s.pdfInvert).toBeNull();
  });
});
