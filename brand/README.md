# Eviota brand files

I make these files with `scripts/brand/make_brand.py`. If the logo needs to change, I change the script and run it again rather than editing the SVGs by hand. Every letter is an outline, so none of these files needs a font installed.

| File                                  | Use                                                               |
| ------------------------------------- | ----------------------------------------------------------------- |
| `eviota-symbol.svg`, `-dark.svg`      | The page-with-E symbol alone (transparent background)             |
| `eviota-logo.svg`, `-dark.svg`        | Horizontal lockup: symbol + EVIOTA                                |
| `eviota-logo-reader.svg`, `-dark.svg` | The lockup followed by the small red READER descriptor            |
| `preview.png`                         | A contact sheet of all of the above and the icons, for looking at |

"Dark" files are for dark backgrounds (`#111111`): paper `#F5F5F5`, fold `#FF5541`. The others are for light backgrounds: ink `#0A0A0A`, fold `#DE2D1E`.

## Rules

- **Colours:** only those four. No gradients, shadows, outlines or recolouring.
- **Clear space:** at least 80 units on every side, the size of the fold (a quarter of the symbol's height).
- **Minimum size:** the horizontal lockup 24 px tall; below that use the symbol. The favicon uses a tile (see `public/`) because a bare page loses its edge on some tabs.
- **Do not centre the E** in the page: it is inset 64 from the left and bottom, and its top sits level with the fold's lower edge (y = 80).
- **Do not set the name in another font** next to the mark: the wordmark's stroke is matched to the E's stem.
- **READER** is a descriptor, not part of the name. In the app it is HTML text; the file with READER is for documents.

## Fonts

Inter Tight (variable, weight 600) and JetBrains Mono (Medium), both SIL Open Font License 1.1, which permits outlining them into a logo. The outlines in these files are derived works under that license.

## Regenerating

```
npm pack @fontsource-variable/inter-tight @fontsource/jetbrains-mono   # then untar both
pip install fonttools brotli uharfbuzz pillow                            # and install librsvg2-bin
python3 scripts/brand/make_brand.py --inter-tight <inter-tight-latin-wght-normal.woff2> \
    --mono <jetbrains-mono-latin-500-normal.woff2> --write
```

Without `--write` it only renders a spacing comparison. Then run `npm test`: `tests/unit/brand-assets.test.ts` checks the outputs.
