/**
 * Phase 4.3 (foliate half): the flattened section text and its node map must
 * round-trip a selection through offsets and back to a DOM range.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildDocTextMap, offsetsFromRange, rangeFromOffsets } from "@/lib/doc-text-map";
import { buildTextAnchor, resolveTextAnchor } from "@/lib/text-anchor";

function section(html: string) {
  const doc = document.implementation.createHTMLDocument("s");
  doc.body.innerHTML = html;
  return doc;
}

describe("buildDocTextMap", () => {
  it("collapses whitespace across elements", () => {
    const map = buildDocTextMap(section("<p>Hello\n   world</p><p>  Again </p>")!.body);
    expect(map?.text).toBe("Hello world Again");
  });

  it("returns null for an empty document", () => {
    expect(buildDocTextMap(section("<p>   </p>").body)).toBeNull();
  });

  it("round-trips a text-node range through offsets", () => {
    const doc = section("<p>Alpha beta</p><p>gamma delta</p>");
    const map = buildDocTextMap(doc.body)!;
    const gamma = doc.body.lastElementChild!.firstChild as Text;
    const range = doc.createRange();
    range.setStart(gamma, 0);
    range.setEnd(gamma, 5);
    const offsets = offsetsFromRange(map, range)!;
    expect(map.text.slice(offsets.start, offsets.end)).toBe("gamma");
    const back = rangeFromOffsets(map, offsets.start, offsets.end)!;
    expect(back.toString()).toBe("gamma");
  });

  it("round-trips a range spanning inline elements", () => {
    const doc = section("<p>one <em>two</em> three</p>");
    const map = buildDocTextMap(doc.body)!;
    const p = doc.body.firstElementChild!;
    const range = doc.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.lastChild!, 6);
    const offsets = offsetsFromRange(map, range)!;
    expect(map.text.slice(offsets.start, offsets.end)).toBe("one two three");
  });
});

describe("text anchors over a section map", () => {
  it("re-resolves after the surrounding text is edited", () => {
    const before = buildDocTextMap(section("<p>Intro. The quote here. Outro.</p>").body)!;
    const start = before.text.indexOf("The quote here");
    const anchor = buildTextAnchor(before.text, 3, start, start + "The quote here".length);
    expect(anchor.page).toBe(3);

    const after = buildDocTextMap(
      section("<p>A longer intro paragraph. The quote here. Outro.</p>").body,
    )!;
    const hit = resolveTextAnchor(after.text, anchor)!;
    expect(after.text.slice(hit.start, hit.end)).toBe("The quote here");
    const range = rangeFromOffsets(after, hit.start, hit.end)!;
    expect(range.toString()).toBe("The quote here");
  });

  it("reports an orphan when the quote is gone", () => {
    const map = buildDocTextMap(section("<p>Nothing similar remains.</p>").body)!;
    const anchor = buildTextAnchor("The quote here.", 1, 0, 14);
    expect(resolveTextAnchor(map.text, anchor)).toBeNull();
  });
});

/**
 * Range shapes seen in real Chromium (probe of the built app, triple-click on a paragraph):
 *  - the next block follows directly (Markdown, most XHTML): start = (its text, 0),
 *    end = (the NEXT block, 0);
 *  - an image or other non-text node follows (HTML): end = (parent, index) just past a
 *    whitespace-only text node.
 * An element boundary sits BETWEEN child nodes: (el, k) is before `el.childNodes[k]`. The text
 * selected ends with the last text before it, and begins with the first text after it.
 */
describe("offsetsFromRange: boundaries given as (element, child index)", () => {
  const P2 = "Paragraph 2: the quick brown fox jumps over the lazy dog.";
  const P3 = "Paragraph 3: the quick brown fox jumps over the lazy dog.";
  const slice = (map: { text: string }, o: { start: number; end: number } | null) =>
    o ? map.text.slice(o.start, o.end) : null;

  it("a triple click that ends at (next block, 0) stops with the paragraph", () => {
    const doc = section(`<p id="a">${P2}</p>\n<p id="b">${P3}</p>`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const b = doc.getElementById("b")!;
    const range = doc.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(b, 0);
    expect(slice(map, offsetsFromRange(map, range))).toBe(P2);
  });

  it("a triple click that ends past whitespace, before an image, still selects the paragraph", () => {
    const doc = section(`<p id="a">${P2}</p>\n<img alt="x">\n<img alt="y">`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const body = doc.body;
    // body children: p, "\n", img, "\n", img  -> index 2 is the first image
    expect(body.childNodes[1]!.nodeType).toBe(3);
    const range = doc.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(body, 2);
    expect(slice(map, offsetsFromRange(map, range))).toBe(P2);
  });

  it("a selection that ends after the last child of a container ends with that container's text", () => {
    const doc = section(`<p id="a">${P2}</p><p id="b">${P3}</p>`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const range = doc.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(a, a.childNodes.length);
    expect(slice(map, offsetsFromRange(map, range))).toBe(P2);
  });

  it("an end between inline children covers the children before it only", () => {
    const doc = section(`<p id="a">one <b>two</b> three <i>four</i></p>`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const range = doc.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(a, 2); // before " three ": after <b>two</b>
    expect(slice(map, offsetsFromRange(map, range))).toBe("one two");
  });

  it("a start at the end of one block begins with the next block's text, not its own", () => {
    const doc = section(`<p id="a">${P2}</p>\n<p id="b">${P3}</p>`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const b = doc.getElementById("b")!;
    const range = doc.createRange();
    range.setStart(a, a.childNodes.length);
    range.setEnd(b.firstChild!, P3.length);
    expect(slice(map, offsetsFromRange(map, range))).toBe(P3);
  });

  it("a start before a whitespace-only node begins with the next text", () => {
    const doc = section(`<p id="a">${P2}</p>\n<p id="b">${P3}</p>`);
    const map = buildDocTextMap(doc.body)!;
    const b = doc.getElementById("b")!;
    const range = doc.createRange();
    range.setStart(doc.body, 1); // the "\n" between the paragraphs
    range.setEnd(b.firstChild!, P3.length);
    expect(slice(map, offsetsFromRange(map, range))).toBe(P3);
  });

  it("covers several paragraphs when the end is (the block after them, 0)", () => {
    const doc = section(`<p id="a">${P2}</p>\n<p id="b">${P3}</p>\n<p id="c">Paragraph 4.</p>`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const c = doc.getElementById("c")!;
    const range = doc.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(c, 0);
    expect(slice(map, offsetsFromRange(map, range))).toBe(`${P2} ${P3}`);
  });

  it("a text boundary that is whitespace-only maps to the text around it", () => {
    const doc = section(`<p id="a">${P2}</p>\n<img alt="x">`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const blank = doc.body.childNodes[1] as Text;
    const range = doc.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(blank, 1);
    expect(slice(map, offsetsFromRange(map, range))).toBe(P2);
  });

  it("is still null when there is no text on the selected side of the boundary", () => {
    const doc = section(`<img alt="x"><p id="a">${P2}</p>`);
    const map = buildDocTextMap(doc.body)!;
    const range = doc.createRange();
    range.setStart(doc.body, 0);
    range.setEnd(doc.body, 1); // just the image
    expect(offsetsFromRange(map, range)).toBeNull();
  });

  it("leaves ranges that sit inside text nodes exactly as they were", () => {
    const doc = section(`<p id="a">${P2}</p><p id="b">${P3}</p>`);
    const map = buildDocTextMap(doc.body)!;
    const a = doc.getElementById("a")!;
    const b = doc.getElementById("b")!;
    const range = doc.createRange();
    range.setStart(a.firstChild!, 14); // inside a word: no collapsed space belongs to the start
    range.setEnd(b.firstChild!, 11);
    // the blocks touch, and the map puts no space between touching blocks
    expect(slice(map, offsetsFromRange(map, range))).toBe(`${P2.slice(14)}${P3.slice(0, 11)}`);
  });
});
