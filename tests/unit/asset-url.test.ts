// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { assetUrl } from "@/lib/asset-url";

describe("assetUrl", () => {
  it("resolves under a GitHub Pages project path", () => {
    expect(assetUrl("vendor/libarchive/worker-bundle.js", "https://user.github.io/eviota/")).toBe(
      "https://user.github.io/eviota/vendor/libarchive/worker-bundle.js",
    );
  });
  it("ignores a leading slash, so old root-absolute habits still resolve under the app", () => {
    expect(assetUrl("/samples/walden.epub", "https://user.github.io/eviota/")).toBe(
      "https://user.github.io/eviota/samples/walden.epub",
    );
  });
  it("ignores the hash route and index.html in the page URL", () => {
    expect(assetUrl("sw.js", "https://h.example/app/index.html#/read/abc?page=3")).toBe(
      "https://h.example/app/sw.js",
    );
    expect(assetUrl("sw.js", "https://h.example/app/#/settings")).toBe(
      "https://h.example/app/sw.js",
    );
  });
  it("works at the site root and on a custom domain", () => {
    expect(assetUrl("favicon.png", "https://eviota.example/")).toBe(
      "https://eviota.example/favicon.png",
    );
  });
  it("defaults to the current document", () => {
    expect(assetUrl("vendor/tesseract")).toBe(new URL("vendor/tesseract", document.baseURI).href);
  });
});
