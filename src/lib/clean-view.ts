/**
 * Clean reading view for saved web pages.
 *
 * Mozilla Readability needs a real DOM `Document`, which Web Workers do not
 * provide (no `DOMParser`, no `document`). Rather than ship a DOM shim into a
 * worker, extraction runs on the main thread but is yielded around so a large
 * page never blocks the first paint: the raw document renders immediately and
 * the clean version swaps in when it is ready.
 */
import { Readability, isProbablyReaderable } from "@mozilla/readability";

export interface CleanArticle {
  /** Sanitized article body markup. */
  html: string;
  title: string | null;
  byline: string | null;
  /** Rough character count of the extracted text. */
  length: number;
}

/** Let the browser paint before the (synchronous) extraction pass. */
const yieldToPaint = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function")
      requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });

/**
 * Extract the article body from a full HTML source string.
 * Returns null when the page has no article-like content worth showing.
 */
export async function extractCleanArticle(
  source: string,
  baseUrl?: string,
): Promise<CleanArticle | null> {
  if (typeof DOMParser === "undefined") return null;
  await yieldToPaint();
  try {
    const doc = new DOMParser().parseFromString(source, "text/html");
    if (!doc?.body) return null;
    // Resolve relative links/images against the original location when known.
    if (baseUrl && !doc.querySelector("base")) {
      const base = doc.createElement("base");
      base.href = baseUrl;
      doc.head?.appendChild(base);
    }
    if (!isProbablyReaderable(doc)) return null;
    const article = new Readability(doc).parse();
    if (!article?.content) return null;
    const html = article.content.trim();
    if (!html) return null;
    return {
      html,
      title: article.title?.trim() || null,
      byline: article.byline?.trim() || null,
      length: article.textContent?.trim().length ?? 0,
    };
  } catch {
    return null;
  }
}
