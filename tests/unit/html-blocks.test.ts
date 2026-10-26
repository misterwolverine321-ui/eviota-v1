// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blockTextsOfBody, collectBlockElements, prepareRawView } from "@/lib/html-blocks";
import { buildTextUnits } from "@/lib/text-units";

describe("collectBlockElements", () => {
  it("keeps the innermost block, in document order, and skips blocks with no text", () => {
    const doc = new DOMParser().parseFromString(
      "<body><ul><li>one</li><li><p>two</p></li><li>  </li></ul><h2>three</h2><p></p></body>",
      "text/html",
    );
    const blocks = collectBlockElements(doc.body);
    expect(blocks.map((b) => b.tagName.toLowerCase())).toEqual(["li", "p", "h2"]);
    expect(blocks.map((b) => b.textContent)).toEqual(["one", "two", "three"]);
  });
});

describe("blockTextsOfBody", () => {
  it("returns each block's whitespace-collapsed text", () => {
    expect(
      blockTextsOfBody("<p>Hello   <b>big</b>\n world</p><blockquote>Quote</blockquote>"),
    ).toEqual(["Hello big world", "Quote"]);
  });
});

describe("prepareRawView", () => {
  it("hardens an HTML page: scripts are gone, the text stays", () => {
    const view = prepareRawView(
      "<html><head><title>t</title></head><body><script>alert(1)</script><p onclick='x()'>Visible text</p></body></html>",
      "page.html",
    );
    expect(view.html).not.toContain("alert(1)");
    expect(view.html).not.toContain("onclick");
    expect(blockTextsOfBody(view.html)).toEqual(["Visible text"]);
    expect(view.report).toBeTruthy();
  });

  it("converts Markdown first, and gives its headings a contents list", () => {
    const view = prepareRawView(
      "# Title\n\nFirst paragraph.\n\n## Part\n\nSecond paragraph.",
      "notes.md",
    );
    expect(blockTextsOfBody(view.html)).toEqual([
      "Title",
      "First paragraph.",
      "Part",
      "Second paragraph.",
    ]);
    expect(view.toc[0]?.label).toBe("Title");
    expect(view.toc[0]?.subitems?.map((t) => t.label)).toEqual(["Part"]);
  });

  it("numbers the blocks the way a document shown in the reader would be numbered", () => {
    // The reader puts this body into an iframe document; the indexer parses it on its own. Both
    // must see the same blocks, or a hit would be walked back to the wrong block.
    const view = prepareRawView("# A\n\npara one\n\n- item one\n- item two\n\n> quoted\n", "n.md");
    const shown = new DOMParser().parseFromString(
      `<!doctype html><html><head><base target="_blank"></head><body>${view.html}</body></html>`,
      "text/html",
    );
    const inReader = collectBlockElements(shown).map((el) =>
      el.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(blockTextsOfBody(view.html)).toEqual(inReader);
    // And a unit of them walks an offset back to the block it is in.
    const units = buildTextUnits(blockTextsOfBody(view.html));
    const text = units.texts[0];
    expect(units.locate(1, text.indexOf("item two"))).toEqual({ block: 3, offset: 0 });
  });
});
