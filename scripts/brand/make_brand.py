#!/usr/bin/env python3
"""
Eviota brand asset generator.

Turns the symbol geometry and the two brand typefaces into text-free SVGs
(every letter is an outline, so nothing depends on an installed font), the
header logo paths used by the app, and the icon set.

Requirements (not project dependencies): python3, fonttools, brotli,
uharfbuzz, pillow, and `rsvg-convert` (librsvg2-bin) for PNG output.
Fonts (both SIL OFL 1.1): Inter Tight variable and JetBrains Mono Medium, e.g.
    npm pack @fontsource-variable/inter-tight @fontsource/jetbrains-mono
    python3 scripts/brand/make_brand.py --inter-tight <...>/inter-tight-latin-wght-normal.woff2 \\
        --mono <...>/jetbrains-mono-latin-500-normal.woff2 --write

Without --write it only renders a comparison sheet to --explore-dir.
"""
import argparse
import io
import os
import struct
import subprocess
import sys

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# ---- tokens (src/styles.css) -------------------------------------------------
INK, PAPER, BG_DARK = "#0A0A0A", "#F5F5F5", "#111111"
RED, RED_DARK = "#DE2D1E", "#FF5541"

# ---- symbol: a 320-unit page, dog-eared, with an E cut out of it -------------
# Construction: the E is inset 64 from the left and bottom edges, its top sits
# on y=80 and its base on y=256, and its stem and arms are all 32 units thick.
PAGE = "M0 0H240L320 80V320H0Z"
E_CUT = "M64 256V80H176V112H96V152H164V184H96V224H180V256Z"
FOLD = "M240 0L320 80H240Z"
PAGE_SIZE = 320
CUT_TOP, CUT_BASE = 80, 256
CAP = CUT_BASE - CUT_TOP  # 176: the wordmark's cap height equals the cut-out E's height


def symbol_svg_body(fg, red):
    return (
        f'<path fill="{fg}" fill-rule="evenodd" d="{PAGE}{E_CUT}"/>'
        f'<path fill="{red}" d="{FOLD}"/>'
    )


# ---- fonts -----------------------------------------------------------------
def load(path, wght=None):
    f = TTFont(path)
    f.flavor = None
    if wght is not None:
        f = instancer.instantiateVariableFont(f, {"wght": wght}, inplace=False)
    bio = io.BytesIO()
    f.save(bio)
    raw = bio.getvalue()
    return TTFont(io.BytesIO(raw)), raw


def shape(raw, text):
    font = hb.Font(hb.Face(hb.Blob(raw)))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": False})
    return [(i.codepoint, p.x_advance) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def set_text(font, raw, text, cap_units, x_ink, baseline, tracking_em, nudges=None):
    """Outline `text` so its cap height is `cap_units` and its first ink edge is at x_ink.
    Returns (path d, ink right edge, glyph ink boxes)."""
    upm = font["head"].unitsPerEm
    sc = cap_units / font["OS/2"].sCapHeight
    gs = font.getGlyphSet()
    order = font.getGlyphOrder()
    shaped = shape(raw, text)
    nudges = nudges or {}
    pen = SVGPathPen(gs, ntos=fmt)
    boxes = []
    x = None
    for idx, (gid, adv) in enumerate(shaped):
        name = order[gid]
        bp = BoundsPen(gs)
        gs[name].draw(bp)
        xmin, _, xmax, _ = bp.bounds
        if x is None:
            x = x_ink - xmin * sc
        x += nudges.get(idx, 0)
        gs[name].draw(TransformPen(pen, (sc, 0, 0, -sc, x, baseline)))
        boxes.append((x + xmin * sc, x + xmax * sc))
        x += adv * sc + tracking_em * upm * sc
    return pen.getCommands(), boxes[-1][1], boxes


def stem_of_I(font):
    gs = font.getGlyphSet()
    bp = BoundsPen(gs)
    gs[font.getBestCmap()[ord("I")]].draw(bp)
    xmin, _, xmax, _ = bp.bounds
    return (xmax - xmin) * CAP / font["OS/2"].sCapHeight


def build_lockup(inter_path, mono_path, weight, tracking, gap, with_reader, reader_gap=72, nudges=None):
    f, raw = load(inter_path, weight)
    d, right, boxes = set_text(f, raw, "EVIOTA", CAP, PAGE_SIZE + gap, CUT_BASE, tracking, nudges)
    out = {"word_d": d, "word_right": right, "boxes": boxes, "reader_d": None, "width": right}
    if with_reader:
        m, mraw = load(mono_path)
        rd, rright, _ = set_text(m, mraw, "READER", round(CAP * 0.28), right + reader_gap, CUT_BASE, 0.3)
        out.update(reader_d=rd, width=rright)
    return out


def lockup_svg(L, fg, red, bg=None, pad=None, label="Eviota"):
    """A tight SVG (viewBox 0 0 width 320), or an artboard with margins when pad is given."""
    w = L["width"]
    body = symbol_svg_body(fg, red) + f'<path fill="{fg}" d="{L["word_d"]}"/>'
    if L["reader_d"]:
        body += f'<path fill="{red}" d="{L["reader_d"]}"/>'
    title = f"<title>{label}</title>"
    if pad is None:
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {PAGE_SIZE}" '
                f'role="img" aria-label="{label}">{title}{body}</svg>')
    W, H = w + 2 * pad, PAGE_SIZE + 2 * pad
    rect = f'<rect width="{fmt(W)}" height="{H}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(W)} {H}" role="img" aria-label="{label}">'
            f'{title}{rect}<g transform="translate({pad} {pad})">{body}</g></svg>')


def png(svg_path, out, width=None, height=None):
    cmd = ["rsvg-convert"]
    if width:
        cmd += ["-w", str(width)]
    if height:
        cmd += ["-h", str(height)]
    subprocess.run(cmd + [svg_path, "-o", out], check=True)


# ---- final lockup parameters (chosen by eye from the exploration sheet) -----
WEIGHT, TRACKING, GAP, READER_GAP = 600, 0.05, 96, 72  # wght 600: stem 31.9 vs the E's 32


def tile_svg(size, page_frac, bg, fg, red, radius_frac=None):
    """Square icon tile: the page (a 320-unit box) centred and scaled to page_frac of the tile."""
    k = size * page_frac / PAGE_SIZE
    off = (size - PAGE_SIZE * k) / 2
    rx = f' rx="{fmt(size * radius_frac)}"' if radius_frac else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}"{rx} fill="{bg}"/>'
        f'<g transform="translate({fmt(off)} {fmt(off)}) scale({k:.5f})">{symbol_svg_body(fg, red)}</g></svg>'
    )


def write_ico(path, pngs):
    """PNG-compressed .ico from [(size, png_bytes)]."""
    head = struct.pack("<HHH", 0, 1, len(pngs))
    off = 6 + 16 * len(pngs)
    entries, blobs = b"", b""
    for size, data in pngs:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), off)
        off += len(data)
        blobs += data
    with open(path, "wb") as fh:
        fh.write(head + entries + blobs)


def write_all(args):
    from PIL import Image, ImageDraw

    root = args.root
    brand = os.path.join(root, "brand")
    pub = os.path.join(root, "public")
    icons = os.path.join(pub, "icons")
    for d in (brand, icons, os.path.join(root, "src/components/brand")):
        os.makedirs(d, exist_ok=True)
    w = lambda path, text: open(path, "w").write(text)  # noqa: E731

    plain = build_lockup(args.inter_tight, args.mono, WEIGHT, TRACKING, GAP, False)
    rdr = build_lockup(args.inter_tight, args.mono, WEIGHT, TRACKING, GAP, True, READER_GAP)

    # -- source SVGs (text-free) --
    for suffix, fg, red in (("", INK, RED), ("-dark", PAPER, RED_DARK)):
        w(f"{brand}/eviota-symbol{suffix}.svg",
          f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-label="Eviota">'
          f"<title>Eviota</title>{symbol_svg_body(fg, red)}</svg>")
        w(f"{brand}/eviota-logo{suffix}.svg", lockup_svg(plain, fg, red, label="Eviota"))
        w(f"{brand}/eviota-logo-reader{suffix}.svg", lockup_svg(rdr, fg, red, label="Eviota Reader"))

    # -- generated paths for the app's inline logo --
    def const(name, value):
        """One exported string, wrapped the way Prettier wraps it (printWidth 100)."""
        line = f'export const {name} = "{value}";'
        return line if len(line) <= 100 else f'export const {name} =\n  "{value}";'

    ts = (
        "// Generated by scripts/brand/make_brand.py. Do not edit by hand.\n"
        "// Every letter is an outline: the logo does not depend on an installed font.\n"
        f"export const LOGO_VIEWBOX = {{ width: {fmt(plain['width'])}, height: {PAGE_SIZE} }} as const;\n"
        + const("SYMBOL_PAGE_PATH", PAGE + E_CUT) + "\n"
        + const("SYMBOL_FOLD_PATH", FOLD) + "\n"
        + const("WORDMARK_PATH", plain["word_d"]) + "\n"
    )
    w(f"{root}/src/components/brand/paths.ts", ts)

    # -- favicon.svg: adapts to the browser's light/dark setting --
    w(f"{pub}/favicon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><title>Eviota</title>'
      f"<style>.p{{fill:{INK}}}.f{{fill:{RED}}}@media (prefers-color-scheme:dark){{.p{{fill:{PAPER}}}.f{{fill:{RED_DARK}}}}}</style>"
      f'<path class="p" fill-rule="evenodd" d="{PAGE}{E_CUT}"/><path class="f" d="{FOLD}"/></svg>')

    tmp = os.path.join(args.explore_dir, "tmp.svg")
    os.makedirs(args.explore_dir, exist_ok=True)

    def render(svg, out, size):
        w(tmp, svg)
        png(tmp, out, width=size, height=size)

    # -- PWA / touch icons --
    render(tile_svg(512, 0.62, BG_DARK, PAPER, RED_DARK, 0.22), f"{icons}/icon-512.png", 512)
    render(tile_svg(192, 0.62, BG_DARK, PAPER, RED_DARK, 0.22), f"{icons}/icon-192.png", 192)
    render(tile_svg(512, 0.54, BG_DARK, PAPER, RED_DARK), f"{icons}/icon-maskable-512.png", 512)
    render(tile_svg(180, 0.60, BG_DARK, PAPER, RED_DARK), f"{icons}/apple-touch-icon.png", 180)
    Image.open(f"{icons}/apple-touch-icon.png").convert("RGB").save(f"{icons}/apple-touch-icon.png")  # no alpha: iOS fills it black

    # -- favicon.ico: each size rendered directly, not shrunk from a large one --
    fav = []
    for size in (16, 32, 48):
        out = os.path.join(args.explore_dir, f"fav{size}.png")
        render(tile_svg(size, 0.84, BG_DARK, PAPER, RED_DARK, 0.18), out, size)
        fav.append((size, open(out, "rb").read()))
    write_ico(f"{pub}/favicon.ico", fav)
    legacy = os.path.join(pub, "favicon.png")
    if os.path.exists(legacy):
        os.remove(legacy)  # replaced by favicon.svg + favicon.ico

    # -- self-check: the maskable icon's content must sit inside the safe circle (r = 40% of the side) --
    mk = Image.open(f"{icons}/icon-maskable-512.png").convert("RGB")
    bgc = mk.getpixel((2, 2))
    far = 0.0
    px = mk.load()
    for y in range(512):
        for x in range(512):
            if px[x, y] != bgc and sum(abs(a - b) for a, b in zip(px[x, y], bgc)) > 30:
                far = max(far, ((x - 256) ** 2 + (y - 256) ** 2) ** 0.5)
    print(f"maskable: furthest content pixel {far:.0f}px from centre; safe radius {0.4 * 512:.0f}px -> {'OK' if far <= 0.4 * 512 else 'OUTSIDE SAFE ZONE'}")
    assert far <= 0.4 * 512, "maskable icon content leaves the safe zone"
    assert Image.open(f"{icons}/apple-touch-icon.png").mode == "RGB"

    # -- preview sheet (for people, not shipped) --
    def art(L, fg, red, bg, width):
        p = os.path.join(args.explore_dir, "art.svg")
        w(p, lockup_svg(L, fg, red, bg, pad=96))
        o = os.path.join(args.explore_dir, "art.png")
        png(p, o, width=width)
        return Image.open(o).convert("RGB")

    A = art(plain, INK, RED, "#FFFFFF", 1100)
    B = art(plain, PAPER, RED_DARK, BG_DARK, 1100)
    C = art(rdr, INK, RED, "#FDFDFD", 1100)
    D = art(rdr, PAPER, RED_DARK, BG_DARK, 1100)
    sheet = Image.new("RGB", (2240, A.height + C.height + 440), (200, 200, 200))
    sheet.paste(A, (0, 0)); sheet.paste(B, (1140, 0)); sheet.paste(C, (0, A.height + 4)); sheet.paste(D, (1140, A.height + 4))
    y0 = A.height + C.height + 20
    x = 30
    for name, mask in (("icon-512.png", "round"), ("icon-maskable-512.png", "circle"), ("apple-touch-icon.png", "ios")):
        im = Image.open(f"{icons}/{name}").convert("RGBA").resize((300, 300), Image.LANCZOS)
        if mask in ("circle", "ios"):
            m = Image.new("L", (300, 300), 0)
            d = ImageDraw.Draw(m)
            (d.ellipse((0, 0, 299, 299), fill=255) if mask == "circle" else d.rounded_rectangle((0, 0, 299, 299), 66, fill=255))
            im.putalpha(m)
        sheet.paste(im, (x, y0), im)
        x += 340
    for size, data in fav:
        im = Image.open(io.BytesIO(data)).convert("RGBA").resize((size * 6, size * 6), Image.NEAREST)
        sheet.paste(im, (x, y0 + 20), im)
        x += size * 6 + 24
    sheet.save(f"{brand}/preview.png")
    print("wrote brand/, public/ icons, src/components/brand/paths.ts, brand/preview.png")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inter-tight", required=True)
    ap.add_argument("--mono", required=True)
    ap.add_argument("--explore-dir", default="/tmp/brand-explore")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--root", default=".")
    args = ap.parse_args()
    os.makedirs(args.explore_dir, exist_ok=True)

    print("Stem of the wordmark's I at cap height 176 (the symbol's E stem is 32):")
    for w in (600, 650, 700, 750, 800):
        f, _ = load(args.inter_tight, w)
        print(f"  wght {w}: stem {stem_of_I(f):.1f}")

    # Exploration: weight x gap, with the A-W / W-I pairs visible.
    variants = [(600, 0.03, 96), (600, 0.05, 96), (600, 0.05, 128), (600, 0.07, 128)]
    from PIL import Image
    rows = []
    for i, (w, tr, gap) in enumerate(variants):
        L = build_lockup(args.inter_tight, args.mono, w, tr, gap, False)
        p = os.path.join(args.explore_dir, f"v{i}.svg")
        open(p, "w").write(lockup_svg(L, INK, RED, "#FFFFFF", pad=60))
        png(p, p[:-4] + ".png", width=1100)
        rows.append(Image.open(p[:-4] + ".png").convert("RGB"))
        print(f"  v{i}: wght {w} tracking {tr} gap {gap} -> width {L['width']:.0f}")
    sheet = Image.new("RGB", (rows[0].width, sum(r.height for r in rows)), (255, 255, 255))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    sheet.save(os.path.join(args.explore_dir, "explore.png"))
    print("wrote", os.path.join(args.explore_dir, "explore.png"))
    if args.write:
        write_all(args)


if __name__ == "__main__":
    main()
