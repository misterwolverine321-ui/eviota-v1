#!/usr/bin/env python3
"""
Draws the covers of the three bundled sample books, src/assets/covers/*.jpg.

The covers are drawn here, from the project's own geometry and the brand's
typefaces (Lora for titles, Inter Tight for the author; both SIL OFL 1.1), so
they are the project's own work. Every letter is an outline, as in the brand
generator, and the JPEGs are written with no metadata at all.

Requirements (not project dependencies): python3, fonttools, brotli, uharfbuzz,
pillow, and `rsvg-convert` (librsvg2-bin). The fonts come from node_modules
after `npm ci`. Run from the repository root:

    python3 scripts/covers/make_covers.py
"""
import importlib.util
import os
import subprocess
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "src", "assets", "covers")
SERIF = os.path.join(ROOT, "node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2")
SANS = os.path.join(ROOT, "node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2")

# The brand generator supplies the outline and colour code; loading it does not run its main().
_spec = importlib.util.spec_from_file_location("make_brand", os.path.join(ROOT, "scripts/brand/make_brand.py"))
mb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mb)

W, H = 848, 1264  # the size the covers were made at
MARGIN = 80
TEXT_W = W - 2 * MARGIN

BOOKS = [
    ("alice", ["Alice\u2019s", "Adventures", "in Wonderland"], "LEWIS CARROLL"),
    ("tell-tale-heart", ["The Tell-Tale", "Heart"], "EDGAR ALLAN POE"),
    ("walden", ["Walden"], "HENRY DAVID THOREAU"),
]


def line_layout(font, raw, text, cap, x0, baseline, tracking):
    """Outline one line word by word (the brand code cannot draw a space, which has no outline).
    Returns (path d, right edge of the ink)."""
    upm = font["head"].unitsPerEm
    sc = cap / font["OS/2"].sCapHeight
    space_adv = font["hmtx"][font.getBestCmap()[ord(" ")]][0] * sc + tracking * upm * sc
    ds, x, right = [], x0, x0
    for i, word in enumerate(text.split(" ")):
        if i:
            x = right + space_adv
        d, right, _ = mb.set_text(font, raw, word, cap, x, baseline, tracking)
        ds.append(d)
    return " ".join(ds), right


def fit_cap(lines, font):
    """The largest title size, in units of cap height, at which every line of this title fits the text width."""
    cap = 118.0
    while cap > 40:
        if max(line_layout(font[0], font[1], t, cap, MARGIN, 0, -0.01)[1] - MARGIN for t in lines) <= TEXT_W:
            break
        cap -= 2
    return cap


def title_svg(lines, author, cap):
    f_serif = mb.load(SERIF, 600)
    f_sans = mb.load(SANS, 500)
    ink, red, paper = mb.INK, mb.RED, mb.PAPER
    gap = cap * 1.22
    top = 470.0
    parts = [f'<rect width="{W}" height="{H}" fill="{paper}"/>',
             f'<rect x="{MARGIN}" y="120" width="72" height="6" fill="{red}"/>']
    for i, t in enumerate(lines):
        d, _ = line_layout(f_serif[0], f_serif[1], t, cap, MARGIN, top + i * gap, -0.01)
        parts.append(f'<path fill="{ink}" d="{d}"/>')
    rule_y = 1170
    d, _ = line_layout(f_sans[0], f_sans[1], author, 30, MARGIN, rule_y - 40, 0.08)
    parts.append(f'<path fill="{ink}" d="{d}"/>')
    parts.append(f'<rect x="{MARGIN}" y="{rule_y}" width="{TEXT_W}" height="3" fill="{ink}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            + "".join(parts) + "</svg>")


def main():
    font = mb.load(SERIF, 600)
    # One title size for all three covers: the smallest that fits each book's longest line.
    cap = min(fit_cap(lines, font) for _, lines, _ in BOOKS)
    with tempfile.TemporaryDirectory() as tmp:
        for slug, lines, author in BOOKS:
            svg = os.path.join(tmp, f"{slug}.svg")
            png = os.path.join(tmp, f"{slug}.png")
            with open(svg, "w", encoding="utf-8") as fh:
                fh.write(title_svg(lines, author, cap))
            subprocess.run(["rsvg-convert", "-w", str(W), "-h", str(H), svg, "-o", png], check=True)
            img = Image.open(png).convert("RGB")
            assert img.size == (W, H), img.size
            # A real JPEG, with no EXIF, XMP or IPTC: PIL writes only what it is given.
            img.save(os.path.join(OUT, f"{slug}.jpg"), format="JPEG", quality=90, optimize=True)
            print("wrote", os.path.join("src/assets/covers", f"{slug}.jpg"))


if __name__ == "__main__":
    main()
