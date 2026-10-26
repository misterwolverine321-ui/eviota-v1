import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type ReaderSettings } from "@/lib/reader-settings";
import {
  indentActive,
  paragraphGapEm,
  paragraphStyle,
  textBlockStyle,
  typographyCss,
} from "@/lib/typography";

const base = (over: Partial<ReaderSettings> = {}): ReaderSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

describe("typography helper", () => {
  it("indents only when paragraphs are not spaced apart", () => {
    expect(indentActive(base({ paragraphIndent: true, paragraphSpacing: 0 }))).toBe(true);
    expect(indentActive(base({ paragraphIndent: true, paragraphSpacing: 6 }))).toBe(false);
    expect(indentActive(base({ paragraphIndent: false, paragraphSpacing: 0 }))).toBe(false);
  });

  it("converts paragraph spacing tenths into em", () => {
    expect(paragraphGapEm(base({ paragraphSpacing: 0 }))).toBe(0);
    expect(paragraphGapEm(base({ paragraphSpacing: 12 }))).toBeCloseTo(1.2);
  });

  it("maps alignment, spacing and hyphenation into block styles", () => {
    const s = textBlockStyle(base({ textAlign: "justify", letterSpacing: 4, hyphenate: true }));
    expect(s.textAlign).toBe("justify");
    expect(s.letterSpacing).toBe("0.040em");
    expect(s.hyphens).toBe("auto");

    const off = textBlockStyle(base({ textAlign: "start", hyphenate: false }));
    expect(off.textAlign).toBe("start");
    expect(off.hyphens).toBe("manual");
  });

  it("gives the first paragraph no gap and no indent", () => {
    const s = base({ paragraphIndent: true, paragraphSpacing: 0 });
    expect(paragraphStyle(s, true).marginTop).toBe(0);
    expect(paragraphStyle(s, true).textIndent).toBe(0);
    expect(paragraphStyle(s, false).textIndent).toBe("1.2em");
  });

  it("emits matching CSS for iframe-based engines", () => {
    const css = typographyCss(
      base({ textAlign: "justify", letterSpacing: 4, paragraphSpacing: 8 }),
    );
    expect(css).toContain("text-align: justify");
    expect(css).toContain("letter-spacing: 0.040em");
    expect(css).toContain("margin-top: 0.80em");
    expect(css).toContain("text-indent: 0");
    // Headings never inherit justification or tracking.
    expect(css).toContain("h1, h2, h3, h4, h5, h6");
  });
});
