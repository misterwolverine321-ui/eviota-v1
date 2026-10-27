import { describe, expect, it } from "vitest";
import { READER_THEMES } from "@/lib/reader-settings";

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

/**
 * Every reader theme must keep its text readable: the book's ink and the reader's secondary text
 * (the grey labels in the top bar, the drawer and the contents) both reach WCAG 2.2 AA (4.5:1).
 * Sepia's secondary text was 3.52:1 and Dusk's 4.45:1 before checkpoint 25.
 */
describe("reader themes", () => {
  for (const theme of READER_THEMES) {
    it(`${theme.label}: ink and secondary text reach 4.5:1 on the page`, () => {
      expect(contrast(theme.ink, theme.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.sub, theme.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
