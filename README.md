# Eviota

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/eviota-logo-dark.svg">
  <img alt="Eviota" src="brand/eviota-logo.svg" height="56">
</picture>

Eviota is a private reader for the files other readers struggle with: scanned books, comics, PDFs, DjVu and the rest of the messy shelf. It runs entirely in your browser. Import your files, read them with saved progress, highlights and notes, and keep everything on your own device. There is no account, no upload and no server.

This is version 1 (v1). I built it as a free, static web app.

## What it opens

| Kind      | Formats                              |
| --------- | ------------------------------------ |
| E-books   | EPUB, MOBI, AZW / AZW3, FB2          |
| Documents | PDF, HTML, plain text, RTF, Markdown |
| Comics    | CBZ, CBR, CB7 (with ComicInfo.xml)   |
| Scans     | DjVu                                 |

DjVu pages are decoded on your device by [`djvu-rs`](https://www.npmjs.com/package/djvu-rs), an MIT-licensed decoder compiled to WebAssembly and bundled with the app. Its notice is in the third-party notices. DjVu has search where the file carries a text layer, one or two pages at a time and a kept place, but no zoom, table of contents, highlights or notes yet. The first DjVu file you open on a device stores the decoder for offline use.

CHM files can be added to the shelf and kept, but Eviota does not open them yet. I removed the CHM decoder because of its licence, and a permissively licensed replacement is planned. Opening one shows a screen that says so and gives the file back unchanged.

Reading tools include highlights, underlines and notes; full-text search, with text recognition for scanned pages; read-aloud; a dictionary lookup; a guided panel view for comics; PDF page tools (rotate, delete, reorder, extract, merge); collections and tags; and light, dark and system themes. Books you have not opened yet are searchable from the shelf if they are EPUB, MOBI/AZW3, FB2, PDF, plain text, RTF, Markdown or HTML, and a result opens the book at the match.

Importing checks each file. A file whose bytes are already on the shelf is skipped, even under another name. An empty file, or one whose contents are not the kind its name says (a text file named `.pdf`, say), is not imported, and the message says why.

## Reading controls

| To                    | On a phone or tablet                                                   | On a computer                                            |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Turn to the next page | Tap the right third, or swipe left                                     | Right arrow, Page Down or Space, or click the right edge |
| Turn back             | Tap the left third, or swipe right                                     | Left arrow or Page Up, or click the left edge            |
| Show the bars         | Tap the middle, or the top or bottom edge                              | Move the mouse to the top or bottom edge                 |
| Hide the bars         | Tap the middle again, or wait a few seconds                            | Esc, or wait a few seconds                               |
| Zoom the text         | Use the text size in Settings (pinch zooms the page in PDF and comics) | Use the text size in Settings                            |

Two taps in quick succession never show or hide the bars. Double-tapping a comic page zooms in on that spot; everywhere else a double tap does nothing.

## Safe reading

A book is an untrusted file. Before an EPUB, MOBI/AZW3, HTML or Markdown page is shown, Eviota removes scripts, inline event handlers and `javascript:` links, drops embedded frames, and refuses to load remote images, stylesheets and fonts. A shield button in the reader lists what was removed and which addresses were not contacted. A link in a book never opens by itself: you are asked first. There is no setting to allow remote content.

## Exporting your notes

Highlights, notes and bookmarks export as Markdown (Obsidian-friendly), HTML, JSON or CSV, for one book from its notes tab or for the whole shelf from Settings. Each export includes the chapter or page and the words around each mark.

## Privacy

Books, notes and progress are stored in your browser (IndexedDB) and never uploaded. The interface typefaces (Inter, Inter Tight, JetBrains Mono and Lora, all under the SIL Open Font License) are part of the app, so opening the shelf, a book or Settings contacts no other site.

The one thing Eviota itself can send is a word you look up with _Define_. It asks first: looking a word up sends that word, and your internet address as for any request, to Wiktionary (and to Wikipedia if Wiktionary has no entry), at `<language>.wiktionary.org` and `<language>.wikipedia.org` for the book's language. Nothing else from the book goes in the request, and the page sends no referrer. You are asked once; the answer is kept on this device, and _Settings → Privacy_ turns the question back on. The _Read more_ link in a definition asks before it opens a page, as a link in a book does.

Back up your shelf from _Settings_ as a `.eviota.zip` file you keep. Browsers can clear site data, especially on iPhone if the app is not added to the Home Screen.

## Testing

Every push to `main` and every pull request runs two jobs in GitHub Actions (`.github/workflows/ci.yml`):

- **checks:** unit tests (838 tests in 85 files), type checking, lint, the production build and the static-site check (`npm run verify:static`), which confirms the built folder is self-contained.
- **browser:** the browser tests in desktop Chromium (180 passed, 1 skipped by design), including an accessibility audit, hostile-file checks, backup and restore, the reading taps with a mouse and with touch, page-turn feedback, the selection bar, dark pages, the back stack, and phone-sized windows. Failing test traces are kept as an artifact for seven days.

Not yet tested: Safari (WebKit), a real phone, and a screen reader.

## Run it locally

```sh
npm install              # a committed .npmrc works around an npm 10 resolver crash
npm run dev              # development server
npm test                 # unit tests
npx playwright install chromium   # once, for the browser tests
npm run test:e2e         # browser tests in desktop Chromium (builds first)
npm run test:e2e:webkit  # WebKit and an iPhone profile; needs `npx playwright install webkit`; not run yet
npm run build            # static site in dist/
npm run verify:static    # checks dist/ is a self-contained static site
```

The app uses hash-based routes and relative URLs, so the built folder works from any address or sub-path.

## Hosting on Cloudflare Workers

The site is served by a Cloudflare Worker that builds from this repository on GitHub. `wrangler.jsonc` names the static folder (`dist/`) and nothing else. The repository can stay private.

Do not deploy until Cloudflare Access protects the address. The `workers.dev` address is open to anyone who has the link until then.

1. Turn on Cloudflare Zero Trust for the account. It needs a payment method on file. Then create an Access application for the Worker's `workers.dev` address (the Worker is named `eviota`), allowing only your own email address.
2. In Cloudflare, open **Workers & Pages → Create**, connect your GitHub account, and choose this repository.
3. Set the production branch to `reading-taps` for now. Each push to that branch rebuilds and redeploys the site.
4. Set the build command to `npm run build` and the deploy command to `npx wrangler deploy`.
5. Add an environment variable `NODE_VERSION` with the value `22`.
6. Save and deploy.
7. In a private browser window, open the address. It should ask you to sign in before it shows the shelf. Only share the address once this check passes.
8. For a custom domain later, add it to the Worker under its domain settings and let Cloudflare create the DNS records.

Once `main` has the reader changes, switch the production branch to `main`.

To install the app on a phone, open the address and use _Add to Home Screen_ (iPhone: Share → Add to Home Screen; Android: the browser's Install option). Each address has its own library. A library on one address or device does not appear on another, so use the backup file to move it.

## Project layout

- `src/` — the app: routes, reader engines, library and shelf code.
- `tests/` — unit tests (`tests/unit`) and browser tests (`tests/e2e`).
- `public/` — static files, sample books, icons and the vendored engines.
- `brand/` — logo files and the rules for using them.
- `scripts/` — the build checks and the generators for notices, covers, samples and the logo.
- `public/THIRD_PARTY_NOTICES.txt` — the licences of what is included. `npm run notices` rewrites it.

## Licence

Eviota's own code is available under either the [MIT licence](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at your option. Copyright (c) 2026 Eviota Contributors.

The licence does not cover `src/components/ui/`, which comes from shadcn/ui under the MIT licence.

What Eviota includes from other people, and the licence each part states, is in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt). The app ships that file and links to it from Settings. It records what the files say and what I could not establish. It is not legal advice.
