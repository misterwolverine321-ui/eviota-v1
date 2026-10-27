import { describe, expect, it } from "vitest";
import { type FontFaceRule, bookFontFaceCss } from "@/lib/book-fonts";

const BASE = "http://127.0.0.1:4173/assets/index-abc.css";

const LORA_LATIN: FontFaceRule = {
  family: "Lora Variable",
  src: 'url("./lora-latin-wght-normal-AbC123.woff2") format("woff2-variations")',
  style: "normal",
  weight: "400 700",
  range: "U+0000-00FF, U+0131, U+2000-206F",
};

describe("bookFontFaceCss", () => {
  it("resolves each font URL against the stylesheet it came from", () => {
    const css = bookFontFaceCss([LORA_LATIN], BASE);
    expect(css).toContain(
      'url("http://127.0.0.1:4173/assets/lora-latin-wght-normal-AbC123.woff2")',
    );
    // A relative path would resolve against the book's blob: address and fail to load.
    expect(css).not.toContain("./");
  });

  it("keeps the family, style, weight and subset range of each face", () => {
    const css = bookFontFaceCss([LORA_LATIN], BASE);
    expect(css).toContain('font-family: "Lora Variable"');
    expect(css).toContain("font-style: normal");
    expect(css).toContain("font-weight: 400 700");
    expect(css).toContain("unicode-range: U+0000-00FF, U+0131, U+2000-206F");
    expect(css).toContain("font-display: swap");
  });

  it("copies only the book families", () => {
    const css = bookFontFaceCss(
      [
        LORA_LATIN,
        { ...LORA_LATIN, family: "Inter Variable" },
        { ...LORA_LATIN, family: "JetBrains Mono Variable" },
        { ...LORA_LATIN, family: "Arial" },
      ],
      BASE,
    );
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).not.toContain("JetBrains");
    expect(css).not.toContain("Arial");
  });

  it("skips a rule that names no file, such as a local() font", () => {
    expect(bookFontFaceCss([{ ...LORA_LATIN, src: 'local("Lora")' }], BASE)).toBe("");
  });

  it("returns nothing when no faces are loaded yet", () => {
    expect(bookFontFaceCss([], BASE)).toBe("");
  });
});
