import { describe, expect, it } from "vitest";
import { findMatches, isWholeWordMatch, normalizeText } from "@/lib/search";
import type { SearchTarget } from "@/lib/reader-settings";

const target = (offset: number): SearchTarget => ({ kind: "offset", offset });

const run = (haystack: string, query: string, options?: Parameters<typeof findMatches>[5]) =>
  findMatches(haystack, query, target, "t", "Page 1", options);

describe("normalizeText", () => {
  it("collapses whitespace so hits survive re-wrapping", () => {
    expect(normalizeText("  a \n\t b  ")).toBe("a b");
  });
});

describe("isWholeWordMatch", () => {
  it("accepts boundaries at string edges and punctuation", () => {
    expect(isWholeWordMatch("cat", 0, 3)).toBe(true);
    expect(isWholeWordMatch("a cat.", 2, 5)).toBe(true);
  });

  it("rejects matches glued to word characters", () => {
    expect(isWholeWordMatch("concatenate", 3, 6)).toBe(false);
    expect(isWholeWordMatch("cat_5", 0, 3)).toBe(false);
  });
});

describe("findMatches", () => {
  it("is case-insensitive by default", () => {
    const hits = run("Fox fox FOX", "fox");
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.excerpt.match)).toEqual(["Fox", "fox", "FOX"]);
  });

  it("honours matchCase", () => {
    const hits = run("Fox fox FOX", "fox", { matchCase: true });
    expect(hits).toHaveLength(1);
    expect(hits[0].excerpt.match).toBe("fox");
  });

  it("honours wholeWord", () => {
    expect(run("cat concatenate cat.", "cat")).toHaveLength(3);
    const whole = run("cat concatenate cat.", "cat", { wholeWord: true });
    expect(whole).toHaveLength(2);
  });

  it("combines matchCase and wholeWord", () => {
    const hits = run("Cat cat concat", "cat", { matchCase: true, wholeWord: true });
    expect(hits).toHaveLength(1);
    expect(hits[0].target).toEqual({ kind: "offset", offset: 4 });
  });

  it("finds overlapping occurrences", () => {
    expect(run("aaaa", "aa")).toHaveLength(3);
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(run("anything", "   ")).toEqual([]);
  });

  it("emits ellipsis-padded excerpts with the exact source casing", () => {
    const long = `${"x".repeat(80)}Needle${"y".repeat(80)}`;
    const [hit] = run(long, "needle");
    expect(hit.excerpt.match).toBe("Needle");
    expect(hit.excerpt.pre.startsWith("…")).toBe(true);
    expect(hit.excerpt.post.endsWith("…")).toBe(true);
  });

  it("caps at MAX_HITS", () => {
    expect(run("a ".repeat(2000), "a").length).toBe(500);
  });

  it("gives every hit a unique offset-derived id", () => {
    const ids = run("fox fox fox", "fox").map((h) => h.id);
    expect(new Set(ids).size).toBe(3);
  });
});
