import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pub = (p: string) => join(root, "public", p);
const read = (p: string) => readFileSync(p);
const text = (p: string) => readFileSync(p, "utf8");

/** Width, height and colour type straight from the PNG header (IHDR). */
function pngInfo(file: string) {
  const b = read(file);
  expect(b.subarray(1, 4).toString("latin1"), `${file} is a PNG`).toBe("PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25]! };
}

/**
 * The top-left pixel of an 8-bit PNG. For the first pixel every PNG filter
 * reduces to the raw bytes (left, up and up-left neighbours are all zero), so
 * no unfiltering is needed.
 */
function cornerPixel(file: string): number[] {
  const b = read(file);
  expect(b[24], `${file} bit depth`).toBe(8);
  const channels = b[25] === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let off = 8; off < b.length;) {
    const len = b.readUInt32BE(off);
    if (b.subarray(off + 4, off + 8).toString("latin1") === "IDAT")
      idat.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return Array.from(raw.subarray(1, 1 + channels)); // byte 0 is the filter type
}

const brandSvgs = readdirSync(join(root, "brand"))
  .filter((f) => f.endsWith(".svg"))
  .map((f) => join(root, "brand", f));
const appSvgs = [pub("favicon.svg"), ...brandSvgs];

// The only colours the brand may use (src/styles.css): ink, signal red, paper,
// and the lighter red used for graphics on dark.
const PALETTE = new Set(["#0a0a0a", "#de2d1e", "#f5f5f5", "#ff5541"]);

describe("web app manifest icons", () => {
  const manifest = JSON.parse(text(pub("manifest.webmanifest"))) as {
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it("every declared icon exists and really has the size it claims", () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      const file = pub(icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const { w, h } = pngInfo(file);
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
  });

  it("has a separate maskable icon: one image must not be both 'any' and 'maskable'", () => {
    const maskable = manifest.icons.filter((i) => i.purpose === "maskable");
    const any = manifest.icons.filter((i) => i.purpose === "any");
    expect(maskable).toHaveLength(1);
    expect(any.length).toBeGreaterThanOrEqual(2);
    for (const icon of any) expect(icon.src).not.toBe(maskable[0]!.src);
  });

  it("the maskable icon is full-bleed (opaque ink-coloured corner) so any mask shape is filled", () => {
    const px = cornerPixel(pub("icons/icon-maskable-512.png"));
    expect(px.slice(0, 3)).toEqual([17, 17, 17]);
    if (px.length === 4) expect(px[3]).toBe(255); // RGB has no alpha at all, which is also opaque
  });

  it("the 'any' icons have transparent rounded corners", () => {
    for (const f of ["icons/icon-192.png", "icons/icon-512.png"]) {
      expect(cornerPixel(pub(f))[3], f).toBe(0);
    }
  });
});

describe("touch icon and favicons", () => {
  it("apple-touch-icon is 180x180 with no alpha channel (iOS paints transparency black)", () => {
    const info = pngInfo(pub("icons/apple-touch-icon.png"));
    expect(info).toMatchObject({ w: 180, h: 180, colorType: 2 });
    expect(cornerPixel(pub("icons/apple-touch-icon.png"))).toEqual([17, 17, 17]); // full-bleed
  });

  it("favicon.ico holds 16, 32 and 48 px images that match their directory entries", () => {
    const b = read(pub("favicon.ico"));
    expect(b.readUInt16LE(0)).toBe(0); // reserved
    expect(b.readUInt16LE(2)).toBe(1); // type: icon
    const count = b.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const e = 6 + i * 16;
      const size = b[e]! || 256;
      const len = b.readUInt32LE(e + 8);
      const off = b.readUInt32LE(e + 12);
      const png = b.subarray(off, off + len);
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
      sizes.push(size);
    }
    expect(sizes.sort((a, c) => a - c)).toEqual([16, 32, 48]);
  });

  it("index.html links the files that exist", () => {
    const html = text(join(root, "index.html"));
    const hrefs = [
      ...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]+href="([^"]+)"/g),
    ].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) expect(existsSync(pub(href.replace(/^\//, ""))), href).toBe(true);
    expect(html).not.toContain("favicon.png"); // replaced by favicon.svg + favicon.ico
  });
});

describe("brand SVGs are self-contained, flat and on palette", () => {
  it("found the source logos and the favicon", () => {
    expect(brandSvgs.map((f) => f.split("/").pop())).toEqual(
      expect.arrayContaining([
        "eviota-logo.svg",
        "eviota-logo-dark.svg",
        "eviota-logo-reader.svg",
        "eviota-logo-reader-dark.svg",
        "eviota-symbol.svg",
        "eviota-symbol-dark.svg",
      ]),
    );
  });

  for (const file of appSvgs) {
    const name = file.split("/").slice(-2).join("/");

    it(`${name}: no live text, no raster, no scripts, no external references`, () => {
      const svg = text(file);
      for (const forbidden of [
        "<text",
        "<tspan",
        "font-family",
        "<image",
        "<script",
        "<foreignObject",
        "@import",
        "data:",
        "http://www.w3.org/1999/xlink",
      ]) {
        expect(svg, forbidden).not.toContain(forbidden);
      }
      expect(svg).not.toMatch(/\bhref=/); // nothing is linked
      expect(svg).not.toMatch(/url\(/); // no gradients, patterns, filters
      expect(svg).not.toMatch(/Gradient|<filter|<mask|<clipPath/);
    });

    it(`${name}: uses only the brand colours`, () => {
      const colours = [...text(file).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) =>
        m[0].toLowerCase(),
      );
      expect(colours.length).toBeGreaterThan(0);
      for (const c of colours) expect(PALETTE.has(c), `${c} in ${name}`).toBe(true);
    });
  }

  it("the favicon follows the browser's light/dark setting", () => {
    expect(text(pub("favicon.svg"))).toContain("prefers-color-scheme");
  });
});

describe("the app's logo and the brand files cannot drift apart", () => {
  const ts = text(join(root, "src/components/brand/paths.ts"));
  const grab = (name: string) => new RegExp(`${name} =\\s*"([^"]+)"`).exec(ts)![1]!;
  const logoSvg = text(join(root, "brand/eviota-logo.svg"));

  it("the generated wordmark path is the one in brand/eviota-logo.svg", () => {
    expect(logoSvg).toContain(grab("WORDMARK_PATH"));
  });

  it("the generated page and fold paths are the ones in the symbol", () => {
    expect(logoSvg).toContain(grab("SYMBOL_PAGE_PATH"));
    expect(logoSvg).toContain(grab("SYMBOL_FOLD_PATH"));
  });

  it("the viewBox width matches the generated constant", () => {
    const width = /LOGO_VIEWBOX = \{ width: ([\d.]+), height: 320 \}/.exec(ts)![1]!;
    expect(logoSvg).toContain(`viewBox="0 0 ${width} 320"`);
  });

  it("every letter is an outline: the wordmark path has the six letters' contours", () => {
    const d = grab("WORDMARK_PATH");
    // N, A, W, I, R, I: A and R each carry an inner counter, so 6 letters + 2 counters.
    expect((d.match(/M/g) ?? []).length).toBe(8);
  });
});
