import { describe, expect, it } from "vitest";
import {
  groupBySeries,
  issueLabel,
  parseComicInfo,
  seriesFromFileName,
  seriesKey,
} from "@/lib/comicinfo";

const xml = `<?xml version="1.0"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Series>Saga &amp; Sons</Series>
  <Number>12</Number>
  <Count>54</Count>
  <Volume>2013</Volume>
  <Title>Chapter Twelve</Title>
  <Writer>Brian K. Vaughan</Writer>
  <Summary><![CDATA[On the run again.]]></Summary>
</ComicInfo>`;

describe("parseComicInfo", () => {
  it("reads series, issue and credits", () => {
    const meta = parseComicInfo(xml);
    expect(meta.series).toBe("Saga & Sons");
    expect(meta.number).toBe(12);
    expect(meta.count).toBe(54);
    expect(meta.volume).toBe("2013");
    expect(meta.title).toBe("Chapter Twelve");
    expect(meta.writer).toBe("Brian K. Vaughan");
    expect(meta.summary).toBe("On the run again.");
  });

  it("tolerates a partial sidecar", () => {
    expect(parseComicInfo("<ComicInfo><Series>Bone</Series></ComicInfo>")).toEqual({
      series: "Bone",
    });
  });

  it("handles fractional and padded issue numbers", () => {
    expect(parseComicInfo("<ComicInfo><Number>007</Number></ComicInfo>").number).toBe(7);
    expect(parseComicInfo("<ComicInfo><Number>1.5</Number></ComicInfo>").number).toBe(1.5);
  });

  it("returns nothing for non-ComicInfo xml", () => {
    expect(parseComicInfo("<html><body>no</body></html>")).toEqual({});
    expect(parseComicInfo("")).toEqual({});
  });
});

describe("seriesFromFileName", () => {
  it("splits a trailing issue number off the series name", () => {
    expect(seriesFromFileName("Saga 012 (2013).cbz")).toEqual({ series: "Saga", number: 12 });
    expect(seriesFromFileName("Black Hammer #04.cbr")).toEqual({
      series: "Black Hammer",
      number: 4,
    });
  });

  it("leaves a standalone book alone", () => {
    expect(seriesFromFileName("Watchmen.cbz")).toEqual({});
  });
});

describe("groupBySeries", () => {
  const book = (title: string, series?: string, seriesIndex?: number) => ({
    title,
    series,
    seriesIndex,
  });

  it("stacks two or more issues and leaves singles loose", () => {
    const { stacks, loose } = groupBySeries([
      book("Saga 2", "Saga", 2),
      book("Watchmen"),
      book("Saga 1", "Saga", 1),
      book("Bone 1", "Bone", 1),
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].name).toBe("Saga");
    expect(stacks[0].issues.map((b) => b.seriesIndex)).toEqual([1, 2]);
    expect(loose.map((b) => b.title)).toEqual(["Watchmen", "Bone 1"]);
  });

  it("matches series names case- and punctuation-insensitively", () => {
    expect(seriesKey("The Sandman!")).toBe(seriesKey("the sandman"));
    const { stacks } = groupBySeries([book("a", "The Sandman", 1), book("b", "the sandman", 2)]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].issues).toHaveLength(2);
  });

  it("sorts unnumbered issues after numbered ones", () => {
    const { stacks } = groupBySeries([
      book("Zed", "Hellboy"),
      book("Alp", "Hellboy"),
      book("One", "Hellboy", 1),
    ]);
    expect(stacks[0].issues.map((b) => b.title)).toEqual(["One", "Alp", "Zed"]);
  });

  it("labels issues by number, falling back to the title", () => {
    expect(issueLabel({ title: "One", seriesIndex: 1 })).toBe("#1");
    expect(issueLabel({ title: "Special" })).toBe("Special");
  });
});
