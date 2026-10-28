import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** WCAG 2.x contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((v) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");

/** The `--name: #rrggbb` tokens inside one block, such as `:root` or `.dark`. */
function tokens(selector: RegExp): Record<string, string> {
  const block = css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, "s"));
  if (!block) throw new Error(`no block for ${selector}`);
  return Object.fromEntries(
    [...block[1].matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]),
  );
}

/**
 * The app's own colour tokens, light and dark. The destructive text in dark mode was white on a
 * red of 3.17:1 before checkpoint 26; it is near-black now (5.96:1). A text field's border (`--input`)
 * is what shows where a field is, so it reaches 3:1 (WCAG 1.4.11). `--border` is for dividers only.
 */
describe.each([
  ["light", /:root/],
  ["dark", /\.dark/],
])("%s tokens", (_, selector) => {
  const t = tokens(selector);

  it("the destructive text reads at 4.5:1 on its red", () => {
    expect(contrast(t["destructive-foreground"]!, t["destructive"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("the text field border reaches 3:1 on the page", () => {
    expect(contrast(t["input"]!, t["background"]!)).toBeGreaterThanOrEqual(3);
  });
});
