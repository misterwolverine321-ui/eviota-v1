# Eviota

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/eviota-logo-dark.svg">
  <img alt="Eviota" src="brand/eviota-logo.svg" height="56">
</picture>

A private reading workbench that runs entirely in your browser, aimed at the messy files other readers struggle with. Import books, scans and comics, read them with saved progress, highlights and notes, and keep everything on your own device. No account, no upload, no cloud AI.

> **Status: early.** It builds, passes its unit tests, a static-site check and 145 automated desktop-Chromium tests (including an accessibility audit of names and structure read from Chromium's accessibility tree, and a phone-sized, touch-enabled walk-through), and a reviewer has driven the production build in desktop Chromium (including phone-sized windows, an offline start, and backups restored into fresh profiles, with and without the book files). It honours the system's "reduce motion" setting (tested in Chromium with the setting emulated). It has not been tested on a real phone, in Safari, or with a screen reader. See [HANDOVER.md](HANDOVER.md) for exactly what has and hasn't been verified.

## What it opens

| Kind      | Formats                              |
| --------- | ------------------------------------ |
| E-books   | EPUB, MOBI, AZW / AZW3, FB2          |
| Documents | PDF, HTML, plain text, RTF, Markdown |
| Comics    | CBZ, CBR, CB7 (with ComicInfo.xml)   |
| Scans     | DjVu                                 |

DjVu pages are decoded on your device by [`djvu-rs`](https://www.npmjs.com/package/djvu-rs) (MIT, compiled to WebAssembly and part of the app; its own notice is in the third-party notices, and the author's statement about its licences is in [issue #949](https://github.com/matyushkin/djvu-rs/issues/949) on its tracker). DjVu has search where the file carries its text layer, one or two pages at a time and a kept place, but no zoom, table of contents, highlights or notes yet, and the first DjVu file you open on a device is what stores the decoder for offline use. It has been seen working in desktop Chromium only.

CHM files can be added to the shelf and kept, but Eviota does not open them yet: the CHM decoder it had was removed because of its licence (see [HANDOVER.md](HANDOVER.md)), and a permissively licensed replacement is planned. Opening one shows a screen that says so and gives the file back unchanged.

Reading tools include annotations (highlights, underlines, notes), full-text search with OCR for scanned pages (books you have not opened yet are searched from the shelf if they are EPUB, MOBI/AZW3, FB2, PDF, plain text, RTF, Markdown or HTML, and a result opens the book at the match; comics (once text recognition is turned on) and DjVu (on the text layer the file carries, or with text recognition turned on) are searched inside their reader only), read-aloud, dictionary lookup, a guided panel view for comics, PDF page tools (rotate, delete, reorder, extract, merge), collections and tags, and light / dark / system themes.

Importing checks each file. A file whose bytes are already on the shelf is skipped, even under another name. An empty file, or one whose contents are not the kind its name says (a text file named `.pdf`, say), is not imported, and the message says why.

## Safe reading

A book is an untrusted file. Before an EPUB, MOBI/AZW3, HTML or Markdown page is shown, Eviota removes scripts, inline event handlers and `javascript:` links, drops embedded frames, and refuses to load remote images, stylesheets and fonts (the usual tracking pixels). A shield button in the reader lists what was removed and which addresses were not contacted. A link in a book never opens by itself: you are asked first. There is no setting to allow remote content.

This is checked by unit tests against the real EPUB loader and a deliberately hostile EPUB, and by automated browser tests that open hostile EPUB, HTML, Markdown and PDF files in desktop Chromium: no script ran, no request left for the addresses they named, and an external link opened only after confirmation, whether it was clicked with the left or middle button, Ctrl or Shift held, or followed with the Enter key. None of this has been repeated in Safari or on a phone, so treat it as unproven there; and a browser's own right-click or long-press menu on a link is outside what the page can intercept.

## Exporting your notes

Highlights, notes and bookmarks export as Markdown (Obsidian-friendly), HTML, JSON or CSV, for one book from its notes tab or for the whole shelf from Settings, with the chapter or page and the words around each mark.

## Privacy

Books, notes and progress are stored in your browser (IndexedDB) and never uploaded. There is no account and no server. The interface typefaces (Inter, Inter Tight, JetBrains Mono and Lora, all under the SIL Open Font License) are part of the app, so opening the shelf, a book or Settings contacts no other site; this was checked in desktop Chromium, which made no request to any address but the app's own.

The one thing Eviota itself can send is a word you look up with _Define_ (opening a link makes your browser visit that site, and only after you confirm). _Define_ asks first: looking a word up sends that word, and your internet address as for any request, to Wiktionary (and to Wikipedia if Wiktionary has no entry), at `<language>.wiktionary.org` and `<language>.wikipedia.org` for the book's language. Nothing else from the book is put in the request, and the page sets a `no-referrer` policy, so the request does not even say where it came from. You are asked once; the answer is kept on this device, and _Settings → Privacy_ turns the question back on. The _Read more_ link in a definition asks before it opens a page, as a link in a book does.

Back up your shelf from _Settings_ as a `.eviota.zip` file you keep; browsers can clear site data, especially on iPhone if the app is not added to the Home Screen.

## Run it

```sh
npm install        # a committed .npmrc works around an npm 10 resolver crash
npm run dev        # development server
npm test           # unit tests
npm run test:e2e   # browser tests in desktop Chromium (builds first)
npm run test:e2e:webkit  # the same in WebKit and an iPhone profile; needs `npx playwright install webkit`, never run by the project yet
npm run build      # static site in dist/
npm run verify:static
```

## Host it for free on GitHub Pages

The build is a plain static folder using relative URLs and hash-based routes, so it works from any path.

1. Push this repository to GitHub.
2. _Settings → Pages → Build and deployment → Source:_ **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` runs typecheck, tests and the build, then deploys `dist/`.

To install it on a phone, open the published address and use _Add to Home Screen_ (iPhone: Share → Add to Home Screen; Android: the browser's Install option).

## Project notes

- `HANDOVER.md` — current state, next steps and open decisions.
- `futureplans.md` — technical detail and a dated verification log.
- `roadmap.md` — checklist.
- `brand/` and `docs/brand.md` — logo files and the rules for them.
- `docs/strategy.md` — the product direction (owner-supplied; claims about other products unverified).
- `AGENTS.md` — rules for contributors and AI agents.
- `LICENSE-MIT`, `LICENSE-APACHE` — the two licences for Eviota's own code.
- `public/THIRD_PARTY_NOTICES.txt` — licences of what is included (`npm run notices` rewrites it).

## Licence

Eviota's own code is available under either the [MIT licence](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at your option. This was chosen by the owner on 2026-10-15; copyright line: "Copyright (c) 2026 Eviota Contributors". It covers what the Eviota contributors wrote and changes nothing about the licence of anything else in the repository or in the built app.

Not covered by that statement, and listed in PART 5 of the notices: `src/components/ui/` (shadcn/ui, MIT, Copyright (c) 2023 shadcn).

What Eviota includes from other people, and the licence each part states, is in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt), which also ships with the app and is linked from Settings. That file records what the files say and what could not be established; it is not legal advice.
