// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractCleanArticle } from "@/lib/clean-view";

const paragraph = (n: number) =>
  `<p>Paragraph ${n}: the quick brown fox jumps over the lazy dog, and then, ` +
  `having jumped, considers the nature of jumping, of foxes, and of dogs, ` +
  `at considerable and comma-laden length.</p>`;

const page = (body: string) =>
  `<!doctype html><html><head><title>The Article</title></head><body>${body}</body></html>`;

const article = page(`
  <nav><a href="/a">Home</a><a href="/b">About</a><a href="/c">Contact</a></nav>
  <aside id="ads"><p>Buy things now</p></aside>
  <article>
    <h1>On Jumping Foxes</h1>
    ${Array.from({ length: 12 }, (_, i) => paragraph(i + 1)).join("\n")}
  </article>
  <footer><p>Copyright</p></footer>
`);

describe("extractCleanArticle", () => {
  it("pulls the article body out of a page full of chrome", async () => {
    const clean = await extractCleanArticle(article);
    expect(clean).not.toBeNull();
    expect(clean!.html).toContain("Paragraph 1");
    expect(clean!.html).not.toContain("Buy things now");
    expect(clean!.html).not.toContain("Copyright");
    expect(clean!.length).toBeGreaterThan(500);
  });

  it("reports the document title", async () => {
    const clean = await extractCleanArticle(article);
    expect(clean?.title).toBe("The Article");
  });

  it("returns null for a page with no article-like content", async () => {
    const clean = await extractCleanArticle(page(`<nav><a href="/a">Home</a></nav><p>Hi.</p>`));
    expect(clean).toBeNull();
  });

  it("resolves relative URLs against the supplied base", async () => {
    const withImage = page(`
      <article>
        <h1>Pictures</h1>
        <p><img src="pic.png" alt="pic"></p>
        ${Array.from({ length: 12 }, (_, i) => paragraph(i + 1)).join("\n")}
      </article>
    `);
    const clean = await extractCleanArticle(withImage, "https://example.com/posts/");
    expect(clean).not.toBeNull();
    expect(clean!.html).toContain("https://example.com/posts/pic.png");
  });

  it("survives malformed markup without throwing", async () => {
    await expect(extractCleanArticle("<html><body><p>oops")).resolves.toBeDefined();
  });
});
