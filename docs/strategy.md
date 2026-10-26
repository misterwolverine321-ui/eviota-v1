# Product strategy (owner-supplied)

> **Provenance.** Pasted by the project owner on 2026-10-07 as the direction for checkpoint 3 onward. It was written outside this repository. Its statements about other products (Readest, Koodo, KOReader, BookFusion, Thorium) were **not independently checked** — treat them as claims, not facts.
>
> **Condensed, not verbatim.** The table's "What competitors do" column and the inline source links were left out because they are unverified; the position, feature list, "features to avoid" and release order are as supplied, with some feature descriptions shortened. The state of each item here is tracked in `roadmap.md` under "Positioning"; `HANDOVER.md` lists what is next.

Yes—there is a real path without sync. But don't try to be "the app with the most formats." Readest, Koodo, and KOReader already cover much of that ground. Win by becoming the best private tool for reading, repairing, studying, and preserving a messy personal library.

## The position to own

> **The private reading workbench for files other readers cannot handle.**

No account. No upload. No cloud AI. No loss of ownership.

## Highest-value on-device features

| Priority | Feature                            | How this app can win                                                                                                                                                                                                                       |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0       | **Private Shelf Search**           | Search every imported book, OCR text, title, author, note, highlight, tag, and annotation instantly—offline. Show exact page/chapter context and jump directly there. Make it dramatically fast on a 5,000-book library.                   |
| P0       | **Universal annotations**          | Give every format the same highlight, note, bookmark, tag, export, and search experience. Include robust re-anchoring when a file is replaced by a newer edition. Export clean Markdown, HTML, JSON, and CSV with source location/context. |
| P0       | **Safe local-file mode**           | Make "safe reading" visible: block scripts, remote media, tracking pixels, and external links by default; show a permission panel when a document requests anything external.                                                              |
| P0       | **Library health and repair**      | On import, diagnose bad EPUB manifests, corrupt archives, missing covers, duplicate books, bad metadata, broken encodings, and unsearchable scans. Offer a local "repair copy" while preserving the original.                              |
| P1       | **Offline semantic search**        | Optional on-device semantic search: "that part about grief near the lake" finds passages without any book text leaving the device. Results must always show exact source passages—never unsupported AI answers.                            |
| P1       | **Study workspace**                | Turn highlights into a local research surface: grouped ideas, backlinks to passages, source-aware notes, side-by-side book/PDF comparison, and one-click exports for Obsidian/Markdown.                                                    |
| P1       | **Excellent scanned-PDF workflow** | One local workflow: deskew, rotate, crop margins, clean contrast, run OCR, correct reading order, make text searchable, and retain a reversible original.                                                                                  |
| P1       | **Comic and manga workstation**    | Automatic panel detection, manual panel correction, right-to-left mode, double-page-spread handling, reading-direction memory, and image-enhancement controls.                                                                             |
| P1       | **Local language packs**           | Downloadable offline dictionaries, morphology, fonts, hyphenation, and text segmentation—starting with Nepali/Devanagari plus English. No word lookup leaves the device.                                                                   |
| P2       | **Private reading analytics**      | Local-only reading history: time by book, completion patterns, unread-library decay, annotation density, and "return to unfinished books." Raw data exportable and deletable in one click.                                                 |
| P2       | **Encrypted personal vault**       | Optional passphrase-encrypted library and backup, using established browser cryptography. Clearly warn that a forgotten passphrase cannot be recovered.                                                                                    |
| P2       | **Device-aware reader modes**      | Low-light, dyslexia-friendly typography controls, one-handed mobile controls, distraction-free continuous reading, precise keyboard mode, and large-print/low-vision mode.                                                                 |

## Three features most likely to matter

1. **Private Shelf Search** — the headline feature. Import hundreds of PDFs, comics, EPUBs and old documents, then find any remembered idea, note, quote, or scanned-page text in seconds, completely offline.
2. **Document repair + OCR studio** — rescue poorly scanned PDFs, repair EPUB metadata, make old documents usable.
3. **Universal annotation vault** — notes and highlights that are portable, searchable, exportable, and resilient even when book files change.

## Features to avoid

- Social feeds, shared highlights, communities, book stores, recommendations.
- Cloud sync, user accounts, forced subscriptions.
- Generic "chat with your book" that invents answers.
- DRM support as a core promise; it is legally and technically expensive.
- A marketplace or public library hosting.

Thorium should remain the recommendation for accessibility-first or LCP-DRM readers.

## Release order

Before any new feature: finish security, browser testing, licence/asset clearance, naming, privacy disclosures, and accessibility.

Then build in this order:

1. Fast, dependable imports and universal local search.
2. Annotation portability and excellent exports.
3. Safe-document mode and robust file repair.
4. Scanned-PDF OCR studio.
5. Offline semantic search and study workspace.
6. Comics/manga and local-language excellence.
7. Optional encrypted vault and private analytics.
