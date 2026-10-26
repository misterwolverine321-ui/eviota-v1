import { describe, expect, it } from "vitest";
import {
  annotateHeadings,
  isMarkdownFile,
  markdownToHtml,
  sanitizeHtml,
  slugify,
  splitFrontMatter,
} from "@/lib/markdown";

describe("splitFrontMatter", () => {
  it("returns the source unchanged when there is no front matter", () => {
    const { body, meta } = splitFrontMatter("# Hello\n\nWorld");
    expect(body).toBe("# Hello\n\nWorld");
    expect(meta).toEqual({});
  });

  it("parses title and author and strips the block", () => {
    const { body, meta } = splitFrontMatter(
      `---\ntitle: "The Road"\nauthor: 'C. McCarthy'\n---\n# One\n`,
    );
    expect(meta).toEqual({ title: "The Road", author: "C. McCarthy" });
    expect(body.startsWith("# One")).toBe(true);
  });

  it("accepts CRLF line endings and a BOM", () => {
    const { meta } = splitFrontMatter("\uFEFF---\r\ntitle: X\r\n---\r\nbody");
    expect(meta.title).toBe("X");
  });

  it("maps 'authors' onto author and ignores unknown keys", () => {
    const { meta } = splitFrontMatter("---\nauthors: Ann\nlicense: CC0\n---\nx");
    expect(meta).toEqual({ author: "Ann" });
  });

  it("ignores a --- rule that is not at the start", () => {
    const src = "intro\n\n---\ntitle: nope\n---\n";
    expect(splitFrontMatter(src).meta).toEqual({});
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("The Road Home", new Set())).toBe("the-road-home");
  });

  it("keeps non-latin letters", () => {
    expect(slugify("Глава 1", new Set())).toBe("глава-1");
  });

  it("de-duplicates within a document", () => {
    const used = new Set<string>();
    expect(slugify("Notes", used)).toBe("notes");
    expect(slugify("Notes", used)).toBe("notes-2");
    expect(slugify("Notes", used)).toBe("notes-3");
  });

  it("falls back to 'section' for punctuation-only headings", () => {
    expect(slugify("***", new Set())).toBe("section");
  });
});

describe("sanitizeHtml", () => {
  it("removes script elements and their contents", () => {
    const out = sanitizeHtml("<p>ok</p><script>alert(1)</script>");
    expect(out).toContain("<p>ok</p>");
    expect(out.toLowerCase()).not.toContain("alert(1)");
  });

  it("strips inline event handlers", () => {
    const out = sanitizeHtml(`<p onclick="steal()">hi</p>`);
    expect(out).not.toContain("onclick");
    expect(out).toContain("hi");
  });

  it("strips javascript: urls", () => {
    const out = sanitizeHtml(`<a href="javascript:alert(1)">x</a>`);
    expect(out).not.toContain("javascript:");
  });

  it("keeps ordinary links and images", () => {
    const out = sanitizeHtml(`<a href="https://e.com">e</a><img src="/a.png">`);
    expect(out).toContain(`href="https://e.com"`);
    expect(out).toContain(`src="/a.png"`);
  });

  it("closes out iframes and forms", () => {
    const out = sanitizeHtml("<iframe src='x'></iframe><form><input></form>");
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("<input");
  });
});

describe("markdownToHtml", () => {
  it("converts basic markdown", () => {
    const { html } = markdownToHtml("# Title\n\nSome *emphasis*.");
    expect(html).toContain("<h1");
    expect(html).toContain("<em>emphasis</em>");
  });

  it("gives headings stable, unique ids and an eviota marker", () => {
    const { html } = markdownToHtml("# Notes\n\ntext\n\n# Notes\n");
    expect(html).toContain(`id="notes"`);
    expect(html).toContain(`id="notes-2"`);
    expect(html).toContain("data-eviota-heading");
  });

  it("returns front-matter metadata", () => {
    const { meta, html } = markdownToHtml("---\ntitle: T\nauthor: A\n---\n# H\n");
    expect(meta).toEqual({ title: "T", author: "A" });
    expect(html).not.toContain("title: T");
  });

  it("sanitizes embedded HTML", () => {
    const { html } = markdownToHtml("Hello\n\n<script>bad()</script>\n");
    expect(html).not.toContain("bad()");
  });

  it("supports GFM tables and fenced code", () => {
    const { html } = markdownToHtml("| a | b |\n| - | - |\n| 1 | 2 |\n\n```\ncode\n```\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<code>");
  });
});

describe("isMarkdownFile", () => {
  it("matches known markdown extensions", () => {
    for (const n of ["a.md", "A.MARKDOWN", "b.mdown", "c.mkd"]) {
      expect(isMarkdownFile(n)).toBe(true);
    }
  });

  it("rejects other formats", () => {
    for (const n of ["a.html", "b.txt", "c.epub", "mdfile"]) {
      expect(isMarkdownFile(n)).toBe(false);
    }
  });
});

describe("annotateHeadings", () => {
  it("adds ids and builds a nested toc", () => {
    const { html, toc } = annotateHeadings(
      "<h1>Part One</h1><p>x</p><h2>Chapter 1</h2><h2>Chapter 2</h2><h1>Part Two</h1>",
    );
    expect(html).toContain(`id="part-one"`);
    expect(toc.map((t) => t.label)).toEqual(["Part One", "Part Two"]);
    expect(toc[0].subitems?.map((s) => s.href)).toEqual(["#chapter-1", "#chapter-2"]);
  });

  it("preserves existing ids", () => {
    const { html, toc } = annotateHeadings(`<h1 id="keep">A</h1>`);
    expect(html).toContain(`id="keep"`);
    expect(toc[0].href).toBe("#keep");
  });

  it("strips inline markup from labels", () => {
    const { toc } = annotateHeadings("<h2>The <em>Long</em> Road</h2>");
    expect(toc[0].label).toBe("The Long Road");
  });

  it("skips empty headings", () => {
    const { toc } = annotateHeadings("<h1>  </h1><h2>Real</h2>");
    expect(toc.map((t) => t.label)).toEqual(["Real"]);
  });

  it("promotes a leading h2 when no h1 exists", () => {
    const { toc } = annotateHeadings("<h2>First</h2><h2>Second</h2>");
    expect(toc).toHaveLength(1);
    expect(toc[0].subitems).toHaveLength(1);
  });

  it("is idempotent over markdown output", () => {
    const { html } = markdownToHtml("# A\n\n## B\n");
    const once = annotateHeadings(html);
    const twice = annotateHeadings(once.html);
    expect(twice.html).toBe(once.html);
    expect(twice.toc).toEqual(once.toc);
  });
});
