import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Builds a small multi-page PDF on disk so the reader specs have a real file
 * to import — no binary fixtures checked into the repo. Each page carries a
 * large unique marker word so thumbnails, reorder and search are verifiable.
 */
export async function makeSamplePdf(
  markers: string[] = ["ALPHA", "BRAVO", "CHARLIE", "DELTA"],
): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  markers.forEach((marker, i) => {
    const page = doc.addPage([420, 594]);
    page.drawText(marker, { x: 40, y: 460, size: 48, font, color: rgb(0, 0, 0) });
    page.drawText(`Eviota test page ${i + 1}`, { x: 40, y: 400, size: 16, font });
  });
  const bytes = await doc.save();
  const dir = mkdtempSync(join(tmpdir(), "eviota-e2e-"));
  const file = join(dir, "eviota-test.pdf");
  writeFileSync(file, bytes);
  return file;
}

// ---------------------------------------------------------------- comics --

import { deflateSync } from "node:zlib";
import { zipSync } from "fflate";

/** CRC-32, needed for PNG chunk checksums. */
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const body = new Uint8Array(name.length + data.length);
  body.set(name);
  body.set(data, name.length);
  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

/**
 * Minimal in-process PNG encoder: a flat RGB fill with a contrasting band, so
 * pages are visually distinct without pulling in a canvas dependency.
 */
function makePng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const raw = new Uint8Array(height * (width * 3 + 1));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    const band = y > height * 0.4 && y < height * 0.6;
    for (let x = 0; x < width; x++) {
      raw[o++] = band ? 255 - rgb[0] : rgb[0];
      raw[o++] = band ? 255 - rgb[1] : rgb[1];
      raw[o++] = band ? 255 - rgb[2] : rgb[2];
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/** Page count in the generated CBZ (page 3 is the wide double-page scan). */
export const CBZ_PAGES = 4;
export const CBZ_WIDE_PAGE = 3;

/**
 * Builds a 4-page CBZ on disk. Page 3 is deliberately wide (aspect ~1.5) so
 * spread-splitting has something real to cut in two.
 */
export function makeSampleCbz(): string {
  const colors: [number, number, number][] = [
    [220, 40, 40],
    [40, 160, 220],
    [60, 200, 90],
    [230, 190, 40],
  ];
  const files: Record<string, Uint8Array> = {};
  for (let i = 1; i <= CBZ_PAGES; i++) {
    const wide = i === CBZ_WIDE_PAGE;
    files[`page-${String(i).padStart(2, "0")}.png`] = makePng(
      wide ? 360 : 240,
      240,
      colors[i - 1]!,
    );
  }
  const zipped = zipSync(files, { level: 0 });
  const dir = mkdtempSync(join(tmpdir(), "eviota-e2e-cbz-"));
  const file = join(dir, "eviota-comic.cbz");
  writeFileSync(file, zipped);
  return file;
}

// ------------------------------------------------------------------ epub --

/** The chapter titles in `makeTocEpub`, with the nesting the contents list must keep. */
export const TOC_EPUB = {
  title: "Contents Probe",
  top: ["Chapter One", "Chapter Two"],
  nested: "Section 1.1",
};

/**
 * A two-chapter EPUB 3 whose navigation document nests one section under the first chapter, so
 * the Contents tab has a list inside a list to announce.
 */
export function makeTocEpub(): string {
  const enc = (s: string) => new TextEncoder().encode(s);
  const page = (heading: string, body: string) =>
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${heading}</title></head><body><h1>${heading}</h1>${body}</body></html>`;
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [enc("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e2e:toc-1</dc:identifier><dc:title>${TOC_EPUB.title}</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>`,
    ),
    "OEBPS/nav.xhtml": enc(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">${TOC_EPUB.top[0]}</a><ol><li><a href="ch1.xhtml#s1">${TOC_EPUB.nested}</a></li></ol></li><li><a href="ch2.xhtml">${TOC_EPUB.top[1]}</a></li></ol></nav></body></html>`,
    ),
    "OEBPS/ch1.xhtml": enc(
      page(
        "Chapter One",
        '<p>First chapter text, long enough to be a paragraph.</p><h2 id="s1">Section 1.1</h2><p>Section text.</p>',
      ),
    ),
    "OEBPS/ch2.xhtml": enc(page("Chapter Two", "<p>Second chapter text.</p>")),
  };
  const dir = mkdtempSync(join(tmpdir(), "eviota-e2e-toc-"));
  const file = join(dir, "contents-probe.epub");
  writeFileSync(file, zipSync(files));
  return file;
}

/** A one-chapter EPUB whose own stylesheet animates the heading (see MOVING_CSS). */
export function makeMovingEpub(): string {
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [enc("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e2e:moving-1</dc:identifier><dc:title>${MOVING_EPUB.title}</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`,
    ),
    "OEBPS/nav.xhtml": enc(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">${MOVING_EPUB.title}</a></li></ol></nav></body></html>`,
    ),
    "OEBPS/ch1.xhtml": enc(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${MOVING_EPUB.title}</title><style>${MOVING_CSS}</style></head><body><h1>${MOVING_EPUB.title}</h1><p>${MOVING_EPUB.text}</p></body></html>`,
    ),
  };
  const dir = mkdtempSync(join(tmpdir(), "eviota-e2e-moving-"));
  const file = join(dir, "moving-probe.epub");
  writeFileSync(file, zipSync(files));
  return file;
}

/**
 * Five chapters, each with one word that appears nowhere else, so a search hit names the chapter
 * the reader must land on. Chapter n is the n-th spine item, which is the unit the index counts.
 */
export const SECTIONS_EPUB = {
  title: "Five Chapters Probe",
  chapters: [
    { heading: "Chapter Alpha", word: "zephyrine" },
    { heading: "Chapter Bravo", word: "marlinspike" },
    { heading: "Chapter Charlie", word: "quillfeather" },
    { heading: "Chapter Delta", word: "obsidianish" },
    { heading: "Chapter Echo", word: "tangerinely" },
  ],
};

export function makeSectionsEpub(): string {
  const enc = (s: string) => new TextEncoder().encode(s);
  const filler = (n: number) =>
    Array.from(
      { length: 6 },
      (_, i) =>
        `<p>Paragraph ${i + 1} of chapter ${n}. The reader scrolls past plain sentences here so that each chapter is a section of real length.</p>`,
    ).join("");
  const chapters = SECTIONS_EPUB.chapters;
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [enc("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e2e:sections-1</dc:identifier><dc:title>${SECTIONS_EPUB.title}</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters
        .map(
          (_, i) =>
            `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
        )
        .join(
          "",
        )}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`,
    ),
    "OEBPS/nav.xhtml": enc(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters
        .map((c, i) => `<li><a href="c${i + 1}.xhtml">${c.heading}</a></li>`)
        .join("")}</ol></nav></body></html>`,
    ),
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/c${i + 1}.xhtml`] = enc(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${c.heading}</title></head><body><h1>${c.heading}</h1><p>The only word of its kind in this book: ${c.word}.</p>${filler(i + 1)}</body></html>`,
    );
  });
  const dir = mkdtempSync(join(tmpdir(), "eviota-e2e-sections-"));
  const file = join(dir, "five-chapters.epub");
  writeFileSync(file, zipSync(files));
  return file;
}

// -------------------------------------------------------- long documents --

/**
 * One document in six formats, long enough to fill several screens and with one word that occurs
 * only in its last paragraph. A search hit for that word has to bring the reader to the last
 * paragraph; a reader that only knows which section, or which half, the word is in leaves the
 * reader at the top of a book that has a single section.
 *
 * The text is generated from a fixed word list with a fixed step, so the files are the same on every
 * run.
 */
export const LONG_DOC = {
  title: "Long Document Probe",
  /** In the last paragraph and nowhere else. */
  word: "zanzibarine",
  /** The label the one entry in the contents list carries. */
  chapter: "Whole book",
};

const FILLER_WORDS = [
  "stone",
  "ember",
  "meadow",
  "compass",
  "quarry",
  "velvet",
  "orchid",
  "lantern",
  "signal",
  "river",
  "harbor",
  "anchor",
  "thistle",
];

function longParagraphs(count = 160): string[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  return Array.from({ length: count }, (_, n) => {
    const words = Array.from({ length: 40 }, () => FILLER_WORDS[next() % FILLER_WORDS.length]!);
    const text = `${words.join(" ")}.`;
    return n === count - 1
      ? `${text} At the very end of it all came ${LONG_DOC.word}, and then nothing more.`
      : text;
  });
}

function writeTemp(prefix: string, name: string, data: string | Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), `eviota-e2e-${prefix}-`));
  const file = join(dir, name);
  writeFileSync(file, data);
  return file;
}

/** A plain-text file: paragraphs separated by blank lines. */
export function makeLongTxt(): string {
  return writeTemp("long-txt", "long-document-txt.txt", longParagraphs().join("\n\n"));
}

/** An RTF file: paragraphs ended by `\par`, the way word processors write them. */
export function makeLongRtf(): string {
  return writeTemp(
    "long-rtf",
    "long-document-rtf.rtf",
    `{\\rtf1\\ansi\\deff0 ${longParagraphs().join("\\par ")}\\par}`,
  );
}

/** A Markdown file: a heading and paragraphs. */
export function makeLongMd(): string {
  return writeTemp(
    "long-md",
    "long-document-md.md",
    `# Long document\n\n${longParagraphs().join("\n\n")}\n`,
  );
}

/** A single HTML file. */
export function makeLongHtml(): string {
  return writeTemp(
    "long-html",
    "long-document-html.html",
    `<!doctype html><html><head><meta charset="utf-8"><title>${LONG_DOC.title}</title></head><body><h1>Long document</h1>${longParagraphs()
      .map((p) => `<p>${p}</p>`)
      .join("")}</body></html>`,
  );
}

/**
 * An HTML file with a link near the top that points to a heading far below it: following the link
 * is a scroll the app starts itself (and so one that may glide or jump).
 */
export const ANCHOR_DOC = {
  title: "Anchor Probe",
  link: "Skip to the end",
  target: "The very end",
};

/**
 * A book that moves on its own: its stylesheet gives the first heading a looping animation and a
 * three-second transition. A reader that respects reduced motion has to stop that too, since it is
 * not the interface's own style that does it. (The HTML reader keeps only a page's body, so in the
 * HTML file the style sits in the body; the EPUB's is in its chapter's head.)
 */
export const MOVING_CSS =
  "@keyframes wobble { from { opacity: 0.5 } to { opacity: 1 } } h1 { animation: wobble 3s infinite; transition: color 3s }";
export const MOVING_EPUB = {
  title: "Moving Probe",
  text: "This chapter has a heading that moves.",
};

export function makeAnchorHtml(): string {
  const body = longParagraphs(120)
    .map((p) => `<p>${p}</p>`)
    .join("");
  // Enough text under the target that the page can scroll until the heading is at the top.
  const after = longParagraphs(30)
    .map((p) => `<p>${p}</p>`)
    .join("");
  return writeTemp(
    "anchor-html",
    "anchor-probe.html",
    `<!doctype html><html><head><meta charset="utf-8"><title>${ANCHOR_DOC.title}</title></head><body><style>${MOVING_CSS}</style><h1>${ANCHOR_DOC.title}</h1><p><a href="#end">${ANCHOR_DOC.link}</a></p>${body}<h2 id="end">${ANCHOR_DOC.target}</h2>${after}</body></html>`,
  );
}

/** A FictionBook with one section, so the reader has one section to open however long it is. */
export function makeLongFb2(): string {
  return writeTemp(
    "long-fb2",
    "long-document-fb2.fb2",
    `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>${LONG_DOC.title}</book-title><author><first-name>Test</first-name><last-name>Author</last-name></author><lang>en</lang></title-info></description><body><section><title><p>Only</p></title>${longParagraphs()
      .map((p) => `<p>${p}</p>`)
      .join("")}</section></body></FictionBook>`,
  );
}

/**
 * An EPUB whose whole text is one spine item, which is how many novels are made. The index counts
 * one section, so the hit has a section number and an offset and nothing else to go by.
 */
export function makeLongEpub(opts: { whitePage?: boolean } = {}): string {
  const enc = (s: string) => new TextEncoder().encode(s);
  // Some books paint their own white page in their CSS, as Walden's does. The reader must not let
  // that white show through a dark theme.
  const pageStyle = opts.whitePage ? "<style>body { background-color: #ffffff; }</style>" : "";
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [enc("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": enc(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": enc(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:e2e:long-1</dc:identifier><dc:title>${LONG_DOC.title}</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
    ),
    "OEBPS/nav.xhtml": enc(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">${LONG_DOC.chapter}</a></li></ol></nav></body></html>`,
    ),
    "OEBPS/c1.xhtml": enc(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${LONG_DOC.title}</title>${pageStyle}</head><body><h1>Long document</h1>${longParagraphs()
        .map((p) => `<p>${p}</p>`)
        .join("")}</body></html>`,
    ),
  };
  return writeTemp(
    "long-epub",
    opts.whitePage ? "long-document-white-epub.epub" : "long-document-epub.epub",
    zipSync(files),
  );
}

// ----------------------------------------------------- mixed-size pdf --

/**
 * A long PDF whose pages differ in size, with a word at the top of two of them. The reader lays the
 * pages out one under the other at the width of the window, so a page's height depends on its shape,
 * and it is known only once the page has been measured:
 *  - a jump to a late page has to wait for the sizes of the pages above it, or it lands where the
 *    guessed heights put it (page 1's shape for every page);
 *  - the last page is short, so it can only be brought to the top of the window if the document has
 *    room below it, and without that room the page before it counts as the current one;
 *  - the word sits close to the top edge of its page, so a jump that puts the page flush against the
 *    top of the window hides it under the top bar.
 * Sizes cycle through `sizes`; page 1249 is the tall narrow one and page 1500 a short landscape one. It
 * is long on purpose: the sizes of 1,200 pages take a while to read, and a jump that does not wait for
 * them lands on the page the guessed heights point at (page 651, in the run that showed it).
 */
export const MIXED_PDF = {
  pageCount: 1500,
  sizes: [
    [300, 420],
    [612, 300],
    [420, 594],
    [240, 680],
    [612, 300],
  ] as [number, number][],
  target: { page: 1249, word: "MIXTARGETQXZ" },
  last: { page: 1500, word: "MIXLASTQXZ" },
};

export async function makeMixedSizePdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= MIXED_PDF.pageCount; n++) {
    const size = MIXED_PDF.sizes[(n - 1) % MIXED_PDF.sizes.length]!;
    const page = doc.addPage(size);
    const word = [MIXED_PDF.target, MIXED_PDF.last].find((t) => t.page === n)?.word;
    // Close to the top edge: about 12 points of margin above the letters.
    page.drawText(word ?? `Mixed size page ${n}`, {
      x: 12,
      y: size[1] - 24,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return writeTemp("mixed-pdf", "mixed-size.pdf", await doc.save());
}
