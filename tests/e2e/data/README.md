# Test files for the DjVu reader

These three DjVu files are used only by `tests/e2e/djvu.spec.ts`. They are not part of the site: nothing under `tests/` is built into `dist/`, and the third-party notices do not cover them.

| File                           | Bytes     | SHA-256                                                            | Pages | What it is                                                            |
| ------------------------------ | --------- | ------------------------------------------------------------------ | ----- | --------------------------------------------------------------------- |
| `cable_1973_100133.djvu`       | 15,486    | `ceaac0b3bf8b4ea665c09e26a6f00d5d1e95b00757a7d2b9613948f16610d96b` | 2     | A 1973 US State Department cable, black and white, with text.         |
| `cyrillic_simonovich_co2.djvu` | 171,563   | `596258ef4c283fc33be1e0f77a5778378a5a95220b09776d0fdd05d1744d14ad` | 12    | A 1905 Russian booklet on carbon dioxide, with a text layer.          |
| `goody_twoshoes.djvu`          | 1,060,487 | `20b594d3207d07b98b8ef0f8b6cd8744e94942575e71916cdac8684f5b5eeb97` | 16    | A 1888 children's book with colour illustrations (colour IW44 pages). |

## Where they came from

The first two files were copied on 2026-10-17 from `tests/corpus/` in the `djvu-rs` repository, at commit `124ba49266443086fc5d395110f5ba325d598197` (2026-10-16). `goody_twoshoes.djvu` was copied on 2026-10-18 from the same directory.

That repository's corpus README says the files are public domain and names their sources. Its `scripts/fetch_corpus.sh` pins the SHA-256 of `goody_twoshoes.djvu` (the value above matches it) and gives the Internet Archive address `https://archive.org/download/goodytwoshoes00newyiala/goodytwoshoes00newyiala.djvu`. The corpus README marks that 1888 book as not in copyright.

I have not checked that the Internet Archive page itself says so, or the law of any country. These are the repository's claims, not my findings.

For the first two files, I read the two Internet Archive item pages on 2026-10-17 through a fetch tool, which returns a summary rather than a copy of the page:

- `https://archive.org/details/State-Dept-cable-1973-100133`: creator "State Department", collections including "U.S. State Department" and "US Government Mirrored Documents (Citizen Collection)", published 1973, uploaded 2016-02-09. The page has no licence or rights field. The corpus README says the file is a US federal government work, citing 17 U.S.C. § 105. Its `scripts/fetch_corpus.sh` still has the placeholder `PLACEHOLDER_TIER1` where this file's checksum should be.
- `https://archive.org/details/20200630_simonovich_uglekislota`: creator "Симонович Н.Я.", published 1905 in Tver, 12 pages, uploaded 2020-06-30 by a user named "Russian Lutheran". Its Usage field reads "Public Domain Mark 1.0". The page has no other rights statement.

I have not checked whether the copies in the `djvu-rs` repository are byte-identical to the Internet Archive's files. The SHA-256 of the Simonovich file matches the one in that repository's script; the cable's checksum there is a placeholder. I have reached no legal conclusion. If either file should not be kept, delete it and its specs.

## Not in the repository

A large scan, `big_scanned_page.djvu` (6780 × 9148 pixels, a photograph-sized colour page), is in the `djvu-rs` corpus with a note that it comes from a `djvu.js` test asset under the Unlicense. Its original source is not known, so I have not copied it here.

`djvu.spec.ts` runs a large-scan test only when `EVIOTA_LARGE_DJVU` names a local `.djvu` file, for example:

```sh
EVIOTA_LARGE_DJVU=/path/to/file.djvu npx playwright test tests/e2e/djvu.spec.ts -g "large scan"
```

Otherwise that test is skipped. On 2026-10-18 the file in a `djvu-rs` checkout drew its first page in 3,264 ms in desktop Chromium.
