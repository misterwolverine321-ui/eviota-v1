// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// reader-highlight keeps module-level state and the vitest config runs with
// isolate:false, so each test loads a fresh copy of the module.
async function fresh() {
  vi.resetModules();
  return await import("@/lib/reader-highlight");
}
const root = () => document.documentElement;

describe("reader highlight variables", () => {
  beforeEach(() => {
    root().removeAttribute("style");
    root().classList.remove("dark");
  });

  it("writes the variables on the FIRST call even when it matches the initial theme", async () => {
    // A Paper reader inside a dark app: the stylesheet's .dark default is the
    // dusk tint, so skipping the first write would leave a heavy coral on a white page.
    root().classList.add("dark");
    const { setReaderHighlightTheme } = await fresh();
    setReaderHighlightTheme("paper");
    expect(root().style.getPropertyValue("--reader-hit")).toBe("rgba(222,45,30,0.28)");
  });

  it("switches to the lighter tint for Dusk", async () => {
    const { setReaderHighlightTheme } = await fresh();
    setReaderHighlightTheme("dusk");
    expect(root().style.getPropertyValue("--reader-hit")).toBe("rgba(255,85,65,0.46)");
  });

  it("notifies listeners only when the theme actually changes", async () => {
    const { setReaderHighlightTheme, onReaderHighlightTheme } = await fresh();
    const seen = vi.fn();
    onReaderHighlightTheme(seen);
    setReaderHighlightTheme("paper"); // first call: applies, but nothing changed
    setReaderHighlightTheme("paper"); // repeat: nothing
    expect(seen).not.toHaveBeenCalled();
    setReaderHighlightTheme("dusk");
    expect(seen).toHaveBeenCalledTimes(1);
    setReaderHighlightTheme("dusk");
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
