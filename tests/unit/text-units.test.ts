import { describe, expect, it } from "vitest";
import { buildTextUnits, unitPercentLabel, UNIT_CHARS } from "@/lib/text-units";

// A document of five blocks. With a unit size of 25 characters they pack as {0,1} {2} {3,4}:
// a unit takes the next block only while it stays within the size.
const blocks = [
  "alpha alpha", // 11
  "bravo bravo", // 11  -> 11 + 1 + 11 = 23 <= 25, so it joins unit 1
  "charlie charlie charlie", // 23 -> 23 + 1 + 23 > 25, so it opens unit 2 (and alone fills it)
  "delta", // 5   -> 23 + 1 + 5 > 25, so it opens unit 3
  "echo echo", // 9   -> 5 + 1 + 9 <= 25, so it joins unit 3
];

describe("buildTextUnits", () => {
  it("cuts on block boundaries, joining blocks with one space", () => {
    const units = buildTextUnits(blocks, 25);
    expect(units.count).toBe(3);
    expect(units.texts).toEqual([
      "alpha alpha bravo bravo",
      "charlie charlie charlie",
      "delta echo echo",
    ]);
  });

  it("uses a sensible default unit size", () => {
    expect(UNIT_CHARS).toBeGreaterThan(5_000);
    const units = buildTextUnits(blocks);
    expect(units.count).toBe(1);
  });

  it("walks an offset in a unit back to its block and the offset inside it", () => {
    const units = buildTextUnits(blocks, 25);
    // Unit 1 text: "alpha alpha bravo bravo"; "bravo" second word starts at 18 = block 1, offset 6.
    expect(units.locate(1, 0)).toEqual({ block: 0, offset: 0 });
    expect(units.locate(1, 6)).toEqual({ block: 0, offset: 6 });
    expect(units.locate(1, 12)).toEqual({ block: 1, offset: 0 });
    expect(units.locate(1, 18)).toEqual({ block: 1, offset: 6 });
    // Unit 3 text: "delta echo echo"; "echo" at 6 is block 4.
    expect(units.locate(3, 0)).toEqual({ block: 3, offset: 0 });
    expect(units.locate(3, 6)).toEqual({ block: 4, offset: 0 });
    expect(units.locate(3, 11)).toEqual({ block: 4, offset: 5 });
  });

  it("puts an offset on the joining space at the end of the block before it", () => {
    const units = buildTextUnits(blocks, 25);
    // Offset 11 is the space between "alpha alpha" and "bravo bravo".
    expect(units.locate(1, 11)).toEqual({ block: 0, offset: 11 });
  });

  it("keeps block numbers when empty blocks are skipped", () => {
    const units = buildTextUnits(["one", "   ", "", "two\n\n  three"], 1_000);
    expect(units.texts).toEqual(["one two three"]);
    expect(units.firstBlock(1)).toBe(0);
    expect(units.locate(1, 4)).toEqual({ block: 3, offset: 0 });
    expect(units.locate(1, 8)).toEqual({ block: 3, offset: 4 });
  });

  it("collapses whitespace inside a block, as the search does", () => {
    const units = buildTextUnits(["a   b\n c"], 1_000);
    expect(units.texts).toEqual(["a b c"]);
  });

  it("gives a block longer than the unit size a unit of its own", () => {
    const long = "word ".repeat(100).trim();
    const units = buildTextUnits(["short", long, "tail"], 50);
    expect(units.count).toBe(3);
    expect(units.texts[1]).toBe(long);
    expect(units.firstBlock(2)).toBe(1);
  });

  it("answers null for a unit that does not exist", () => {
    const units = buildTextUnits(blocks, 25);
    expect(units.firstBlock(0)).toBeNull();
    expect(units.firstBlock(4)).toBeNull();
    expect(units.locate(9, 0)).toBeNull();
  });

  it("has no units for an empty document", () => {
    const units = buildTextUnits([], 25);
    expect(units.count).toBe(0);
    expect(units.texts).toEqual([]);
  });

  it("says how far into the document a unit starts", () => {
    const units = buildTextUnits(blocks, 25);
    expect(units.startFraction(1)).toBe(0);
    // Unit 2 starts after the 22 characters of blocks 0 and 1; the whole text is 22 + 23 + 14.
    expect(units.startFraction(2)).toBeCloseTo(22 / 59, 5);
    expect(units.startFraction(3)).toBeCloseTo(45 / 59, 5);
    // A unit is labelled with the stretch it covers: from where it starts to where the next starts.
    expect(unitPercentLabel(units, 1)).toBe("0–37%");
    expect(unitPercentLabel(units, 2)).toBe("37–76%");
    expect(unitPercentLabel(units, 3)).toBe("76–100%");
    expect(unitPercentLabel(buildTextUnits(["one short document"]), 1)).toBe("0–100%");
  });

  it("has a signature that changes with the text and only with the text", () => {
    const a = buildTextUnits(blocks, 25).signature;
    expect(buildTextUnits([...blocks], 25).signature).toBe(a);
    const edited = [...blocks];
    edited[3] = "delti";
    expect(buildTextUnits(edited, 25).signature).not.toBe(a);
    // Whitespace the search ignores does not change what is indexed.
    const spaced = [...blocks];
    spaced[0] = "alpha   alpha";
    expect(buildTextUnits(spaced, 25).signature).toBe(a);
    // A change in how the same characters split across blocks does.
    expect(buildTextUnits(["ab", "c"], 25).signature).not.toBe(
      buildTextUnits(["a", "bc"], 25).signature,
    );
  });
});
