import { describe, expect, it } from "vitest";
import {
  isLookupUrl,
  normalizeLookupTerm,
  parseWikipediaSummary,
  parseWiktionary,
  wikiLang,
} from "@/lib/lookup";

describe("normalizeLookupTerm", () => {
  it("trims punctuation and collapses whitespace", () => {
    expect(normalizeLookupTerm("  “quixotic,”  ")).toBe("quixotic");
    expect(normalizeLookupTerm("well-\nknown")).toBe("well- known");
  });

  it("drops the possessive", () => {
    expect(normalizeLookupTerm("Ahab’s")).toBe("Ahab");
    expect(normalizeLookupTerm("Ahab's")).toBe("Ahab");
  });

  it("rejects passages and empty selections", () => {
    expect(normalizeLookupTerm("one two three four five six seven")).toBe("");
    expect(normalizeLookupTerm("  —  ")).toBe("");
  });

  it("keeps short phrases", () => {
    expect(normalizeLookupTerm("Moby Dick")).toBe("Moby Dick");
  });
});

describe("wikiLang", () => {
  it("reduces a tag to a subdomain, defaulting to en", () => {
    expect(wikiLang("en-GB")).toBe("en");
    expect(wikiLang("pt_BR")).toBe("pt");
    expect(wikiLang(null)).toBe("en");
    expect(wikiLang("  ")).toBe("en");
  });
});

describe("parseWiktionary", () => {
  it("reads senses for the requested language and strips markup", () => {
    const senses = parseWiktionary(
      {
        en: [
          {
            partOfSpeech: "Noun",
            definitions: [{ definition: "A <a href='#'>book</a> of maps." }, { definition: "" }],
          },
          { partOfSpeech: "Verb", definitions: [{ definition: "To &amp; map." }] },
        ],
      },
      "en",
    );
    expect(senses).toEqual([
      { partOfSpeech: "Noun", definitions: ["A book of maps."] },
      { partOfSpeech: "Verb", definitions: ["To & map."] },
    ]);
  });

  it("falls back to en, then to any language present", () => {
    expect(
      parseWiktionary({ en: [{ partOfSpeech: "Noun", definitions: [{ definition: "x" }] }] }, "fr"),
    ).toHaveLength(1);
    expect(
      parseWiktionary({ de: [{ partOfSpeech: "Noun", definitions: [{ definition: "y" }] }] }, "fr"),
    ).toHaveLength(1);
  });

  it("returns nothing for junk payloads", () => {
    expect(parseWiktionary(null)).toEqual([]);
    expect(parseWiktionary({ en: [] })).toEqual([]);
    expect(parseWiktionary({ en: [{ partOfSpeech: "Noun", definitions: [] }] })).toEqual([]);
  });
});

describe("parseWikipediaSummary", () => {
  it("extracts prose, title and canonical url", () => {
    expect(
      parseWikipediaSummary({
        type: "standard",
        title: "Moby-Dick",
        extract: " A novel. ",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Moby-Dick" } },
      }),
    ).toEqual({
      extract: "A novel.",
      title: "Moby-Dick",
      url: "https://en.wikipedia.org/wiki/Moby-Dick",
    });
  });

  it("rejects disambiguation pages and empty extracts", () => {
    expect(parseWikipediaSummary({ type: "disambiguation", extract: "many things" })).toBeNull();
    expect(parseWikipediaSummary({ extract: "   " })).toBeNull();
    expect(parseWikipediaSummary(null)).toBeNull();
  });
});

describe("isLookupUrl: the only pages the Read more link may point at", () => {
  it("accepts https pages on a Wikipedia or Wiktionary language site", () => {
    for (const url of [
      "https://en.wikipedia.org/wiki/Moby-Dick",
      "https://ne.wiktionary.org/wiki/%E0%A4%A8",
      "https://pt.wikipedia.org/wiki/Caf%C3%A9?x=1#h",
    ]) {
      expect(isLookupUrl(url), url).toBe(true);
    }
  });

  it("refuses everything else, however it is spelled", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<p>x</p>",
      "http://en.wikipedia.org/wiki/X",
      "https://wikipedia.org/wiki/X",
      "https://en.wikipedia.org.evil.example/wiki/X",
      "https://evil.example/en.wikipedia.org",
      "https://en.wikipedia.org@evil.example/wiki/X",
      "https://user:pw@en.wikipedia.org/wiki/X",
      "https://en.wikipedia.org:8443/wiki/X",
      "https://en-wikipedia.org/wiki/X",
      "https://a.b.wikipedia.org/wiki/X",
      "https://upload2.wikipedia.org.wiktionary.org/wiki/X",
      "https://xn--wikipedia.org/wiki/X",
      "//en.wikipedia.org/wiki/X",
      "en.wikipedia.org/wiki/X",
      "",
      "not a url",
    ]) {
      expect(isLookupUrl(url), url).toBe(false);
    }
  });

  it("copes with values that are not strings", () => {
    expect(isLookupUrl(undefined)).toBe(false);
    expect(isLookupUrl(null)).toBe(false);
    expect(isLookupUrl(42)).toBe(false);
  });

  it("parseWikipediaSummary drops a link that points anywhere else but keeps the prose", () => {
    expect(
      parseWikipediaSummary({
        type: "standard",
        title: "X",
        extract: "Prose.",
        content_urls: { desktop: { page: "javascript:alert(1)" } },
      }),
    ).toEqual({ extract: "Prose.", title: "X" });
  });
});
