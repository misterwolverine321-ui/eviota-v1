import { describe, expect, it } from "vitest";
import { highlightFill, resolvePdfInvert, resolveReaderTheme } from "@/lib/reader-theme-resolve";

describe("resolveReaderTheme", () => {
  it("maps match to Paper or Dusk", () => {
    expect(resolveReaderTheme("match", "light")).toBe("paper");
    expect(resolveReaderTheme("match", "dark")).toBe("dusk");
  });
  it("keeps explicit choices", () => {
    expect(resolveReaderTheme("sepia", "dark")).toBe("sepia");
    expect(resolveReaderTheme("paper", "dark")).toBe("paper");
  });
});

describe("resolvePdfInvert", () => {
  it("auto follows Dusk", () => {
    expect(resolvePdfInvert(null, "dusk")).toBe(true);
    expect(resolvePdfInvert(null, "paper")).toBe(false);
  });
  it("explicit toggle wins", () => {
    expect(resolvePdfInvert(false, "dusk")).toBe(false);
    expect(resolvePdfInvert(true, "paper")).toBe(true);
  });
});

describe("highlightFill", () => {
  it("uses the lighter tint on Dusk", () => {
    expect(highlightFill("dusk")).toBe("rgba(255,85,65,0.46)");
    expect(highlightFill("sepia")).toBe("rgba(222,45,30,0.28)");
  });
});
