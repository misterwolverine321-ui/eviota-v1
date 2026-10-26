#!/usr/bin/env python3
"""Contrast of Eviota's colour tokens, by the WCAG 2.x formula. Run from the repository root:

    python3 scripts/audit/contrast.py

Reads the `:root` and `.dark` token blocks in src/styles.css and the three reader themes in
src/lib/reader-settings.ts, so it cannot drift from the code. It only prints: it never writes a
file, and its output is a measurement to read, not a claim to paste into a document.
Text pairs need 4.5:1 and non-text boundaries 3:1. Not measured: rendered pixels, hover and
disabled states, images, colours written outside the tokens.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
css = (ROOT / "src/styles.css").read_text(encoding="utf-8")
settings = (ROOT / "src/lib/reader-settings.ts").read_text(encoding="utf-8")


def block(selector: str) -> dict:
    m = re.search(selector + r"\s*\{([^}]*)\}", css, re.S)
    assert m, f"no block for {selector}"
    return dict(re.findall(r"--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", m.group(1)))


def luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    channels = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def ratio(a: str, b: str) -> float:
    hi, lo = sorted([luminance(a), luminance(b)], reverse=True)
    return (hi + 0.05) / (lo + 0.05)


TEXT = [
    ("foreground", "background"), ("card-foreground", "card"), ("muted-foreground", "background"),
    ("muted-foreground", "muted"), ("secondary-foreground", "secondary"),
    ("accent-foreground", "accent"), ("primary-foreground", "primary"),
    ("signal-foreground", "signal"), ("signal-ink", "background"),
    ("destructive-foreground", "destructive"), ("destructive", "background"),
    ("popover-foreground", "popover"), ("accent-foreground", "background"),
    ("muted-foreground", "card"),
]
NON_TEXT = [("border", "background"), ("input", "background"), ("ring", "background")]

passed = failed = 0
for name, selector in (("light", r":root\s*"), ("dark", r"\.dark\s*")):
    tokens = block(selector)
    print(f"== {name}")
    for kind, pairs, need in (("text", TEXT, 4.5), ("non-text", NON_TEXT, 3.0)):
        for fg, bg in pairs:
            r = ratio(tokens[fg], tokens[bg])
            ok = r >= need
            passed += ok
            failed += not ok
            print(f"  {kind:8} {fg:22} on {bg:12} {tokens[fg]} / {tokens[bg]}  {r:5.2f}  {'PASS' if ok else 'FAIL'}")
print(f"app pairs: {passed + failed}, pass {passed}, fail {failed}")

print("== reader themes")
themes = re.findall(
    r'\{\s*id:\s*"(paper|sepia|dusk)",\s*label:\s*"[^"]*",\s*bg:\s*"(#[0-9A-Fa-f]{6})",\s*ink:\s*"(#[0-9A-Fa-f]{6})",\s*sub:\s*"(#[0-9A-Fa-f]{6})",\s*line:\s*"(#[0-9A-Fa-f]{6})"',
    settings,
)
assert len(themes) == 3, "expected the three reader themes in reader-settings.ts"
for tid, bg, ink, sub, line in themes:
    for label, colour, need in (("text ink", ink, 4.5), ("sub text", sub, 4.5), ("line (non-text)", line, 3.0)):
        r = ratio(colour, bg)
        print(f"  {tid:6} {label:16} {colour} on {bg}  {r:5.2f}  {'PASS' if r >= need else 'FAIL'}")
