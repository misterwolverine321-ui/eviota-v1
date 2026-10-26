# Brand constraints and logo hand-off

Measured from `src/styles.css` on 2026-10-07. An older line in `futureplans.md` says the signal red is `#FF3B00`; the code says otherwise, and the code wins.

## Tokens (as built)

| Token                               | Light     | Dark      |
| ----------------------------------- | --------- | --------- |
| Background                          | `#fdfdfd` | `#111111` |
| Foreground                          | `#0a0a0a` | `#f5f5f5` |
| Signal red (fills, buttons)         | `#de2d1e` | `#de2d1e` |
| Signal ink (red text, icons, focus) | `#de2d1e` | `#ff5541` |

Type: Inter Tight (display, semibold), Inter (text), JetBrains Mono (tiny wide-tracked uppercase labels), Lora (reading text). Hairline borders, 3 px corner radius, flat, no shadows. The header today is the text `EVIOTA` beside the small red mono label `READER` (`src/routes/index.tsx`).

## The logo (checkpoint 5)

A page with an E cut out of it and a red folded corner, beside the word EVIOTA. Source: `scripts/brand/make_brand.py`; outputs in `brand/` (see `brand/README.md`), `public/` and `src/components/brand/`.

- Origin: the owner's session with an outside tool wrote SVG code for eight concepts; concept 5 was chosen. Its files were rebuilt rather than traced because the wordmark was live text and the lockups had layout bugs (measured, in the log).
- Symbol construction (320-unit page): the E is inset 64 from the left and bottom edges, its top sits on y = 80 (level with the fold's lower edge) and its base on y = 256, its stem and arms are all 32 units thick, and the fold is 80 × 80. Do not centre the E.
- Wordmark: Inter Tight at **weight 600** (its I stem is 31.9 units against the E's 32), cap height 176 = the E's height, baseline on the E's baseline, tracking +0.05 em with the font's own kerning, 96 units from the page. READER (JetBrains Mono Medium, +0.3 em tracking, 28% of the cap height) sits on the same baseline, 72 units after the word.
- Colours: ink `#0A0A0A`, signal `#DE2D1E`; on dark, paper `#F5F5F5`, fold `#FF5541`, background `#111111`. Nothing else (enforced by a test).
- Icons: `any` tiles are a dark rounded square with the page at 62%; the maskable icon is full-bleed with the page at 54%, checked by the generator to keep all content inside the 40%-radius safe circle; apple-touch-icon is full-bleed with no alpha.
- In the header the READER label is HTML text, shown from the `sm` breakpoint up; `mb-1` lines its baseline up with the wordmark's (computed from JetBrains Mono's metrics, not observed).

## Still open

- Seen on desktop (dark mode, dev server): the header logo, with READER on the wordmark's baseline. Not yet seen: phone width, light mode, the tab icon, installed-app icons.
- Not done: Devanagari companion wordmark (needs an exact spelling and a Nepali reader's check), stacked lockup, reverse-image search for look-alikes, trademark search for the name.
