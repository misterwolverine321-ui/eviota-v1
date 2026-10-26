import { describe, expect, it } from "vitest";
import { buildTextToc, chaptersToToc, detectChapters, MIN_CHAPTERS } from "@/lib/chapters";

/** Pad a document so it clears the `MIN_CHAPTERS * 2` length floor. */
function withFiller(paras: string[], filler = "Some ordinary prose sentence."): string[] {
  const out: string[] = [];
  for (const p of paras) {
    out.push(p, filler, filler);
  }
  return out;
}

describe("detectChapters", () => {
  it("returns nothing for a short document", () => {
    expect(detectChapters(["Chapter 1", "text", "Chapter 2"])).toEqual([]);
  });

  it("returns nothing when no pattern reaches the confidence floor", () => {
    const paras = Array.from({ length: 20 }, (_, i) => `Just prose paragraph ${i}.`);
    expect(detectChapters(paras)).toEqual([]);
  });

  it("detects markdown ATX headings and their levels", () => {
    const chapters = detectChapters(
      withFiller(["# Part One", "## The Road", "## The River", "# Part Two"]),
    );
    expect(chapters.map((c) => c.title)).toEqual(["Part One", "The Road", "The River", "Part Two"]);
    expect(chapters.map((c) => c.level)).toEqual([1, 2, 2, 1]);
  });

  it("detects setext headings", () => {
    const chapters = detectChapters(
      withFiller(["Opening\n=======", "Middle\n-------", "Closing\n======="]),
    );
    expect(chapters.map((c) => c.title)).toEqual(["Opening", "Middle", "Closing"]);
    expect(chapters.map((c) => c.level)).toEqual([1, 2, 1]);
  });

  it("detects English chapter headings, including roman and word numerals", () => {
    const chapters = detectChapters(
      withFiller(["Chapter 1", "CHAPTER XIV — The Road", "Chapter Two", "Epilogue"]),
    );
    expect(chapters).toHaveLength(4);
    expect(chapters[1].title).toBe("CHAPTER XIV — The Road");
    expect(chapters[3].title).toBe("Epilogue");
  });

  it("ignores a bare 'Chapter' word inside prose", () => {
    const paras = withFiller(["Chapter", "Chapter", "Chapter", "Chapter", "Chapter", "Chapter"]);
    expect(detectChapters(paras)).toEqual([]);
  });

  it("detects CJK chapter markers", () => {
    const chapters = detectChapters(withFiller(["第一章 出発", "第二章", "第十二章 帰還"]));
    expect(chapters.map((c) => c.title)).toEqual(["第一章 出発", "第二章", "第十二章 帰還"]);
  });

  it("detects Cyrillic chapters and parts", () => {
    const chapters = detectChapters(withFiller(["ЧАСТЬ ПЕРВАЯ", "Глава 1", "Глава 2", "Глава 3"]));
    expect(chapters).toHaveLength(4);
    expect(chapters[0].level).toBe(1);
    expect(chapters[1].level).toBe(2);
  });

  it("detects bare numbered heading lines", () => {
    const chapters = detectChapters(withFiller(["1.", "2.", "3.", "4."]));
    expect(chapters.map((c) => c.title)).toEqual(["1.", "2.", "3.", "4."]);
  });

  it("detects short standalone ALL-CAPS lines", () => {
    const chapters = detectChapters(withFiller(["THE BEGINNING", "THE MIDDLE", "THE END"]));
    expect(chapters.map((c) => c.title)).toEqual(["THE BEGINNING", "THE MIDDLE", "THE END"]);
  });

  it("skips ALL-CAPS lines that end like a sentence", () => {
    const paras = withFiller(["STOP!", "GO!", "WAIT!"]);
    expect(detectChapters(paras)).toEqual([]);
  });

  it("prefers the highest-confidence rule that qualifies", () => {
    const chapters = detectChapters(
      withFiller(["# One", "SHOUTING", "# Two", "SHOUTING", "# Three"]),
    );
    expect(chapters.every((c) => !c.title.includes("SHOUTING"))).toBe(true);
  });

  it("requires at least MIN_CHAPTERS matches", () => {
    const paras = withFiller(Array.from({ length: MIN_CHAPTERS - 1 }, (_, i) => `# H${i}`));
    expect(detectChapters(paras)).toEqual([]);
  });

  it("reports the paragraph index of each heading", () => {
    const paras = ["# A", "x", "x", "# B", "x", "x", "# C", "x", "x"];
    expect(detectChapters(paras).map((c) => c.index)).toEqual([0, 3, 6]);
  });
});

describe("chaptersToToc", () => {
  it("nests level-2 entries under the preceding level-1 entry", () => {
    const toc = chaptersToToc([
      { index: 0, title: "Part One", level: 1 },
      { index: 4, title: "Chapter 1", level: 2 },
      { index: 9, title: "Chapter 2", level: 2 },
      { index: 14, title: "Part Two", level: 1 },
    ]);
    expect(toc).toHaveLength(2);
    expect(toc[0].href).toBe("#p0");
    expect(toc[0].subitems?.map((s) => s.href)).toEqual(["#p4", "#p9"]);
    expect(toc[1].subitems).toBeUndefined();
  });

  it("flattens a degenerate single-root tree", () => {
    const toc = chaptersToToc([
      { index: 0, title: "Book", level: 1 },
      { index: 3, title: "One", level: 2 },
      { index: 6, title: "Two", level: 2 },
    ]);
    expect(toc.map((t) => t.label)).toEqual(["Book", "One", "Two"]);
    expect(toc.every((t) => !t.subitems)).toBe(true);
  });

  it("keeps a flat list flat", () => {
    const toc = chaptersToToc([
      { index: 0, title: "A", level: 1 },
      { index: 3, title: "B", level: 1 },
    ]);
    expect(toc.map((t) => t.href)).toEqual(["#p0", "#p3"]);
  });
});

describe("buildTextToc", () => {
  it("produces #p hrefs that point at real paragraph indexes", () => {
    const paras = withFiller(["Chapter 1", "Chapter 2", "Chapter 3"]);
    const toc = buildTextToc(paras);
    expect(toc.length).toBeGreaterThan(0);
    const first = toc[0].href;
    const idx = Number(first.slice(2));
    expect(paras[idx]).toBe("Chapter 1");
  });

  it("returns an empty TOC for structureless text", () => {
    expect(buildTextToc(Array.from({ length: 30 }, () => "plain prose."))).toEqual([]);
  });
});
