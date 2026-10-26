// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeRange } from "@/lib/normalize-range";

/**
 * Real Chromium behaviour (observed through Playwright on the built app): a
 * triple-click on a paragraph gives start = (its text node, 0) and
 * end = (the NEXT block element, 0). The end is a boundary *before* that
 * element, so the selected text stops where the paragraph stops. The old code
 * read `childNodes[endOffset - 1]`, which is index -1 for offset 0, fell back to
 * the element itself and moved the end to the end of the next paragraph. The
 * highlight, its CFI and its context then covered one block too many while the
 * saved quote text was right. On the last block there is no next element, so
 * the end is inside the text and nothing went wrong, which hid it.
 */

const html = (inner: string) => {
  document.body.innerHTML = inner;
  return document.body;
};
const el = (id: string) => document.getElementById(id)!;
const text = (id: string) => el(id).firstChild as Text;

function rangeFrom(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const r = document.createRange();
  r.setStart(startNode, startOffset);
  r.setEnd(endNode, endOffset);
  return r;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("normalizeRange: a selection that ends at offset 0 of the next block", () => {
  it("ends at the end of the selected paragraph, not the next one (triple-click shape)", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p><p id="c">Gamma three.</p>');
    const raw = rangeFrom(text("a"), 0, el("b"), 0);
    expect(raw.toString()).toBe("Alpha one.");
    const out = normalizeRange(raw);
    expect(out.toString()).toBe("Alpha one.");
    expect(out.endContainer).toBe(text("a"));
    expect(out.endOffset).toBe("Alpha one.".length);
  });

  it("skips whitespace-only text between blocks (pretty-printed XHTML)", () => {
    html('<p id="a">Alpha one.</p>\n  <p id="b">Beta two.</p>\n');
    const out = normalizeRange(rangeFrom(text("a"), 0, el("b"), 0));
    expect(out.toString()).toBe("Alpha one.");
  });

  it("ends inside nested inline markup at the last text before the next block", () => {
    html('<p id="a">Alpha <em id="e">one</em></p><p id="b">Beta two.</p>');
    const out = normalizeRange(rangeFrom(text("a"), 0, el("b"), 0));
    expect(out.toString()).toBe("Alpha one");
    expect(out.endContainer).toBe(el("e").firstChild);
  });

  it("works across list items and when the next block is deeper in the tree", () => {
    html('<ul><li id="a">First</li><li id="b"><span>Second</span></li></ul>');
    const out = normalizeRange(rangeFrom(text("a"), 0, el("b"), 0));
    expect(out.toString()).toBe("First");
  });

  it("still covers a multi-paragraph selection that ends at offset 0 of the block after", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p><p id="c">Gamma three.</p>');
    const out = normalizeRange(rangeFrom(text("a"), 0, el("c"), 0));
    expect(out.toString()).toBe("Alpha one.Beta two.");
  });
});

describe("normalizeRange: a selection that starts at the end of a block", () => {
  /**
   * The mirror of the end-side bug. A start boundary (block, childCount) is
   * *after* the block's last child, so the selection begins with the next text.
   * The old code read `childNodes[startOffset]`, found nothing and fell back to
   * the block itself, which moved the start to the *beginning* of the block and
   * pulled the whole block into the highlight. No real Chromium gesture was
   * found that produces this boundary (drags, shift-click, Ctrl+A and triple
   * click all start inside a text node), so this is pinned by a test only.
   */
  it("starts at the next block's text, not at the beginning of the block it left", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p>');
    const raw = rangeFrom(el("a"), el("a").childNodes.length, text("b"), 4);
    expect(raw.toString()).toBe("Beta");
    const out = normalizeRange(raw);
    expect(out.toString()).toBe("Beta");
    expect(out.startContainer).toBe(text("b"));
    expect(out.startOffset).toBe(0);
  });

  it("skips whitespace-only text between blocks (pretty-printed XHTML)", () => {
    html('<p id="a">Alpha one.</p>\n  <p id="b">Beta two.</p>');
    const out = normalizeRange(rangeFrom(el("a"), 1, text("b"), 4));
    expect(out.toString()).toBe("Beta");
  });

  it("finds the next text across nesting levels (list item to the next item's inline markup)", () => {
    html('<ul><li id="a"><span>First</span></li><li id="b"><em>Second</em> item</li></ul>');
    const second = el("b").querySelector("em")!.firstChild as Text;
    const out = normalizeRange(rangeFrom(el("a"), 1, second, 3));
    expect(out.toString()).toBe("Sec");
  });

  it("leaves the range alone when no text follows the boundary", () => {
    html('<p id="a">Alpha one.</p>');
    const raw = rangeFrom(el("a"), 1, document.body, 1);
    const out = normalizeRange(raw);
    expect(out.toString()).toBe(raw.toString());
  });
});

describe("normalizeRange: behaviour that must not change", () => {
  it("leaves a range that already sits inside text nodes alone", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p>');
    const raw = rangeFrom(text("a"), 2, text("b"), 4);
    const out = normalizeRange(raw);
    expect(out.toString()).toBe(raw.toString());
    expect(out.startOffset).toBe(2);
    expect(out.endOffset).toBe(4);
  });

  it("the last block of a section (end inside its text) is unchanged", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p>');
    const out = normalizeRange(rangeFrom(text("b"), 0, text("b"), "Beta two.".length));
    expect(out.toString()).toBe("Beta two.");
  });

  it("an end given as (parent, childIndex) covers the child before that index", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p>');
    const body = document.body;
    const out = normalizeRange(rangeFrom(text("a"), 0, body, 1));
    expect(out.toString()).toBe("Alpha one.");
  });

  it("a start given as (parent, childIndex) moves onto the first text of that child", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p>');
    const body = document.body;
    const out = normalizeRange(rangeFrom(body, 1, text("b"), 4));
    expect(out.toString()).toBe("Beta");
  });

  it("a selection from the end of one block to the start of the next stays empty, not the whole next block", () => {
    html('<p id="a">Alpha one.</p><p id="b">Beta two.</p>');
    const raw = rangeFrom(text("a"), "Alpha one.".length, el("b"), 0);
    expect(raw.toString()).toBe("");
    const out = normalizeRange(raw);
    expect(out).toBe(raw); // normalising would collapse it, so the original is returned
    expect(out.toString()).toBe("");
  });
});

/**
 * Real Chromium, second shape (HTML reader, a paragraph followed by an image): the triple-click
 * ends at (parent, index) just past a whitespace-only text node. The child before that index is
 * the blank text, which has no text of its own to end on.
 */
describe("normalizeRange: an element boundary next to whitespace-only text", () => {
  it("ends with the paragraph when the child before the boundary is blank text", () => {
    html('<p id="a">Alpha one.</p>\n<img alt="x">\n<img alt="y">');
    const body = document.body;
    expect(body.childNodes[1]!.nodeType).toBe(Node.TEXT_NODE);
    const raw = rangeFrom(text("a"), 0, body, 2);
    const out = normalizeRange(raw);
    expect(out.endContainer).toBe(text("a"));
    expect(out.endOffset).toBe("Alpha one.".length);
    expect(out.toString()).toBe("Alpha one.");
  });

  it("ends with the last text before an image when the child before the boundary is the image", () => {
    html('<p id="a">Alpha one.</p><img alt="x"><p id="b">Beta two.</p>');
    const out = normalizeRange(rangeFrom(text("a"), 0, document.body, 2));
    expect(out.endContainer).toBe(text("a"));
    expect(out.endOffset).toBe("Alpha one.".length);
  });

  it("starts with the next paragraph when the child at the boundary is blank text", () => {
    html('<p id="a">Alpha one.</p>\n<p id="b">Beta two.</p>');
    const out = normalizeRange(rangeFrom(document.body, 1, text("b"), "Beta two.".length));
    expect(out.startContainer).toBe(text("b"));
    expect(out.startOffset).toBe(0);
    expect(out.toString()).toBe("Beta two.");
  });

  it("starts with the next text when the child at the boundary is an image", () => {
    html('<p id="a">Alpha one.</p><img alt="x"><p id="b">Beta two.</p>');
    const out = normalizeRange(rangeFrom(document.body, 1, text("b"), "Beta two.".length));
    expect(out.startContainer).toBe(text("b"));
    expect(out.startOffset).toBe(0);
  });

  it("leaves a range that selects only an image alone", () => {
    html('<p id="a">Alpha one.</p><img alt="x"><p id="b">Beta two.</p>');
    const raw = rangeFrom(document.body, 1, document.body, 2);
    const out = normalizeRange(raw);
    expect(out.startContainer).toBe(document.body);
    expect(out.endContainer).toBe(document.body);
    expect(out.toString()).toBe("");
  });
});
