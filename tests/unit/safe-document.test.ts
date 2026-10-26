// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  SAFE_CSP,
  UNCHECKABLE_SECTION,
  blockedTotal,
  classifyLink,
  hardenCss,
  hardenFragment,
  hardenMarkup,
  isMarkupType,
  isRemoteUrl,
  type RemoteRef,
} from "@/lib/safe-document";

const html = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const parse = (markup: string, type = "text/html") =>
  new DOMParser().parseFromString(markup, type as DOMParserSupportedType);

describe("active content", () => {
  it("removes inline and external scripts and counts them", () => {
    const { markup, report } = hardenMarkup(
      html('<p>hi</p><script>fetch("//evil")</script><script src="blob:x"></script>'),
      "text/html",
    );
    expect(report.scripts).toBe(2);
    expect(parse(markup).querySelectorAll("script")).toHaveLength(0);
    expect(parse(markup).body.textContent).toContain("hi");
  });

  it("removes event-handler attributes whatever their case", () => {
    const { markup, report } = hardenMarkup(
      html(
        '<img src="data:image/gif;base64,R0lGOD" onerror="x()"><p OnClick="y()" onmouseover=z()>t</p>',
      ),
      "text/html",
    );
    expect(report.handlers).toBe(3);
    const doc = parse(markup);
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      expect(Array.from(el.attributes).some((a) => /^on/i.test(a.name))).toBe(false);
    }
  });

  it("removes javascript: URLs, including whitespace-obfuscated ones", () => {
    const evil = [
      "javascript:alert(1)",
      "  JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "vbscript:x",
    ];
    const body = evil.map((u, i) => `<a href="${u}">l${i}</a>`).join("");
    const { markup, report } = hardenMarkup(html(body), "text/html");
    expect(report.handlers).toBe(evil.length);
    expect(parse(markup).querySelectorAll("a[href]")).toHaveLength(0);
  });

  it("removes frames, embeds and non-local objects but keeps a book's own object", () => {
    const { markup, report } = hardenMarkup(
      html(
        '<iframe src="https://evil"></iframe><embed src="x"><object data="https://evil/x.swf"></object>' +
          '<object data="blob:app/abc" type="image/svg+xml"></object>',
      ),
      "text/html",
    );
    expect(report.frames).toBe(3);
    const doc = parse(markup);
    expect(doc.querySelectorAll("iframe, embed")).toHaveLength(0);
    expect(doc.querySelectorAll("object")).toHaveLength(1);
  });

  it("removes <base>, meta refresh, ping and form actions", () => {
    const { markup, report } = hardenMarkup(
      html(
        '<a href="#x" ping="https://t/p">a</a><form action="https://evil"><input></form>',
        '<base href="https://evil/"><meta http-equiv="refresh" content="0;url=https://evil">',
      ),
      "text/html",
    );
    expect(report.other).toBe(4);
    const doc = parse(markup);
    expect(doc.querySelector("base")).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelector("a")?.hasAttribute("ping")).toBe(false);
    expect(doc.querySelector("form")?.hasAttribute("action")).toBe(false);
  });

  it("cleans SVG: scripts, remote images, and animations that set href/handlers", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<script>alert(1)</script><image xlink:href="https://t/p.png"/>' +
      '<a xlink:href="x"><set attributeName="href" to="javascript:alert(1)"/></a>' +
      '<rect onclick="x()" width="1" height="1"/></svg>';
    const { markup, report } = hardenMarkup(svg, "image/svg+xml");
    expect(report.scripts).toBe(1);
    expect(report.remote.map((r) => r.url)).toEqual(["https://t/p.png"]);
    expect(report.handlers).toBe(2); // the <set>, and onclick
    expect(markup).not.toMatch(/script|onclick|javascript:|https:\/\/t/i);
  });
});

describe("remote resources (tracking pixels and friends)", () => {
  it("drops remote images, keeps blob: and data: ones, and records what it dropped", () => {
    const { markup, report } = hardenMarkup(
      html(
        '<img src="https://tracker.example/p.gif"><img src="//cdn.example/a.png">' +
          '<img src="blob:app/1"><img src="data:image/png;base64,AAAA"><img src="images/local.png">',
      ),
      "text/html",
    );
    expect(report.remote).toEqual([
      { kind: "image", url: "https://tracker.example/p.gif" },
      { kind: "image", url: "//cdn.example/a.png" },
    ]);
    const srcs = Array.from(parse(markup).querySelectorAll("img")).map((i) =>
      i.getAttribute("src"),
    );
    expect(srcs).toEqual([
      null,
      null,
      "blob:app/1",
      "data:image/png;base64,AAAA",
      "images/local.png",
    ]);
  });

  it("filters srcset candidates one by one", () => {
    const { markup, report } = hardenMarkup(
      html(
        '<img srcset="blob:a 1x, https://t/b.png 2x" src="blob:a"><img srcset="https://t/c.png 1x">',
      ),
      "text/html",
    );
    expect(report.remote.map((r) => r.url)).toEqual(["https://t/b.png", "https://t/c.png"]);
    const imgs = parse(markup).querySelectorAll("img");
    expect(imgs[0]!.getAttribute("srcset")).toBe("blob:a 1x");
    expect(imgs[1]!.hasAttribute("srcset")).toBe(false);
  });

  it("neutralises remote CSS in <style>, style attributes and <link>", () => {
    const { markup, report } = hardenMarkup(
      html(
        '<p style="background:url(https://t/a.png)">x</p>',
        "<style>@import url(\"https://fonts.example/x.css\"); body{background:url('http://t/b.png')} " +
          "i{background:url(blob:app/ok)}</style>" +
          '<link rel="stylesheet" href="https://t/c.css"><link rel="stylesheet" href="blob:app/s">' +
          '<link rel="preload" href="blob:app/zz"><link rel="dns-prefetch" href="//t">',
      ),
      "text/html",
    );
    const urls = report.remote.map((r) => r.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://t/c.css",
        "https://fonts.example/x.css",
        "http://t/b.png",
        "https://t/a.png",
      ]),
    );
    expect(markup).not.toMatch(/https?:\/\/t\/|fonts\.example/);
    expect(markup).toContain("blob:app/ok");
    const links = parse(markup).querySelectorAll("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("blob:app/s");
  });

  it("hardenCss leaves local references alone", () => {
    const found: RemoteRef[] = [];
    const css =
      '@import "local.css"; a{background:url(images/a.png)} b{src:url(data:font/woff;base64,AA)}';
    expect(hardenCss(css, found)).toBe(css);
    expect(found).toEqual([]);
  });

  it("hardenCss files a remote url() under what it loads, not always under 'stylesheet'", () => {
    const found: RemoteRef[] = [];
    const out = hardenCss(
      '@import url("https://a.example/x.css"); ' +
        "body{background:url(https://b.example/bg.png)} " +
        "i{background:url('https://b.example/Photo.JPG?v=2#x')} " +
        "u{background:url(https://b.example/logo.svg)} " +
        "@font-face{src:url(https://c.example/f.woff2) format('woff2'),url(https://c.example/f.ttf)} " +
        "s{background:url(https://d.example/noextension)}",
      found,
    );
    expect(found.map((r) => [r.url, r.kind])).toEqual([
      ["https://a.example/x.css", "style"],
      ["https://b.example/bg.png", "image"],
      ["https://b.example/Photo.JPG?v=2#x", "image"],
      ["https://b.example/logo.svg", "image"],
      ["https://c.example/f.woff2", "style"],
      ["https://c.example/f.ttf", "style"],
      ["https://d.example/noextension", "style"],
    ]);
    // blocking is unchanged: every remote reference is emptied
    expect(out).not.toMatch(/example/);
  });

  it("isRemoteUrl classifies the schemes that matter", () => {
    for (const u of [
      "http://a",
      "https://a",
      "//a/b",
      "ftp://a",
      "file:///etc/passwd",
      "ws://a",
      "HTTP://A",
    ]) {
      expect(isRemoteUrl(u)).toBe(true);
    }
    for (const u of [
      "",
      "#frag",
      "blob:x",
      "data:image/png;base64,AA",
      "chapter2.xhtml",
      "../img/a.png",
    ]) {
      expect(isRemoteUrl(u)).toBe(false);
    }
  });
});

describe("links", () => {
  it("lists external links, adds rel, strips target, and leaves fragments alone", () => {
    const { markup, report } = hardenMarkup(
      html(
        '<a href="https://example.org/a" target="_blank">x</a><a href="mailto:a@b.c">m</a>' +
          '<a href="#note1">n</a><a href="chapter2.xhtml">c</a>',
      ),
      "text/html",
    );
    expect(report.links).toEqual(["https://example.org/a", "mailto:a@b.c"]);
    expect(blockedTotal(report)).toBe(0); // links are listed, not blocked
    const a = parse(markup).querySelector("a")!;
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.hasAttribute("target")).toBe(false);
  });

  it("classifyLink decides what a click may do", () => {
    expect(classifyLink("#x")).toEqual({ kind: "fragment" });
    expect(classifyLink("https://example.org/p?q=1")).toEqual({
      kind: "external",
      url: "https://example.org/p?q=1",
      host: "example.org",
    });
    expect(classifyLink("//example.org/x").kind).toBe("external");
    expect(classifyLink("mailto:a@b.c").kind).toBe("external");
    for (const u of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "chapter.xhtml",
      "",
    ]) {
      expect(classifyLink(u).kind).toBe("ignored");
    }
  });
});

describe("the document that comes out", () => {
  it("is well-formed XHTML and carries the CSP meta", () => {
    const xhtml =
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head>' +
      "<body><p>Hello <b>world</b></p><script>1</script></body></html>";
    const { markup, report, failed } = hardenMarkup(xhtml, "application/xhtml+xml");
    expect(failed).toBe(false);
    expect(report.scripts).toBe(1);
    const doc = parse(markup, "application/xhtml+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta?.getAttribute("content")).toBe(SAFE_CSP);
    expect(doc.querySelector("p")?.textContent).toBe("Hello world");
  });

  it("the policy forbids scripts and network access", () => {
    expect(SAFE_CSP).toContain("script-src 'none'");
    expect(SAFE_CSP).toContain("connect-src 'none'");
    expect(SAFE_CSP).toContain("default-src 'none'");
    expect(SAFE_CSP).not.toMatch(/https?:/);
  });

  it("is idempotent: hardening hardened output blocks nothing more", () => {
    const first = hardenMarkup(
      html('<script>1</script><img src="https://t/p.gif" onerror="x()">'),
      "text/html",
    );
    const second = hardenMarkup(first.markup, "text/html");
    expect(blockedTotal(second.report)).toBe(0);
  });

  it("fails closed on XML it cannot parse: the original is not passed through", () => {
    const { markup, failed } = hardenMarkup(
      "<html><body><p>unclosed<script>evil()</script>",
      "application/xhtml+xml",
    );
    expect(failed).toBe(true);
    expect(markup).toBe(UNCHECKABLE_SECTION);
    expect(markup).not.toContain("evil");
  });

  it("hardenFragment cleans a body fragment for the HTML reader", () => {
    const { html: out, report } = hardenFragment(
      '<p>keep</p><img src="https://t/p.gif"><script>x()</script>',
    );
    expect(out).toContain("<p>keep</p>");
    expect(out).not.toMatch(/script|https/);
    expect(report.scripts).toBe(1);
    expect(report.remote).toHaveLength(1);
  });

  it("isMarkupType picks out the types foliate hands over as markup", () => {
    expect(isMarkupType("application/xhtml+xml")).toBe(true);
    expect(isMarkupType("text/html; charset=utf-8")).toBe(true);
    expect(isMarkupType("image/svg+xml")).toBe(true);
    expect(isMarkupType("image/png")).toBe(false);
    expect(isMarkupType("text/css")).toBe(false);
    expect(isMarkupType(undefined)).toBe(false);
  });
});

describe("clean real books are left readable (no false positives)", () => {
  const dir = join(process.cwd(), "public", "samples");
  const samples = readdirSync(dir).filter((f) => f.endsWith(".epub"));

  it("found the three sample EPUBs", () => {
    expect(samples.length).toBe(3);
  });

  for (const name of samples) {
    it(`${name}: every section keeps its exact text and nothing is blocked`, () => {
      const files = unzipSync(new Uint8Array(readFileSync(join(dir, name))));
      const sections = Object.keys(files).filter((f) => /\.(x?html?)$/i.test(f));
      expect(sections.length).toBeGreaterThan(0);
      let checked = 0;
      for (const path of sections) {
        const source = new TextDecoder().decode(files[path]);
        const before = parse(source, "application/xhtml+xml");
        if (before.getElementsByTagName("parsererror").length) continue; // not XHTML; foliate would use HTML
        const { markup, report, failed } = hardenMarkup(source, "application/xhtml+xml");
        expect(failed, path).toBe(false);
        expect(blockedTotal(report), path).toBe(0);
        const after = parse(markup, "application/xhtml+xml");
        expect(after.body.textContent, path).toBe(before.body.textContent);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
