import { describe, expect, it } from "vitest";
import { clampRate, pickVoice, segmentSentences, TTS_RATE_MAX, TTS_RATE_MIN } from "@/lib/tts";

describe("segmentSentences", () => {
  it("returns nothing for empty input", () => {
    expect(segmentSentences("")).toEqual([]);
    expect(segmentSentences("   \n ")).toEqual([]);
  });

  it("splits on terminators", () => {
    expect(segmentSentences("One. Two! Three? Four")).toEqual(["One.", "Two!", "Three?", "Four"]);
  });

  it("keeps abbreviations and initials joined", () => {
    expect(segmentSentences("Dr. Watson arrived. He waited.")).toEqual([
      "Dr. Watson arrived.",
      "He waited.",
    ]);
    expect(segmentSentences("J. R. R. Tolkien wrote it.")).toEqual(["J. R. R. Tolkien wrote it."]);
  });

  it("handles runs of terminators and closing quotes", () => {
    expect(segmentSentences('"Stop!" she said. Then silence.')).toEqual([
      '"Stop!"',
      "she said.",
      "Then silence.",
    ]);
    expect(segmentSentences("Wait... Then go.")).toEqual(["Wait...", "Then go."]);
  });

  it("collapses whitespace", () => {
    expect(segmentSentences("A  line\n\nbroken. Next.")).toEqual(["A line broken.", "Next."]);
  });

  it("splits over-long sentences at clause breaks", () => {
    const long = `${"alpha ".repeat(10)}, ${"beta ".repeat(10)}trail.`;
    const parts = segmentSentences(long, 60);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(60);
    expect(parts.join(" ").replace(/\s+/g, " ")).toContain("trail.");
  });
});

describe("clampRate", () => {
  it("clamps and rounds", () => {
    expect(clampRate(0.1)).toBe(TTS_RATE_MIN);
    expect(clampRate(9)).toBe(TTS_RATE_MAX);
    expect(clampRate(1.234)).toBe(1.23);
    expect(clampRate(Number.NaN)).toBe(1);
  });
});

describe("pickVoice", () => {
  const voices = [
    { name: "Alex", lang: "en-US", default: true },
    { name: "Amelie", lang: "fr-CA" },
    { name: "Thomas", lang: "fr-FR" },
  ];

  it("returns null with no voices", () => {
    expect(pickVoice([], "Alex", "en")).toBeNull();
  });

  it("prefers the saved voice", () => {
    expect(pickVoice(voices, "Thomas", "en-US")?.name).toBe("Thomas");
  });

  it("falls back to an exact language match", () => {
    expect(pickVoice(voices, "Missing", "fr-FR")?.name).toBe("Thomas");
  });

  it("falls back to the language family, then the platform default", () => {
    expect(pickVoice(voices, null, "fr")?.name).toBe("Amelie");
    expect(pickVoice(voices, null, "de")?.name).toBe("Alex");
    expect(pickVoice(voices, null, null)?.name).toBe("Alex");
  });
});
