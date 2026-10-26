# Test files for the DjVu reader

Three real DjVu files, used only by `tests/e2e/djvu.spec.ts`. They are not part of the site (nothing
under `tests/` is built into `dist/`) and `public/THIRD_PARTY_NOTICES.txt` does not cover them.

| File                           | Bytes     | SHA-256                                                            | Pages | What it is                                                            |
| ------------------------------ | --------- | ------------------------------------------------------------------ | ----- | --------------------------------------------------------------------- |
| `cable_1973_100133.djvu`       | 15,486    | `ceaac0b3bf8b4ea665c09e26a6f00d5d1e95b00757a7d2b9613948f16610d96b` | 2     | A 1973 US State Department cable, black and white, with text.         |
| `cyrillic_simonovich_co2.djvu` | 171,563   | `596258ef4c283fc33be1e0f77a5778378a5a95220b09776d0fdd05d1744d14ad` | 12    | A 1905 Russian booklet on carbon dioxide, with a text layer.          |
| `goody_twoshoes.djvu`          | 1,060,487 | `20b594d3207d07b98b8ef0f8b6cd8744e94942575e71916cdac8684f5b5eeb97` | 16    | A 1888 children's book with colour illustrations (colour IW44 pages). |

## Where they came from (claims, not findings)

The first two were copied on 2026-10-17 from `tests/corpus/` in the `djvu-rs` repository at commit
`124ba49266443086fc5d395110f5ba325d598197` (2026-10-16). `goody_twoshoes.djvu` was copied on
2026-10-18 from the same directory. That repository's `tests/corpus/README.md` says the files are public
domain and names their sources; its `scripts/fetch_corpus.sh` pins the SHA-256 of `goody_twoshoes.djvu`
(the value above matches) and gives the archive.org address
`https://archive.org/download/goodytwoshoes00newyiala/goodytwoshoes00newyiala.djvu`, whose item is
`https://archive.org/details/goodytwoshoes00newyiala` (1888, marked NOT_IN_COPYRIGHT by the corpus README).
What was not checked for it: that the archive.org page itself says so, and the law of any country.
This is a claim of the repository, not a finding of Eviota.

The first two files' sources are below. **Nothing here is a legal conclusion.**
What was checked on 2026-10-17, by reading the two Internet Archive item pages through a fetch tool
(a summary by the tool, not a copy of the page):

- `https://archive.org/details/State-Dept-cable-1973-100133`: creator "State Department",
  collections including "U.S. State Department" and "US Government Mirrored Documents (Citizen
  Collection)", published 1973, uploaded 2016-02-09. The page has **no** licence or rights field.
  That the file is a US federal government work, and so not under copyright, is the corpus README's
  statement (it cites 17 U.S.C. § 105); `scripts/fetch_corpus.sh` in that repository still has the
  placeholder `PLACEHOLDER_TIER1` where the file's checksum should be.
- `https://archive.org/details/20200630_simonovich_uglekislota`: creator "Симонович Н.Я.",
  published 1905 in Tver, 12 pages, uploaded 2020-06-30 by a user named "Russian Lutheran"; its
  Usage field reads "Public Domain Mark 1.0". The page has no other rights statement.

Not checked: whether the copies in the `djvu-rs` repository are byte-identical to the Internet
Archive's files (the SHA-256 of the Simonovich file equals the one in that repository's
`scripts/fetch_corpus.sh`; the cable's checksum there is a placeholder), the law of any country, or
anything the pages do not say. If either file should not be kept, delete it and its specs.

## Not in the repository

A large scan (`big_scanned_page.djvu`, 6780 × 9148 pixels, a photograph-sized colour page) is in
`djvu-rs`'s corpus with the note that it comes from a `djvu.js` test asset under the Unlicense. Its
original source is not known, so it is **not** copied here. `djvu.spec.ts` runs a large-scan test only
when `EVIOTA_LARGE_DJVU` names a local `.djvu` file (e.g. `EVIOTA_LARGE_DJVU=/path/to/file.djvu npx
playwright test tests/e2e/djvu.spec.ts -g "large scan"`); otherwise that test is skipped. On 2026-10-18
the file in the `djvu-rs` checkout drew its first page in 3,264 ms in desktop Chromium.
