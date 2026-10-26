// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizeForMatch, rangeForSentence } from "@/lib/spoken-highlight";

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("normalizeForMatch", () => {
  it("collapses runs of whitespace and trims", () => {
    expect(normalizeForMatch("  the   quick\n\tbrown  fox ")).toBe("the quick brown fox");
  });

  it("leaves an already-normal string alone", () => {
    expect(normalizeForMatch("the quick brown fox")).toBe("the quick brown fox");
  });
});

describe("rangeForSentence", () => {
  it("finds a sentence inside a single text node", () => {
    const el = root("<p>First one here. Second one here. Third one here.</p>");
    const range = rangeForSentence(el, "Second one here.");
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Second one here.");
  });

  it("spans element boundaries and source whitespace", () => {
    const el = root("<p>The <em>quick\n   brown</em> fox jumps.</p>");
    const range = rangeForSentence(el, "quick brown fox");
    expect(range).not.toBeNull();
    expect(normalizeForMatch(range!.toString())).toBe("quick brown fox");
  });

  it("ignores script and style text", () => {
    const el = root("<style>p{color:red}</style><p>Visible sentence here.</p>");
    const range = rangeForSentence(el, "Visible sentence here.");
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Visible sentence here.");
  });

  it("returns null when the sentence is not present", () => {
    const el = root("<p>Nothing like it in this document at all.</p>");
    expect(rangeForSentence(el, "a completely unrelated sentence")).toBeNull();
  });

  it("returns null for a too-short probe", () => {
    const el = root("<p>Something here.</p>");
    expect(rangeForSentence(el, "a")).toBeNull();
  });
});
