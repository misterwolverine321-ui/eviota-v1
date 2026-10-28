> **Read this first (2026-10-05).** Sections of this file about Supabase, cloud sync, WebDAV, Google Drive, the AI gateway, TanStack Start, Nitro/Cloudflare and an outside app builder describe code that was **removed at checkpoint 2** when the app (then called Folio) became a static, client-only app. Keep them as history, not as a description of the code. The current state is in `HANDOVER.md` and the **Verification log** at the end of this file.

# Eviota — Future Build Plan (formerly Folio, then Nawiri)

Everything below is achievable **fully client-side in the browser** (WASM + Web Workers + IndexedDB). The app (called Folio when this was written; renamed Nawiri at checkpoint 3 — the rest of this file keeps the old name as history) is releasing as a free static app on GitHub Pages; account sync, Google Drive, cloud AI, and “Publish on the builder” are no longer priorities. After this round, the product is under feature freeze. Each historical item is marked:

- **[A]** achievable now with libraries already in the stack
- **[B]** achievable with one new WASM/JS dependency
- **[C]** heavy — needs a worker pipeline, large WASM, or a backend

---

## 0. Where we are today

### Final UI round — priorities (2026-10-04)

- [x] Empty shelf keeps the large hero with Add books; populated shelf uses a compact book-count header and retains Continue Reading. Empty card has a drop hint.
- [x] Keep one Add books action in the header, with an additional empty-hero action; rename Storage to Settings. Samples wait for library load.
- [x] Use “Your books stay on this device.” in the hero and page description; clarify AI passage sharing.
- [x] Raise uppercase mono micro-labels from 10px to 11px.
- [x] Add Match app as the default reader theme; map light to Paper and dark to Dusk, with Dusk enabling PDF inversion by default.
- [x] Replace legacy red search/spoken highlights across PDF, HTML, text, and search results; use a lighter Dusk tint.
- [x] Make Display font options readable in dark mode.
- [x] Add a remembered, dismissible iPhone/iPad install card in any browser.
- [x] Delete dead `src/test/` scaffolding and keep it deleted. (Verified 2026-10-04: a previous round ticked this without doing it; it is deleted now and `tsc` is clean.)
- [x] Typecheck (0 errors), unit tests (351 across 35 files) and the production build verified independently on 2026-10-04. Browser checks at 280/360px and desktop were reported by the first session and are not independently verified.

### Theme system — shipped (2026-10-04)

- System, Light and Dark appearance modes persist under `folio-theme`; System is the default.
- The saved or system choice is applied before first paint, including native controls and browser chrome.
- Appearance controls are available in Settings and the library header.
- Toasts and both application and emergency error pages follow the active appearance.
- Reader annotation, search and spoken highlights use stronger dark-surface treatments to preserve text legibility.
- Theme behavior is covered by focused unit tests and browser checks.

### Phone and installed-app check — passed (2026-10-04)

- Library and Settings tested at iPhone SE (320, 375), iPhone 15 (393), iPhone Pro Max (430), Pixel 7 (412) and Galaxy S20 (360): no sideways scrolling, no clipped buttons, no page errors, in both light and dark.
- Library header buttons collapse to icons on narrow phones (Storage label from 640px, Import label from 360px).
- Install setup verified: manifest (standalone, 192/512 + maskable icons), Apple touch icon, theme colour, and the offline helper never starts in preview.
- Galaxy Fold folded (280px) fixed (2026-10-04): the sort control hid its "Sort" label and tightened button spacing below 360px, and the Settings appearance toggle wraps to two rows — re-tested at 280/320/360/393px on both pages, no sideways scrolling anywhere.

### Release direction (agreed 2026-10-04)

The final UI round above is the only active priority. Account sync, Google Drive, cloud AI, and builder publishing are explicitly out of priority for the free GitHub Pages release.

| Layer                             | Status                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Format registry (16 ext)          | done — `src/lib/formats.ts`                                                                                                      |
| Storage (IndexedDB books + blobs) | done — `src/lib/db.ts`                                                                                                           |
| Metadata + cover extraction       | done — `src/lib/books.ts`                                                                                                        |
| Engines                           | foliate (EPUB/MOBI/AZW3/FB2/CBZ), pdf.js, text (TXT/RTF), html, comic (CBR/CB7 via libarchive), djvu (DjVu.js)                   |
| Reader chrome                     | theme, typography, TOC, progress, keyboard nav                                                                                   |
| Sync                              | **shipped** — provider-shaped merge engine + settings panel, real account sync via the Cloud provider (plus a local demo remote) |
| Missing                           | nothing on the roadmap; what remains is optional depth (see §12)                                                                 |

---

## 1. Feature Matrix — what we will build

### 1.1 Reflowable eBooks (EPUB / MOBI / AZW3 / FB2)

Target: beat Moon+ Reader Pro.

| Feature                                                                                                                                                             | Tier | Notes                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------ |
| Full typography engine (font family incl. user-uploaded fonts, size, weight, letter/word spacing, line height, paragraph indent, text align, margins, page padding) | A    | extend `ReaderSettings`, inject CSS into foliate renderer    |
| Hyphenation + justification                                                                                                                                         | A    | `hyphens: auto` + `lang` propagation from OPF metadata       |
| Dark-mode tinting (invert images optionally, sepia overlay strength, custom bg/ink pickers)                                                                         | A    | extend `READER_THEMES` with a `custom` theme                 |
| Column modes: 1-col / 2-col / auto by width, scrolled vs paginated                                                                                                  | A    | foliate `renderer.setAttribute('max-column-count')`          |
| Highlights (5 colors), notes, bookmarks                                                                                                                             | A    | CFI-anchored records in a new `annotations` store            |
| Full-text search inside book with hit list + jump                                                                                                                   | A    | foliate `book.sections` text extraction, indexed in a worker |
| Dictionary lookup + Wikipedia panel on selection                                                                                                                    | B    | Wiktionary/Wikipedia REST (public, no key)                   |
| Text-to-speech read-aloud with sentence highlight                                                                                                                   | A    | Web Speech API + CFI range walker                            |
| Reading stats: session time, pages/hour, streaks, ETA to finish                                                                                                     | A    | `sessions` store; dashboard on library page                  |
| Auto-scroll mode with speed control                                                                                                                                 | A    | rAF scroll driver in scrolled flow                           |
| Per-book settings override                                                                                                                                          | A    | `settingsOverride` field on `BookRecord`                     |
| Cloud & progress sync                                                                                                                                               | C    | see §4                                                       |

### 1.2 Fixed Layout & PDF

Target: beat PDF Expert / Xodo.

| Feature                                                                       | Tier | Notes                                                                         |
| ----------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| Instant, crisp zoom (progressive re-render at device DPR, tile cache)         | A    | render at `scale * dpr`, LRU canvas cache, CSS transform preview during pinch |
| Pinch-zoom + pan gesture layer                                                | A    | Pointer Events, no library                                                    |
| Text layer: selection, copy, find-in-document with highlight                  | A    | pdf.js `getTextContent()` + `TextLayerBuilder` equivalent                     |
| Annotations: highlight, underline, strikeout, freehand ink, text note, shapes | A    | overlay SVG per page, stored in `annotations`                                 |
| Flatten + export annotated PDF                                                | B    | `pdf-lib` writes annotations into the file                                    |
| Page management: rotate, reorder, delete, extract, merge, split               | B    | `pdf-lib`; produces a new blob saved back to `files` store                    |
| Thumbnail sidebar with drag-to-reorder                                        | A    | reuse render pipeline at 0.2 scale                                            |
| Outline/bookmark tree, named destinations, internal links clickable           | A    | pdf.js `getOutline()` + link layer                                            |
| Crop margins / auto-trim whitespace                                           | A    | canvas bounding-box scan                                                      |
| Night mode for scans (invert + contrast curve)                                | A    | CSS filter or canvas LUT                                                      |
| Form filling (AcroForm)                                                       | B    | pdf.js annotation storage + `pdf-lib` save                                    |
| OCR for image-only PDFs                                                       | C    | see §1.6                                                                      |

### 1.3 Comics & Manga (CBZ / CBR / CB7)

Target: beat YACReader / Chunky.

| Feature                                                                                   | Tier | Notes                                                           |
| ----------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------- |
| Smart page fit: fit-width / fit-height / fit-screen / original / smart-fit by aspect      | A    | pure layout logic                                               |
| Dual-spread auto-detect + auto-split of wide pages                                        | A    | detect `w > h`, split canvas into halves in reading order       |
| Manga mode (RTL) toggle, per-book persisted                                               | A    | reverse page order + swipe direction                            |
| Image optimization: brightness/contrast/gamma, sharpen, despeckle, grayscale, auto-levels | A    | canvas convolution in a worker (OffscreenCanvas)                |
| Upscale filter for low-res scans                                                          | B    | Lanczos in worker; optional WASM super-res later                |
| Preload window (n pages ahead), decoded-bitmap LRU cache                                  | A    | `createImageBitmap` + worker                                    |
| Thumbnail grid page-jump                                                                  | A    | cached small bitmaps                                            |
| Double-tap zoom + pan, guided-view panel stepping                                         | A    | Pointer Events; guided view via panel heuristics (contour scan) |
| ComicInfo.xml metadata (series, volume, writer)                                           | A    | parse on import, extend `BookRecord`                            |

### 1.4 Plain Text & Markup (TXT / RTF / HTML / MD)

Target: beat ReadEra / SumatraPDF.

| Feature                                                                                         | Tier | Notes                                            |
| ----------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------ |
| Auto-encoding detection (UTF-8/16, ANSI, Shift-JIS, GBK, KOI8, ISO-8859-x) with manual override | B    | `jschardet`-style detector + `TextDecoder`       |
| Line-ending + wrap normalization, paragraph re-joining for hard-wrapped text                    | A    | in `text-reader` preprocessing                   |
| Markdown rendering (`.md`) as a first-class format                                              | B    | add to registry, render via `marked` + sanitizer |
| HTML clean view: strip nav/ads/inline layout, Readability-style extraction, toggle raw vs clean | B    | `@mozilla/readability` in a worker               |
| Auto-chapter detection from headings / `Chapter N` regex → synthetic TOC                        | A    | feeds existing TOC panel                         |
| Code-block monospace + syntax highlight in HTML/MD                                              | A    | existing JetBrains Mono token                    |
| Same typography + highlight/search stack as §1.1                                                | A    | shared annotation layer                          |

### 1.5 Legacy & Compiled Help (CHM)

**Shipped (Phase 8)** — pure-JS ITSF + LZX decoder, no WASM.

| Feature                                                                | Tier | Notes                                                                                                           |
| ---------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| CHM container decode (ITSF/LZX)                                        | C    | **done** — hand-written JS LZX (`lib/chm/lzx.ts`) + ITSF/PMGL reader (`lib/chm/itsf.ts`)                        |
| `.hhc` TOC parse → sidebar navigation tree                             | A    | **done** — `parseHhc` sitemap parse into `caps.toc`                                                             |
| `.hhk` index + internal hyperlink routing (`mk:@MSITStore:` rewriting) | A    | **done** — `#chm:<path>` rewriting + object-URL assets; `.hhk` keyword index parsed into the drawer's Index tab |
| Render pages through the existing HTML engine                          | A    | **done** — `chm-reader.tsx`, one sandboxed iframe per section                                                   |

### 1.6 Scanned Documents (DJVU)

Currently "recognized, no decoder".

| Feature                                                                            | Tier | Notes                                                               |
| ---------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| DjVu decode (IW44 / JB2 layered)                                                   | C    | `djvu.js` (pure JS) — page-at-a-time in a worker                    |
| Layered rendering: background texture + sharp foreground mask, progressive quality | C    | djvu.js exposes layers; render bg at low res, fg at full            |
| Embedded OCR text layer → search + selection overlay                               | B    | djvu.js hidden-text chunk                                           |
| OCR fallback for DjVu **and** image-only PDFs                                      | C    | `tesseract.js` in a worker, per-page, results cached in `ocr` store |
| Shared page-viewer with the PDF engine (zoom/pan/annotate)                         | A    | extract a common `PagedImageViewer`                                 |

---

## 2. UI / UX Architecture

### 2.1 Information architecture

```text
/                       Library
  ├─ Shelf view (grid | list | series)   search, filter, sort, tags, collections
  ├─ Continue-reading hero
  ├─ Stats strip (streak, time, finished)
  └─ Import zone (drop / picker / sample shelf)
/read/$id               Reader (engine dispatch by format kind)
/library/collections    Collections & tags manager
/stats                  Reading dashboard
/settings               Global defaults, storage usage, sync, backup/restore
```

### 2.2 Reader layout — one chrome, many engines

```text
┌──────────────────────────────────────────────────────────┐
│ ‹  Title · AUTHOR · FORMAT      [TOC][Notes][Search][Aa]  │ 56px
├──────────────────────────────────────────────────────────┤
│                                                          │
│                  ENGINE SURFACE                          │
│   tap-left = prev · tap-center = toggle chrome · right   │
│                                                          │
│   ┌ selection popover ─────────────────┐                 │
│   │ Highlight ▸ Note  Copy  Define  ⇢  │                 │
│   └────────────────────────────────────┘                 │
├──────────────────────────────────────────────────────────┤
│ ‹  ▓▓▓▓▓▓▓▓░░░░░░░░  Ch.7 · 62% · 14m left  ›            │ 48px
└──────────────────────────────────────────────────────────┘
        right drawer (300px): TOC | Notes | Search | Display | Pages
```

Rules:

- **Chrome auto-hides** after 3s of reading; center tap restores. Immersive by default.
- **One drawer component**, five tabs. Never stack panels.
- **Capability-driven controls**: the shell already reads `RendererCaps`; extend it with
  `annotations`, `search`, `pageOps`, `imageAdjust`, `spread`, `rtl`, `tts`, `ocr`.
  A control renders only if the active engine declares it. No dead buttons, ever.
- **Bottom bar adapts**: slider for reflowable, page-number stepper + thumbnail rail for paged, spread indicator for comics.
- **Mobile**: drawer becomes a bottom sheet with drag handle; gestures — swipe page, long-press select, pinch zoom, two-finger tap = theme toggle.
- **Keyboard**: ←/→ page, Space/⇧Space, `f` search, `b` bookmark, `t` TOC, `d` display, `n` notes, `+/-` zoom, `g` go-to-page, `Esc` close.
- **Design language stays Folio**: paper/ink surfaces, hairline borders, signal red `#FF3B00` for the single active accent, mono micro-labels in uppercase tracking, `anim-rise` for panels. No new colors introduced by new features.

### 2.3 Library UX additions

- Faceted rail: Format · Category · Collection · Tag · Status (unread / reading / finished).
- Series grouping with stacked-cover affordance for comics (ComicInfo series).
- Bulk select: tag, delete, export, mark finished.
- Storage meter with per-book size and one-click evict-blob-keep-metadata.

---

## 3. Engineering Structure

### 3.1 Layering (the tower)

```text
┌ Presentation ─ routes/, components/library, components/reader/*
├ Reader Kernel ─ reader-shell + capability contract + drawer system
├ Engine Layer ─ foliate | pdf | image-paged | text | html | chm | djvu
├ Service Layer ─ annotations · search-index · stats · ocr · imageops · sync
├ Worker Layer ─ workers/{archive,ocr,imageops,search,decode}.worker.ts
└ Persistence ─ IndexedDB (books, files, annotations, sessions, search, ocr, settings)
```

### 3.2 Target file plan

```text
src/lib/
  formats.ts                 + md, add caps per format
  db.ts                      + stores: annotations, sessions, collections, ocr, searchIndex
  reader-settings.ts         + typography extras, custom theme, per-book overrides
  annotations.ts             CRUD + CFI/page/rect anchoring, color model
  search/                    index.ts (build), query.ts, highlight.ts
  stats.ts                   session tracking, streaks, ETA
  encoding.ts                charset sniffing + decode
  imageops.ts                contrast/sharpen/split/upscale (worker client)
  ocr.ts                     tesseract client + cache
  pdf-ops.ts                 pdf-lib: reorder, rotate, split, merge, flatten
  chm/                       container.ts, hhc.ts, links.ts
  djvu/                      decode.ts, layers.ts, textlayer.ts
  sync/                      provider.ts (iface), webdav.ts, gdrive.ts, dropbox.ts, cloud.ts
src/workers/
  archive.worker.ts  ocr.worker.ts  imageops.worker.ts  search.worker.ts  djvu.worker.ts
src/components/reader/
  reader-shell.tsx           slimmed to orchestration
  drawer/{toc,notes,search,display,pages}.tsx
  layers/{selection-popover,annotation-layer,ink-canvas,text-layer}.tsx
  engines/{foliate,pdf,paged-image,text,html,chm,djvu}-reader.tsx
  paged-image-viewer.tsx     shared zoom/pan/tile surface (pdf + djvu + comic)
src/components/library/
  shelf.tsx facet-rail.tsx series-stack.tsx stats-strip.tsx storage-meter.tsx
src/routes/
  index.tsx read.$id.tsx stats.tsx settings.tsx library.collections.tsx
```

### 3.3 Contract extensions

```ts
interface RendererCaps {
  toc?: TocItem[];
  typography?: boolean;
  flowControl?: boolean;
  annotations?: "cfi" | "page-rect" | false;
  search?: boolean;
  pageOps?: boolean;
  imageAdjust?: boolean;
  spread?: boolean;
  rtl?: boolean;
  tts?: boolean;
  ocr?: boolean;
  pageCount?: number;
}

interface Annotation {
  id: string;
  bookId: string;
  anchor: { kind: "cfi"; cfi: string } | { kind: "rect"; page: number; rects: Rect[] };
  type: "highlight" | "underline" | "strike" | "note" | "ink" | "bookmark";
  color: AnnotationColor;
  text?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
```

Engines never touch persistence; they emit anchors, the kernel writes them.

### 3.4 Performance rules

- Every decode/OCR/image op runs off the main thread; transfer `ImageBitmap`/`ArrayBuffer`, never copy blobs.
- LRU caches sized by byte budget (default 128 MB) for rendered pages/bitmaps.
- Virtualized page lists everywhere; render window = viewport ± 2.
- Search index built incrementally on idle (`requestIdleCallback`), persisted per book.
- Budget: page turn < 16ms perceived, PDF page render < 120ms at fit width, comic preload keeps 3 pages hot.

### 3.5 Delivery phases

| Phase | Scope                                                                      | Ships                                                                        |
| ----- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1     | Kernel refactor: capability contract, drawer tabs, immersive chrome        | foundation for everything                                                    |
| 2     | Annotations + selection popover + notes drawer (EPUB + PDF)                | highlights, notes, bookmarks                                                 |
| 3     | Search: in-book search for all text engines + PDF text layer               | search drawer                                                                |
| 4     | PDF power tools: zoom/pan rewrite, thumbnails, page ops, flatten export    | PDF Expert parity                                                            |
| 5     | Comics: smart fit, spread split, manga mode, image adjust worker           | YACReader parity                                                             |
| 6     | Text/HTML: encoding detection, Markdown, clean view, chapter detect        | ReadEra parity                                                               |
| 7     | Stats, collections/tags, settings + backup/restore (zip export of library) | library depth                                                                |
| 8     | CHM decoder + `.hhc` tree                                                  | **shipped** — legacy format unlocked                                         |
| 9     | DJVU decoder + layered render + OCR (shared with image PDFs)               | **shipped** — scans unlock                                                   |
| 10    | Sync tier (§4)                                                             | **shipped** — cross-device merge engine with a real account provider (Cloud) |

---

## 4. Sync tier (optional, last)

Local-first stays the default; sync is additive.

- Abstract `SyncProvider { pullManifest, pushManifest, getBlob, putBlob }`.
- Providers: **the builder's cloud** (accounts + Postgres manifest + storage bucket, RLS per user) as the built-in option; **WebDAV / Google Drive / Dropbox** as bring-your-own targets.
- Sync unit: `{ progress, annotations, settingsOverride, stats }` per book, merged **last-write-wins per field** with a vector of `updatedAt`; blobs sync opt-in per book (they're large).
- Conflict UI: only surfaces when two devices have divergent progress > 2% — offers "keep furthest".

---

## 5. Non-goals

- No server-side rendering of book content (privacy: files never leave the device unless sync is enabled).
- No DRM circumvention. DRM-protected EPUB/AZW stays unsupported by design.
- No native app shell in this phase; PWA + offline cache instead.

---

## 6. Post-Phase-4 follow-ups (specified)

These are the next three units of work, in order. Each is self-contained and
lands behind the existing capability contract — no engine rewrites.

### 6.1 Phase 4.1 — Persisted search index (DB v3) [A]

**Problem.** `src/lib/search.ts` re-walks `getTextContent()` for every page on
every query. On a 600-page PDF that is seconds of main-thread-adjacent work per
keystroke, repeated verbatim on the next query, and it makes cross-book search
impossible.

**Shape.**

- Bump the IndexedDB schema in `src/lib/db.ts` to **v3** with two new stores:
  - `searchIndex` — key `bookId`, value
    `{ bookId, version: 1, builtAt: number, pageCount: number, terms: Record<string, number[]>, pages: Array<{ page: number; text: string }> }`.
    `terms` is the inverted index: normalized token → sorted page numbers.
    `pages` keeps the per-page plaintext so hit snippets and rect mapping stay
    exact without re-extracting.
  - `searchMeta` — key `bookId`, value `{ status: "idle" | "building" | "ready" | "failed"; progress: number; error?: string }`.
  - Migration is additive: `onupgradeneeded` creates the stores when
    `oldVersion < 3`; no existing record is touched.
- New worker `src/workers/search-index.worker.ts`. Message in
  `{ type: "build", bookId, format, blob }`, messages out
  `{ type: "progress", bookId, done, total }` and
  `{ type: "done", bookId }` / `{ type: "error", bookId, message }`.
  Extraction lives in the worker (pdf.js `getTextContent` for PDF, foliate
  section text for reflowable, plain decode for text/HTML), so the UI thread
  never blocks. The worker writes both stores itself.
- Tokenizer: lowercase, NFKD-fold diacritics, split on
  `/[^\p{L}\p{N}]+/u`, drop tokens of length 1. Store token → page list; the
  page text carries the exact casing for snippet rendering.
- Build trigger: on reader open, `ensureIndex(bookId)` checks `searchMeta`. If
  missing or `version` mismatched, schedule the worker inside
  `requestIdleCallback` (fallback `setTimeout(0)`). Any page op that rewrites
  the file (`pdf-ops.ts` → `putBookFile`) invalidates the row so it rebuilds.
- Query path: `search()` first resolves candidate pages from `terms`
  (intersect page lists across all query tokens), then substring-matches only
  those pages' cached text for exact offsets and rects. Falls back to the
  current live-extraction path while `status !== "ready"`, so search never
  regresses to unavailable.
- **Cross-book search** on the library page: a query hits every `searchIndex`
  row, grouped by book, capped at 5 snippets per book, each result linking to
  `/read/$id?q=…&page=…`. The reader consumes those params to open the search
  tab pre-seeded on the right hit.

**Done when:** repeat query on a large PDF returns in < 30ms, the library page
searches inside all indexed books, and a page op forces exactly one rebuild.

### 6.2 Phase 4.2 — Search UX polish [A]

Entirely in `src/components/reader/drawer/search-tab.tsx` + the shell's key
handler; no storage changes.

- `f` (and `⌘/Ctrl+F`, preventing the browser dialog) opens the drawer on the
  search tab and focuses the field. `Escape` closes and clears the active hit
  highlight.
- Hit stepping: `Enter` = next hit, `Shift+Enter` = previous, wrapping at both
  ends, with a `3 / 47` counter beside the field. Stepping scrolls the hit into
  view and paints the active hit in `--signal` while the other hits stay in the
  muted highlight colour.
- Toggles persisted in `ReaderSettings`: **match case** and **whole word**.
  Whole word wraps the query in `\b`-equivalent boundaries computed against the
  same tokenizer used by the index, so index-backed and live search agree.
- Query debounce 150ms; the empty query clears hits rather than listing the
  whole book.

**Done when:** keyboard-only search — open, type, step through every hit, close
— works in PDF and EPUB without touching the mouse.

### 6.3 Phase 4.3 — Text-offset annotation anchor [A]

Today `Annotation.anchor` is `{ kind: "cfi" }` or `{ kind: "rect" }`. Rect
anchors break the moment a page is rotated, reordered, or the PDF is
re-flattened — exactly what Phase 4 now lets users do.

- Add a third variant:
  ```ts
  | { kind: "text"; page: number; start: number; end: number; quote: string; prefix: string; suffix: string }
  ```
  `start`/`end` are offsets into the indexed page text from §6.1; `quote` plus
  32 chars of `prefix`/`suffix` make it self-healing.
- Resolution order when rendering the highlight layer: exact offset → quote
  match within ±200 chars → prefix/suffix fuzzy match anywhere on the page →
  mark the annotation `orphaned` and surface it in the Notes tab with a
  "re-anchor" affordance instead of silently dropping it.
- PDF engine converts a resolved text range back to rects via the text layer's
  per-item transforms, so rendering stays a rect paint.
- New annotations from the PDF selection popover are written as `text` anchors;
  existing `rect` records keep rendering unchanged (no migration required).

**Done when:** highlights survive rotate, delete, reorder and re-export, and an
unresolvable highlight shows as orphaned rather than vanishing.

### 6.4 Note — OCR-backed comic/DJVU search

`search: true` for CBZ/CBR/CB7 and DJVU is unreachable without OCR: those
formats carry no text layer. The path is a tesseract-wasm worker producing a
per-page text layer that feeds the **same** `searchIndex` store from §6.1, so
search, snippets and text anchors all work unchanged once the text exists.

Sequencing: this belongs **after the annotation layer**, alongside **Phase 9**
(DJVU decoder + layered render), not before it — OCR output is only worth
persisting once §6.3's text anchors exist to hang highlights on, and the DJVU
decoder shares the same image-to-text pipeline. Scope it as a single worker
serving both formats, run on idle, opt-in per book (OCR of a 200-page scan is
minutes of CPU), with progress surfaced in the search tab.

---

## 7. Audit — state as of Phase 6 wiring (2026-08-28)

Typecheck, unit tests and build are clean. Verified by reading the code, not
the plan.

| Phase | Scope                                                          | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Kernel: capability contract, five-tab drawer, immersive chrome | **done** — `RendererCaps`, one `reader-drawer` with toc/notes/search/display/pages, `use-immersive-chrome`, focus trap + restore                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2     | Annotations, selection popover, notes drawer                   | **done** — `annotations.ts` CRUD, cfi + rect anchors, popover, notes tab                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3     | In-book search for all text engines + PDF text layer           | **done** — foliate, pdf, text, html all declare `search` and implement `NavApi.search`; comic declares `search: false` (correct, no text layer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4     | PDF power tools                                                | **done** — pinch/pan pointer layer, thumbnail rail, rotate / reorder / delete / extract / split / merge, flatten-and-export, night mode, crop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4.1   | Persisted search index (DB v3)                                 | **done** — `searchIndex` + `searchMeta` stores, worker tokenizer + inverted index, `ensureIndex` idle batching, incremental rotate/move/delete/append/notes ops, index-first query with live fallback                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4.2   | Search UX polish                                               | **done** — `matchCase` / `wholeWord` in `ReaderSettings`, carried on `SearchRun` to live engines and the index, toggles + `n / m` counter, debounce, `f` / `⌘F`, Enter / Shift+Enter stepping                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4.3   | Text-offset annotation anchors                                 | **done for paged + reflowable** — `text-anchor.ts` ladder, `pdf-text-map.ts` (PDF) and `doc-text-map.ts` (foliate) are wired: both engines write `text` anchors, re-resolve them per page/section and report orphans. TXT and HTML still declare `annotations: false`, so they have no anchors                                                                                                                                                                                                                                                                                                                                                    |
| —     | Cross-book search                                              | **done** — library page queries every book's `searchIndex`, 5 snippets per book, deep-links into `/read/$id?q=…&page=…` which the reader now reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| —     | Test + benchmark harness                                       | **done** — vitest unit suites (tokenizer, find-matches, postings remap, pdf anchor remap, chapters, markdown), Playwright e2e spec, `window.__folioBench` via `bench.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| —     | Page-op hardening                                              | **done** — `page-op-errors.ts` classification, rollback to previous blob, retry action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| —     | Pages-drawer a11y                                              | **done** — list semantics, roving focus, Alt+arrow reorder, `aria-current`, live region                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6     | Text & HTML parity                                             | **done** — `chapters.ts` synthetic TOC wired into the TXT/RTF engine (`#p<index>` nav), `markdown.ts` + `.md` / `.markdown` formats wired into the HTML engine with heading-derived contents. Encoding detection (§9.1) **done** — `text-decode.ts` (BOM sniff, strict UTF-8 validation, BOM-less UTF-16, scored legacy candidates) with a per-book `Encoding` override in the Display tab, gated on `caps.encoding`. Clean view (§9.3) **done** — `clean-view.ts` + Readability extraction, per-book `cleanView` toggle. Annotations **done** — `text-marks.ts` paints text-anchored marks in both DOM engines, orphans surface in the Notes tab |

### Gaps found

1. **Case-sensitive candidate narrowing is approximate.** The worker tokenizer
   always lowercases, so `matchCase` only filters at the snippet-scan stage.
   Correct for results, slightly wasteful for candidates — accepted by design.
2. **Phase 9 DJVU decode is shipped** — vendored DjVu.js v0.5.4
   (`public/vendor/djvu/djvu.js`, IIFE bundle that doubles as its own worker),
   `lib/djvu.ts` (script loader, `DjvuClient` with serialized page renders to
   PNG object URLs, native text-layer reads, outline href resolution via
   `getPageNumberByUrl`, windowed cache trimming, plus the pure
   `flattenOutline` / `renderWindow` / `normalizeDjvuText` / `hasTextLayer`
   helpers), and `components/reader/djvu-reader.tsx` (lazy paged-image engine
   rendering the visible page ±1, NAVM outline into `caps.toc`, `search` on for
   native text or per-book OCR opt-in, `extractPageText` preferring the native
   layer and falling back to `OcrClient`). Registry: `ReaderKind` gains
   `"djvu"`, `FORMATS.djvu` / `FORMATS.djv` point at it, `ENGINES.djvu` in
   `reader-shell.tsx`. Unit coverage: `tests/unit/djvu-outline.test.ts`.
   **§6.4 OCR-backed
   comic search is shipped** — `workers/ocr.worker.ts` (lazy tesseract.js with
   vendored `public/vendor/tesseract` assets, pure `ocrScale` / `ocrSourceRect`
   / `isNoiseLine` / `normalizeOcrText` helpers), `lib/ocr.ts` (single-worker
   serialized queue + per-panel cache), comic engine declares `ocr: true` and
   flips `search` on per-book opt-in (`ocrEnabled` on `BookRecord`, Display-tab
   "Text recognition" toggle), OCR text feeds the same `searchIndex` store, and
   the search tab shows an OCR build bar from `indexProgress` / `indexKind`.
   Unit coverage: `tests/unit/ocr-text.test.ts`.
3. **Phase 8 CHM decode is shipped** — `lib/chm/lzx.ts` (LZX
   window/Huffman decoder with reset-interval restarts) and `lib/chm/itsf.ts`
   (ITSF header, ITSP/PMGL directory, section-0 raw reads, LZX reset table +
   block cache), `lib/chm.ts` (`ChmClient` open/list, `#SYSTEM` + `.hhc` TOC,
   link/asset rewriting to `#chm:<path>` anchors and object URLs, plus the pure
   `parseHhc` / `normalizeChmPath` / `flattenChmToc` / `chmLabelFor`), and
   `components/reader/chm-reader.tsx` (sandboxed iframe per section, sitemap
   TOC, internal `#chm:` navigation, section-scoped text annotations via the
   new optional `page` on `MarkContext`, `extractPageText` into the persisted
   search index). Registry: `ReaderKind` gains `"chm"`, `FORMATS.chm` points at
   it, `ENGINES.chm` in `reader-shell.tsx`, stale "no decoder" note removed
   from `import-books.ts`. Unit coverage: `tests/unit/chm-toc.test.ts`.
   **End-to-end decode verified** against a real help file
   (`python2718.chm`, 6.3 MB): 572 directory entries, 513 HTML pages, 400
   pages LZX-decompressed to 16.5 MB in ~235 ms, `.hhc` (437 KB) parsed into
   18 roots / 467 flattened sections, windows-1252 fallback confirmed on
   non-UTF-8 sitemap text. The remaining CHM gap — the `.hhk` keyword index —
   is now closed too; see Phase 11 (§12.1).

Previously listed gaps now shipped: TXT/HTML annotations with text anchors and
orphan surfacing in the Notes tab, §9.1 encoding detection via
`text-decode.ts`, §9.3 clean view via Readability extraction, and all of
Phase 7 (§10) — see below.

### Phase 7 (§10) — **done**

- §10.1 `sessions.ts` (DB v4 `sessions` store, idle-aware `SessionTracker`,
  streak / pace / 30-day sparkline) wired into the reader through
  `use-reading-session.ts` and surfaced by `components/library/stats-strip.tsx`.
  Per-book "≈time left" badge on the cover card from `estimateRemainingMinutes`.
- §10.2 `collections.ts` + `collections-sidebar.tsx`: collection rail with
  create/delete, drag a cover onto a collection to file it, free-form tags via
  `tag-editor.tsx` and a combinable tag chip filter.
- §10.3 `storage.ts` + `/settings`: quota meter, per-book byte tally, two-tier
  "free up space" (derived data, then source blob), persistence requested on
  first import.
- §10.4 `backup.ts` + `/settings`: `.folio.zip` export (full or metadata-only)
  and merge-on-import restore (newest progress wins, annotations/collections
  union).
- Unit coverage: `tests/unit/sessions.test.ts`, `collections.test.ts`,
  `backup-merge.test.ts`.

### Phase 7.4 — smart collections + faceted status filter — **shipped**

- `collections.ts`: `BookStatus` (`unread` / `reading` / `finished`) derived by
  the pure `bookStatus()` from `progress.fraction` (finished at
  `FINISHED_FRACTION` = 0.98) and `lastOpenedAt`.
- Optional `SmartRule` on `Collection` (`status` / `format` / `tag`, ANDed).
  Membership is computed by `collectionBooks()` / `inCollection()` instead of
  stored, so `bookIds` is ignored for smart collections.
- `LibraryFilter` / `filterBooks` gained a `status` field, composed with the
  collection scope and tag chips.
- `collections-sidebar.tsx`: smart collections render with a distinct sparkle
  icon and reject cover drops; a Status facet chip row (Unread / Reading /
  Finished, with counts) sits alongside the tag chips.
- `routes/index.tsx`: `activeStatus` state wired through `filterBooks` and the
  sidebar callbacks; collection counts now use computed membership.
- Unit coverage extended in `tests/unit/collections.test.ts` (status
  classification, smart membership, combined facets).

### Recommended order

With Phase 7, §6.4 OCR search, Phase 9 DJVU decode and Phase 8 CHM decode
landed, every format engine on the matrix is shipped. Smart collections and the
faceted-rail status filter are **shipped** (Phase 7.4 above).
Phase 10 — the sync tier (§4) — is **shipped with a real account provider**
(see §11), and Phase 11 (§12.1) closed the last CHM gaps: the `.hhk` keyword
index and a full-archive text index. What is left is entirely optional depth —
see §12.

---

## 8. Phase 5 — specification (comics, EPUB index, image pipeline)

Four workstreams, all client-side. Written before implementation so each item
has an owner file, a capability gate and an acceptance check.

### 8.1 Comic rendering core — `src/components/reader/comic-reader.tsx`

The engine currently extracts archive images and shows one or two of them.
Phase 5 turns it into a real comic surface. CBZ moves from the foliate engine
to the comic engine (`src/lib/formats.ts`) so every archive format shares one
code path; libarchive already handles zip, rar and 7z.

| Item             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel model      | _(shipped, revised)_ Extraction produces `ComicPanel { id, name, url, width, height, part? }`. Dimensions come from `probeImageSize` (`src/lib/image-size.ts`), which parses only the PNG/JPEG/GIF/WebP header bytes — no `createImageBitmap` decode of every page at load. Panels are published **progressively**, entry by entry (`buildPanelsForEntry`), so the first page paints before the archive finishes extracting.                                                    |
| Spread split     | _(shipped, revised)_ A page whose aspect is wider than `1.15` is a double-page scan. Dimensions come from a **header-only `probeImageSize`** read rather than a full decode, and the halves are produced by rendering the same source image twice at `200%` width inside a clipping container — no `OffscreenCanvas` re-encode, no second copy of the pixels in memory. Each half keeps a `part: "l" \| "r"` marker so labels stay honest. Gated on the `splitSpreads` setting. |
| Smart fit        | `comicFit` = `width \| height \| screen \| original \| smart`. `smart` picks fit-height for portrait panels and fit-width for landscape ones, so a split spread and a normal page both fill the frame. `original` allows overflow with scroll.                                                                                                                                                                                                                                  |
| Manga mode (RTL) | `manga` setting reverses the _visual_ order of a two-up spread and flips tap zones: left half = next, right half = previous. Page indices and progress stay left-to-right internally, so persisted progress is format-agnostic.                                                                                                                                                                                                                                                 |
| Capabilities     | The engine now declares `imageAdjust: true`, `rtl: true`, `spread: true` so the kernel renders the matching controls and nothing else.                                                                                                                                                                                                                                                                                                                                          |
| EPUB spread      | _(shipped)_ `caps.spread` is shared with the foliate engine, where "Two pages" maps to `max-column-count: 2` in paginated flow only, alongside viewport-scaled margins (`min(72, max(20, vw * 4.5%))px`) and an `8%` gap — not an image split.                                                                                                                                                                                                                                  |

Acceptance: a 4-page CBZ opens, tap-forward advances, fit modes visibly change
layout, manga mode inverts tap direction, and a wide page yields two panels.

### 8.2 Image adjust worker — `src/workers/image-adjust.worker.ts`

- Input `{ id, bitmap, brightness, contrast, sharpen }`, transferred bitmap.
- Brightness/contrast applied as a precomputed 256-entry LUT; sharpen is a
  3×3 convolution blended by `sharpen / 100`.
- Runs on `OffscreenCanvas`, returns a PNG `Blob`; the client wraps it in an
  object URL and caches per `panelId + settings` key, revoking on eviction.
- Absent `OffscreenCanvas` (or during SSR) the client returns `null` and the
  reader shows the untouched image — never a broken frame.
- Client wrapper lives in `src/lib/comic-image.ts` next to the panel builder so
  the engine imports one module.
- Gate: only invoked when `brightness !== 100 || contrast !== 100 || sharpen > 0`.

### 8.3 Reader UI controls — `src/components/reader/drawer/display-tab.tsx`

Everything capability-gated, no dead controls:

- `caps.rtl` → **Direction** segments (Left to right / Manga RTL) and a
  **Split wide pages** toggle.
- `caps.rtl` → **Fit** segments for the five fit modes.
- `caps.imageAdjust && caps.rtl` → Brightness, Contrast, Sharpen steppers with
  a reset affordance. The existing PDF "Scans" block stays gated on the PDF
  side so the two engines never show each other's controls.

New persisted fields on `ReaderSettings`: `comicFit`, `manga`, `splitSpreads`,
`brightness`, `contrast`, `sharpen`.

### 8.4 EPUB cross-book search — `src/components/reader/foliate-reader.tsx`

Cross-book library search only covers PDFs today because only pdf.js exposes
`extractPageText`. foliate books are section-based, so:

- The engine reports `indexUnits: book.sections.length` — a new capability
  distinct from `pageCount`, so declaring it does **not** switch on the
  page-thumbnail drawer (foliate has no `renderThumbnail`).
- `extractPageText(n)` loads section `n - 1`, pulls `textContent` from its
  document, and normalizes whitespace.
- `goToPage(n)` and `goToHit` accept `{ kind: "page" }` targets and jump to the
  section, which makes library deep links (`?q=&page=`) work for EPUBs.
- The kernel's index effect reads `caps.pageCount ?? caps.indexUnits`.

Acceptance: opening an EPUB builds a persisted index; the library search box
then returns "In your books" hits for that EPUB and the hit deep-links into it.

### 8.5 Playwright regression coverage — `tests/e2e/comic-reader.spec.ts`

A generated CBZ fixture (`makeSampleCbz`, PNG pages drawn in-process, one
deliberately wide page) drives:

1. Import → reader opens, first page visible.
2. Tap-right advances; tap-left goes back.
3. Fit mode change alters the rendered image box.
4. Manga mode inverts tap direction.
5. Split-wide produces one more panel than there are files.

---

## 9. Phase 6 — specification (text & HTML parity)

TXT/RTF/HTML are currently second-class: one decode path (UTF-8), no chapters,
no reader view for saved web pages, no Markdown at all. Phase 6 brings them to
parity with the EPUB engine. Nothing here needs a backend.

### 9.1 Encoding detection — `src/lib/text-decode.ts` (new)

`TextDecoder("utf-8")` silently produces mojibake for the Shift-JIS, GBK and
KOI8-R files that make up most legacy plain-text libraries.

- `detectEncoding(bytes): { label, confidence }` — BOM sniff first
  (UTF-8/16LE/16BE), then a byte-statistics pass scoring candidate labels
  (`utf-8`, `shift_jis`, `euc-jp`, `gbk`, `big5`, `koi8-r`, `windows-1251`,
  `windows-1252`, `iso-8859-1`) on lead/trail byte validity plus common-bigram
  frequency for CJK/Cyrillic.
- `decodeText(bytes)` decodes with the winner; UTF-8 with replacement chars
  above a 0.2% threshold demotes it to the runner-up.
- Runs once at import; the resolved label is stored on the book record so
  re-opens skip detection and the user can override it.
- Override UI: an **Encoding** select in the Display tab, gated on a new
  `caps.encoding`, re-decoding the source blob in place.

### 9.2 Markdown as a first-class format — `src/lib/markdown.ts` (new)

- Registry entries for `md`, `markdown` (`category: "doc"`, `kind: "html"`) so
  the existing HTML engine renders them — no new engine.
- `marked` for parsing plus a sanitizer pass; GFM tables, task lists and
  fenced code on, raw HTML sanitized rather than dropped.
- Headings emit stable `id`s, which feed §9.4's TOC directly.
- Front-matter (`---` YAML block) is parsed for `title`/`author` and used as
  import metadata instead of being rendered.

### 9.3 Clean view for HTML — `src/lib/readability.ts` (new)

Saved web pages carry nav bars, cookie banners and ad slots.

- A Readability-style scorer: strip `script/style/nav/aside/footer/form`, score
  block elements by text density and comma count, promote the top-scoring
  subtree, keep images inside it.
- Exposed as a **Clean view** toggle in the Display tab gated on
  `caps.cleanView` (HTML engine only), persisted per book. Off shows the
  original document, so nothing is ever lost.
- The clean document is what the search index and text anchors see when the
  toggle is on, so hits and highlights match what is on screen.

### 9.4 Synthetic chapters — `src/lib/chapters.ts` (new)

Plain text has no structure, so we infer it:

- Regex ladder over the decoded text: Markdown ATX/setext headings; `Chapter N`
  / `CHAPTER ONE` / `Part N` (English, plus roman numerals); `第N章` / `第N回`;
  `Глава N`; a numbered-line heuristic; and a blank-line + short-ALL-CAPS-line
  fallback.
- The first pattern that yields ≥3 well-spaced matches wins; below that the
  book stays single-chapter rather than showing noise.
- Output `Chapter { id, title, offset, level }`, mapped to page numbers by the
  text engine and rendered by the **existing TOC panel** — no new UI.
- Detection is memoized per book so reopening is instant.

**Done when:** a Shift-JIS `.txt` novel imports with correct glyphs, shows a
chapter list in the TOC, and a `.md` file renders as formatted HTML with its
headings as chapters.

---

## 10. Phase 7 — specification (library intelligence)

### 10.1 Stats & sessions — `src/lib/sessions.ts` (new, DB v4)

- New `sessions` store: `{ id, bookId, startedAt, endedAt, pagesRead, words }`.
  A session opens on reader mount, ticks while the page is visible and the user
  is active (idle >60s pauses), closes on unmount or tab hide.
- Derived stats: streak, minutes/day, pages/hour, per-book time-to-finish
  estimate from the trailing 5-session rate.
- Surfaced on the library page as a compact stats strip plus a per-book
  "≈2h left" badge. No charts beyond a 30-day sparkline.

### 10.2 Collections & tags — DB v4

- `collections` store `{ id, name, color, order }` and a `bookIds` join array;
  free-form `tags: string[]` on the book record.
- Library sidebar lists collections; drag a cover onto one to file it. Tags are
  a filter chip row, combinable with the existing format filter and search.
- Smart collections are a later follow-up, not Phase 7.

### 10.3 Storage meter

- `navigator.storage.estimate()` plus a per-book byte tally (source blob,
  covers, extracted panels, search index) shown as a stacked bar in Settings.
- Per-book **Free up space** drops derived data (panels, index, thumbnails)
  while keeping the source blob and all annotations; a second tier removes the
  blob but keeps the record and progress.
- A persistent-storage request is made on first import so browsers stop
  evicting the library under pressure.

### 10.4 Backup & restore — `src/lib/backup.ts` (new)

- Export writes a single `.folio.zip` with `fflate`: `manifest.json` (schema
  version, counts), `books.json`, `annotations.json`, `sessions.json`,
  `settings.json` and a `blobs/` directory, streamed so a multi-GB library
  never lands in one buffer.
- Import validates the manifest with Zod, then merges by book id: newer
  `updatedAt` wins, annotations union by id, unknown fields preserved.
- A **blobs-excluded** export option produces a small metadata-only backup for
  moving progress and highlights between devices that already hold the files.

**Done when:** a library exports, is wiped, restores from the zip with progress
and annotations intact, and the storage meter reflects the recovered size.

---

## 11. Phase 10 — sync tier — **shipped (real account provider)**

Local-first is untouched: nothing syncs unless a provider is picked on
`/settings`. The tier is split so a real backend is a drop-in.

### 11.1 Wire format & merge — `src/lib/sync.ts`

- `SyncManifest` = device id, schema version, `SyncBookEntry[]`, collections.
  Each entry carries progress, annotations, annotation tombstones, tags,
  per-book settings (encoding / clean view / OCR) and reading stats, plus a
  per-field `SyncClock` (`progress`, `annotations`, `tags`, `settings`,
  `stats`) so merges are **last-write-wins per field**, not per record.
- Pure functions, no IndexedDB: `mergeManifests`, `mergeBookEntry`,
  `mergeAnnotationSets` (union by id, newest edit wins, tombstone wins only
  when the deletion is newer than the surviving edit), `mergeTombstones`,
  `mergeCollections` (whole-document, newest side wins), `isProgressConflict`
  (both sides moved since the last sync **and** diverge by more than
  `CONFLICT_FRACTION` = 2%) and `resolveConflict('furthest'|'local'|'remote')`,
  which restamps the progress clock so the answer wins the next round.
- Cumulative fields never regress: `addedAt` takes the minimum, stats take the
  maximum tally, `hasBlob` is a logical OR.
- Engine: `buildLocalManifest` (snapshot), `applyManifest` (write back;
  remote-only books land as `blobEvicted` placeholders) and `runSync`
  (pull → merge → resolve → apply → push, then the opt-in blob phase).
  Idempotent when neither side changed.

### 11.2 Provider contract — `src/lib/sync-providers/local.ts`

`SyncProvider { pullManifest, pushManifest, getBlob, putBlob, listBlobs,
reset? }`. Two providers are registered in `PROVIDERS`:

- **Cloud** (`src/lib/sync-providers/cloud.ts`) — the real account provider:
  per-user manifest row with row-level security plus a private storage bucket
  for opt-in book blobs, signed-in through the panel's email sign-in.
- **Demo** (local) — stores the "remote" in a separate `folio-sync-demo`
  IndexedDB so the whole round trip works without a network or an account.

### 11.3 Deletions — DB v5

New `tombstones` store plus `recordTombstone`, written by `deleteAnnotation`
and `deleteBookAnnotations`, so a deletion on one device is not resurrected by
another device's stale copy on the next merge.

### 11.4 UI — `src/components/library/sync-panel.tsx`

Mounted at the bottom of `/settings`: provider picker, account sign-in/out for
the Cloud provider, device id, remote summary (books / notes / files), run
button with live step states, blob opt-in, "Clear remote copy", a per-run
merge report, and the keep-furthest conflict prompt when progress diverges. On
phones the sign-in and action buttons go full width and stack. The settings
route's title and description now cover sync.

### 11.5 Verification

`tests/unit/sync-merge.test.ts` — 20 cases over per-field LWW, clock
advancement, annotation union, tombstone precedence (including the
no-resurrection case), conflict detection at the 2% threshold, all three
resolution choices, collection merge and manifest add/update/idempotence.
Full suite: **213 unit tests passing**, typecheck clean, build OK.

**Status:** **shipped with a real remote.** The Cloud provider
(`src/lib/sync-providers/cloud.ts`) syncs the manifest and opt-in blobs to the
signed-in user's account, and the local demo provider remains for trying the
round trip without an account. Extra providers (WebDAV / Drive) can still slot
into the `PROVIDERS` registry through the same `SyncProvider` contract. Also
noted: blob sync is one-way-per-book naive — it
uploads what the remote lacks and downloads what is locally missing, with no
partial-transfer resume.

---

## 12. Next phases — specification (2026-09-02)

With the comic-reader rewrite (progressive publish, resampling zoom, touch
pinch) verified and every matrix engine shipped, the remaining roadmap is
polish and depth, not new formats. Ordered by value-per-effort below.

### 12.1 Phase 11 — CHM keyword index & full-archive search — **shipped**

The last open CHM gap from Phase 8 (§7 gap 3), now closed.

- **`.hhk` keyword index** — `lib/chm.ts` parses the `.hhk` named in `#SYSTEM`
  (falling back to the first one present) into `ChmDocument.keywords` via
  `parseHhk`. `chm-reader.tsx` passes them to the drawer; the Index tab
  (`drawer/index-tab.tsx`) renders a filterable A–Z keyword list where a
  single-target keyword jumps straight there and multi-target keywords expand
  into their topics.
- **Full-archive text index** — the CHM engine declares
  `indexUnits = sectionCount`, so `ensureIndex` builds a persisted index over
  the whole archive (like §8.4 did for EPUB). CHM books appear in cross-book
  library search and deep-link with `?q=&page=<section>`.
- Unit tests: `tests/unit/chm-index.test.ts`.

**Verified:** a real help file shows its keyword index in the drawer and a
library search returns hits from inside CHM pages.

### 12.2 Phase 12 — Lookup & read-aloud (§1.1 leftovers) [A]

- **Dictionary / Wikipedia panel** — selection popover gains **Define**,
  opening the drawer Notes-adjacent panel: Wiktionary REST
  (`/api/rest_v1/page/definition/<word>`) with a Wikipedia summary fallback.
  Pure fetch, no key; results cached per word in `sessionStorage`. Language
  follows the book's OPF `lang` where known.
- **TTS read-aloud** — Web Speech API (`speechSynthesis`) over the foliate
  engine to start: sentence segmentation on the section's text, CFI range for
  the spoken sentence painted as a transient signal-red underline, controls
  (play/pause, rate 0.75–2×, voice picker) in a new Display-tab block gated on
  `caps.tts` (foliate, text, html engines only). Pauses when the drawer opens
  or chrome hides; position persists per book.
- **Auto-scroll** — rAF scroll driver for scrolled-flow engines (text, html,
  foliate-scrolled), speed in px/s adjustable from the same block, any input
  pauses it.

**Done when:** selecting a word in an EPUB shows a definition, and read-aloud
walks a chapter with the spoken sentence tracked on screen.

### 12.3 Phase 13 — PWA & offline hardening [A]

- `manifest.webmanifest` (icons generated from the favicon mark,
  `display: standalone`, `theme_color` from the paper token) linked from
  `__root.tsx`.
- A minimal service worker: precache the app shell + vendored decoder bundles
  (`public/vendor/*`), runtime-cache nothing user-generated (IndexedDB already
  owns books). Registration gated on production builds only.
- Install affordance on the library page when `beforeinstallprompt` fires;
  storage persistence is already requested (§10.3) — extend the banner to
  mention offline availability.

**Done when:** the app installs, opens offline, and a previously imported book
reads end-to-end with the network cut.

### 12.4 Phase 14 — Comic depth (§1.3 leftovers) [B]

- **ComicInfo.xml metadata** — parsed at import in `comic-image.ts`
  (`series`, `number`, `writer`, `penciller` onto `BookRecord` extras); the
  library gains the planned series-stack grouping for comics sharing a
  `series` value.
- **Guided view** — panel-stepping: per-page contour scan in the image-adjust
  worker (downscale → luminance threshold → bounding boxes, merged when
  overlapping > 30%), ordered by reading direction (RTL-aware). Double-tap
  with the Display-tab "Guided view" toggle steps panels using the existing
  `useComicZoom` fitted-size math; falls back to full page when a page yields
  < 2 boxes.
- **Upscale filter** — Lanczos-3 resample in the worker for pages below the
  viewport's pixel size, opt-in per book, cached per `panelId + dpr`.

**Done when:** comics from one series stack on the shelf with correct volume
numbers, guided view steps a real page panel by panel, and a low-res scan is
visibly sharper at fit-width.

### 12.5 Explicitly deferred

- **Extra sync providers (WebDAV / Drive)** — the real Cloud provider is
  shipped (§11.2); bring-your-own targets slot into the same seam on demand.
- ~~**PDF forms (AcroForm) fill+save**~~ — **shipped (2026-09-10)**, see §13.6.

- **Blob sync resume** — chunked upload/download with per-chunk checkpoints,
  only meaningful alongside a real provider.

---

## 13. Phase 15 — specification (2026-09-05): sharpness engine & reading polish

Audit before writing this section:

- §12.2 (Phase 12 — dictionary/Wikipedia lookup, TTS read-aloud, auto-scroll)
  is **shipped**: `lib/lookup.ts`, `lib/tts.ts`, `lib/spoken-highlight.ts`,
  `hooks/use-tts.ts`, `hooks/use-auto-scroll.ts`,
  `components/reader/layers/definition-card.tsx`.
- §12.3 (Phase 13 — PWA/offline) is **shipped**: `lib/pwa.ts`,
  `public/manifest.webmanifest`, `public/icons/*`, `vite-plugin-pwa`.
- §12.4 (Phase 14 — comic depth) is **open**: no ComicInfo.xml parse, no
  guided view, no upscale filter anywhere in `src/`.

So Phase 15 = the sharpness half of §12.4 (the user-visible blur at zoom),
plus the §1.1 typography rows that were never wired to controls.

### 13.1 Sharp zoom — resampling enhancer (the CDisplayEx behaviour)

**Symptom.** `use-comic-zoom.ts` already lays panels out at `base * zoom` CSS
px instead of `transform: scale()`, so zooming is crisp _up to the scan's
native pixel width_. Past that point the browser's bilinear upscaler takes
over and text turns soft — worst on 800–1200 px web scans, which run out of
pixels at ~1.5× on a HiDPI screen. CDisplayEx does not have more pixels
either; it looks sharper because it resamples with a high-quality kernel and
applies an unsharp pass, so edges stay hard instead of smeared.

**Design.**

| Piece                                | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workers/image-adjust.worker.ts`     | New pure `resampleLanczos(src, sw, sh, dw, dh, a = 3)`: separable Lanczos-3, horizontal pass then vertical, precomputed per-output-pixel weight tables (`buildWeights`), premultiplied-safe on RGB with alpha carried through. Exported for unit tests.                                                                                                                                                                                                                                                                        |
| Same worker                          | New pure `enhancePixels(data, w, h, amount)`: unsharp mask = 3×3 gaussian blur, `out = src + (src - blur) * amount`, clamped, with a small edge-guard so flat tone areas (`                                                                                                                                                                                                                                                                                                                                                    | src - blur | < 2`) are left alone and JPEG noise is not amplified. |
| Message contract                     | `{ id, bitmap, brightness, contrast, sharpen, scaleTo?: { w, h }, enhance?: number }`. When `scaleTo` is present the worker resamples first, then runs the existing brightness/contrast LUT, then `enhancePixels`. Output stays a PNG blob (lossless — re-encoding an upscale as JPEG would undo the work).                                                                                                                                                                                                                    |
| `lib/comic-image.ts`                 | `AdjustCache.key` gains the target width so an enhanced render at 1600 px and one at 3200 px are distinct entries; `request(panel, opts)` accepts `scaleTo`. New `enhanceTarget(panel, displayed, dpr)` (pure, unit-tested) returns the device-pixel target or `null`: it only fires when `displayed.w * dpr > panel.width * 1.15`, caps the factor at `MAX_ENHANCE = 3` of native, caps the long edge at `MAX_ENHANCE_EDGE = 4200` px, and quantises the target to 256 px steps so a pinch does not spawn a render per frame. |
| `components/reader/comic-reader.tsx` | After the zoom settles (220 ms debounce, so pinching stays at 60 fps) the visible panels ask for an enhanced render at the current device-pixel size; the enhanced URL replaces the source `src` when it arrives, otherwise the untouched image stays on screen. Reset on page turn, cache dropped on unmount. `imageRendering: auto` is kept — the enhanced bitmap already carries the detail.                                                                                                                                |
| Setting                              | `enhance: boolean` on `ReaderSettings` (default **on**), plus `enhanceAmount` (0–100, default 45) driving the unsharp pass. Display tab, comic block: **Sharp zoom** toggle + **Enhance** stepper, gated on `caps.imageAdjust && caps.rtl`.                                                                                                                                                                                                                                                                                    |
| Fallback                             | No `OffscreenCanvas` / no `Worker` / SSR → `enhanceTarget` result is ignored and the plain image renders. Never a broken frame, never a blocked main thread.                                                                                                                                                                                                                                                                                                                                                                   |

**Done when:** a 900 px-wide scan zoomed to 3× shows hard letterforms rather
than the browser's blur, pinching stays smooth while the sharp render lands a
moment later, and turning Sharp zoom off restores the old behaviour.

#### 13.1.1 Zoom mechanism rebuild — shipped (2026-09-06)

The sharpness work sat on a zoom that mis-anchored, so the zoom was rebuilt
first (`hooks/use-comic-zoom.ts`, `components/reader/comic-reader.tsx`):

- Anchoring is **measured, not predicted**: the fraction of the content box
  under the cursor is recorded, and a layout effect re-measures the content
  after the new size commits and scrolls that same fraction back under the
  cursor. The old proportional guess ignored padding and centring, which is
  what made the first zoom step jump.
- The centring wrapper is `width: max-content; margin: auto` instead of flex
  `justify-center`, so a zoomed page scrolls all the way to its left/top edge
  instead of having the overflow clipped.
- Wheel zoom scales by `exp(-dy * 0.0025)` with `deltaMode` normalised, and the
  native non-passive listener also catches trackpad pinch (`ctrlKey`).
- Two-finger pinch tracks pointers in a map, follows the moving midpoint, and
  guards the trailing clicks so a gesture never turns the page; a _moved_ pan
  gets the same guard.
- Zoom resets on a page turn **and** on a fit-mode change (the base size moves).
- Guided view keeps stepping panels on tap while zoomed in; only a manual zoom
  turns taps into panning.
- Sharp renders: a split half's doubled target is re-capped (`capTarget`) so it
  can't ask for twice the enhance ceiling, and the enhanced page is dropped once
  the view is back at fit.

### 13.2 Reading polish — reflowable text (§1.1 typography leftovers) — **shipped**

`buildCss` in `foliate-reader.tsx` (EPUB) and the shared helper `lib/typography.ts`
(TXT/RTF via `textBlockStyle` + `paragraphStyle`, HTML/Markdown via
`typographyCss` injected into the reader iframe) apply one identical rule set,
driven by the Display tab's Text block:

- **Justification** — `textAlign: "start" | "justify"`; pairs with hyphenation.
- **Hyphenation** — `hyphenate` → `hyphens: auto` (`lang` from OPF metadata).
- **Letter spacing** — `letterSpacing` in hundredths of an em (−2…+8); code and
  headings opt out so monospace blocks and titles stay untracked.
- **Paragraph rhythm** — `paragraphSpacing` (tenths of an em, 0…20) or a
  first-line `paragraphIndent`, never both; the first paragraph gets neither.
- **Widow/orphan control** — `orphans: 2; widows: 2` plus
  `overflow-wrap: break-word` so long URLs stop forcing horizontal scroll.

Verified by `tests/unit/typography.test.ts`; suite at 283 tests, type-check clean.

### 13.3 Formerly deferred from §12.4 — now shipped (§15.4)

ComicInfo.xml series metadata and guided-view panel stepping are **done**:

- [x] **ComicInfo.xml metadata** — `lib/comicinfo.ts` reads `series`, `number`
      and `count` from the sidecar (falling back to the file name) at import,
      filling missing title/author too, and persists them on the book record.
- [x] **Series stacking** — `components/library/series-card.tsx` groups issues
      of one series into a single stacked card with an issue count; clicking it
      drills into that series' issues with a back link to the full shelf.
- [x] **Guided view** — `lib/guided-view.ts` (recursive gutter-projection panel
      detection, edge-ring background level, reading-order sort, panel zoom
      math) plus `focusOn` in `use-comic-zoom.ts`. `comic-reader.tsx` scans the
      page on screen when the Display-tab **Guided view** switch is on, steps
      panels through taps and arrow keys, starts a turned page on its first
      panel (its last when stepping backwards), and falls back to whole-page
      paging when a page yields fewer than two panels or the browser cannot
      scan. Single-page mode only — a spread has no single reading order.
- Verified by `tests/unit/guided-view.test.ts` and `comicinfo.test.ts`; the
  full unit suite passes (278 tests) and the project type-checks clean.

### 13.5 Per-book upscale filter — shipped (2026-09-08)

Closes the last §12.4 item. `BookRecord.sharpZoom` / `sharpAmount` persist a
per-book override of the global sharp-zoom toggle and strength; the reader
kernel folds them into the settings handed to the engine, and the Display tab
shows a follow / on / off segment plus a strength stepper whose reset clears
the override back to the global value. Comics only (`imageAdjust` + `rtl`).
Type check clean, 283 unit tests pass, build OK.

### 13.6 PDF forms (AcroForm) fill + save — shipped (2026-09-10)

Closes the last open §1.2 row and the §12.5 deferral.

- `lib/pdf-forms.ts` — reads a PDF's AcroForm fields (text, checkbox, radio,
  dropdown/listbox) into a typed model, writes answers back with `pdf-lib`, and
  can emit a flattened ("locked-in") copy.
- `components/reader/drawer/forms-tab.tsx` — a **Form** drawer tab, shown only
  when the open PDF declares fields (`caps.forms`). Lists every field with the
  right control, a "n of m filled" counter, and **Save answers**,
  **Save a copy** and **Discard changes**.
- `reader-shell.tsx` saves the filled bytes back to the book's blob in
  IndexedDB, so reopening the book shows the answers on the page; the copy is
  downloaded flattened so it can no longer be edited.
- Verified end to end in the browser on a real three-field form (fill → save →
  reopen → values intact and rendered; flattened copy has zero fields; a PDF
  without a form shows no Form tab). Unit tests in
  `tests/unit/pdf-forms.test.ts`; full suite **297 tests passing**, build OK.

**Remaining roadmap:** only the two standing deferrals — extra sync providers
(WebDAV / Drive) and chunked blob-sync resume.

---

## Status update (2026-10-04) — release audit

Legend: Done / Partly done / Not started; Tested = unit tests, Browser = checked in a browser.

| Feature                                                   | State                                                                  | Tested                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| Resumable book-file transfers                             | Done                                                                   | Unit tests                                             |
| First-run shelf: sample books, empty and filtered states  | Done                                                                   | Unit tests (`first-run`); browser checked (phone size) |
| Reader bars keyboard focus, progress announcements        | Done                                                                   | Browser checked (phone size)                           |
| Book-not-found vs storage-failure screens                 | Done                                                                   | Browser checked (phone size)                           |
| Collections sidebar on phones (collapsed behind a toggle) | Done                                                                   | Browser checked (phone size)                           |
| Account sync (the builder's cloud)                        | Partly done — needs the Cloud backend, not available on static hosting | Not tested end-to-end                                  |
| AI reading help (explain / summarize / translate)         | Partly done — needs a server and the AI key; errors on GitHub Pages    | Not tested                                             |
| WebDAV sync                                               | Not offered — code exists but is unused                                | Unit tests on provider only                            |
| Google Drive sync                                         | Not started — needs an OAuth client                                    | —                                                      |
| Production build                                          | Passes (server-style output, not yet tried on GitHub Pages)            | —                                                      |

## Verification log

### 2026-10-04 — independent review of the final round of the first build

Verified by reading the code, running the checks, and reproducing each bug with a test:

- Fixed: `getTheme("match", …)` returned `id: "match"`, so the EPUB engine's `id === "dusk"` checks (fixed-layout inversion, dark highlight tuning) never fired for the default theme in a dark app. It now returns the resolved theme. Test: `tests/unit/reader-settings.test.ts`.
- Fixed: an explicit PDF night-scan "off" was lost on reload (the loader read a `pdfInvertSet` flag nothing wrote). Saved settings now carry `settingsSchema`; schema 1 `false` becomes automatic once, schema 2 `false` is kept. Same test file.
- Fixed: the night-scan toggle showed the raw setting, so it read OFF while a Dusk PDF was inverted. It now shows the effective state, with a "Follow the theme" reset when set manually.
- Fixed: the evicted-book screen said to "add the file again", but a re-import creates a new book with no progress. There is now a real re-attach (`reattachSource`, same record id, size-checked by `checkReattach`) plus an "Open Settings" link. The decision logic is unit-tested; the IndexedDB write path reuses `putBookFile`/`patchBook` and is not covered by a test (no IndexedDB fake in the test setup).
- Fixed: the five vendored bundles under `public/vendor` had been reformatted by Prettier (about +470 KiB precache). Restored byte-for-byte; `public/vendor` and `public/samples` are now in `.prettierignore`.
- Fixed: the hero "Add books" button had lost its red accent; restored. Removed the unrequested `release:check` script, dead `isIosSafari` code and a duplicate storage key. The highlight variables are now written on the first call, so a Paper reader inside a dark app no longer inherits the dark tint.
- Not verified: all browser/visual behaviour (layout at 280/360px, focus outlines, install card, dark theme appearance). No browser was available.
- Known and unchanged: the build is a server-rendered worker with no `index.html`; the generated service worker binds its navigation fallback to `/`, which is not precached (Workbox throws `non-precached-url` for that), so offline behaviour of the current build is unproven. Both are addressed by the static-build conversion.

### 2026-10-05 — checkpoint 2: static, client-only build

What changed, and how each part was checked:

- **Entry point.** TanStack Start + Nitro (Cloudflare preset) and the `@lovable.dev/vite-tanstack-config` wrapper are gone. `index.html` + `src/main.tsx` mount a plain TanStack Router (`src/router.tsx`) with **hash history** (`#/read/abc`). `vite.config.ts` is a vanilla config: router plugin, React, Tailwind, tsconfig paths, the PWA plugin and a tiny plugin that injects the theme boot script. `base: "./"` makes every built URL relative.
- **Removed:** `src/integrations/` (Supabase), `src/routes/api/` (the AI route, which spent a gateway key with no login check), `src/routes/auth.tsx`, `src/lib/{sync,sync-transfer,sync-providers,webdav.*,ai-assist,auth,builder-error-reporting,error-page}`, the sync panel, the AI buttons in the selection popover, `supabase/`, `.lovable/`, `bun.lock`, `bunfig.toml`. Three test files for removed modules went with them (31 tests: sync-merge 20, sync-transfer 8, webdav-server 3).
- **URLs.** Every runtime reference to a public file goes through `assetUrl()` (`src/lib/asset-url.ts`, 5 tests). The OCR worker receives an absolute vendor URL from the main thread, because a worker resolves relative URLs against its own script in `assets/`, and tesseract.js spawns a second worker from that path.
- **Service worker.** `navigateFallback` is `index.html`, which now exists and is precached. In the first build there was no `index.html`, the fallback was bound to `/`, and Workbox throws `non-precached-url` for that at startup (read from Workbox source; never observed in a browser).
- **`npm install`.** Plain `npm install` crashed in npm 10.9.7 (`Cannot read properties of null (reading 'edgesOut')`, inside `#loadPeerSet` while resolving `vitest`). Every plugin declares Vite 8 support, so it is a resolver bug, not a conflict. A committed `.npmrc` sets `legacy-peer-deps=true`, which is the configuration all verification used. `@vitest/coverage-v8` (unused) was removed; the `rolldown` override went with the builder wrapper, so Vite now resolves its own rolldown (1.1.5).
- **Checks.**
  - `npm run verify:static` (`scripts/verify-static.mjs`) reads `dist/` and serves it under `/some/sub/path/`: no root-absolute URLs, every referenced and precached file returns 200, the manifest is relative, the fallback target is precached. It never writes claims anywhere. It was run against four deliberately broken builds (root-absolute favicon; fallback bound to `/`; a missing precached file; manifest `start_url: "/"`) and failed each one with the matching message.
  - Typecheck 0 errors; 333 unit tests in 35 files (the last 8 are the two files below); lint clean on every file written or edited here (pre-existing `no-explicit-any` errors in `comic-cover.ts`/`comic-reader.tsx` are untouched).
- **Shell and storage tests.** `tests/unit/app-shell.test.ts` mounts `RouterProvider` with the real route tree in jsdom against `fake-indexeddb` (new devDependency): empty-shelf hero, `document.title` set through `HeadContent` in single-page mode, `#/settings`, navigation by hash, not-found page. Mutation: removing `<HeadContent />` fails the title test; restoring browser history fails the settings, navigation and not-found tests. `tests/unit/book-storage.test.ts` runs `evictSource` then `reattachSource` through the real db.ts and checks the record id, kept fields, cleared `blobEvicted` and the reader-state decision (removing the `blobEvicted: false` patch fails it). Finding while writing it: fake-indexeddb structured-clones what it stores and a **jsdom** `Blob` comes back as an empty object (`size` undefined) while Node's `Blob` round-trips; the test therefore uses Node's `Blob` (a test-environment artifact, not an app bug; real browsers store real Blobs).
- **Not verified:** all behaviour in a real browser (hash routing, back button, `HeadContent` titles in SPA mode, the service worker actually installing and serving offline, install prompts); the GitHub Actions workflow; the Playwright specs (`library.spec.ts` is the old spec minus its sync tests; none have been run by a reviewer).
- **Known leftovers.** Runtime dependencies that nothing imports: `@hookform/resolvers`, `date-fns`, `tesseract.js-core` (the last may be the source of the vendored files; check before removing). `components.json` is shadcn/ui config and can stay. The `Define` lookup and Google Fonts are the only network requests.

### 2026-10-07 — checkpoint 3: rename to Nawiri, safe local-file mode, annotation export

Source of direction: the owner's strategy document (`docs/strategy.md`; its claims about other products are unverified). Baseline first, from a clean `npm install` of the checkpoint-2 zip: typecheck 0 errors, 333 tests in 35 files, build precaching 36 files, `verify:static` passing, lint 53 errors / 15 warnings — all as `HANDOVER.md` said.

**Rename.** `Folio`/`FOLIO`/`folio` → `Nawiri`/`NAWIRI`/`nawiri` across 42 files (reviewed as a diff against the original zip, not trusted as a regex), package name `tanstack_start_ts` → `nawiri`. Persisted names were treated separately: the IndexedDB name `folio-library` is kept on purpose (no rename API; a migration would copy a whole library); the backup manifest accepts `nawiri` and `folio`; localStorage keys migrate once at start (`src/lib/legacy-storage.ts`) and the pre-paint theme script falls back to the old theme key. Checked by `legacy-storage.test.ts` (6) and `backup-legacy.test.ts` (3, including a real legacy-format zip through the real `importBackup` against fake-indexeddb). Mutations that each failed the intended test: new key overwritten by old; legacy theme fallback removed; manifest back to the strict `z.literal("nawiri")`. The built bundle still contains `folio` only in those compat paths and in pdf-lib's page-size table (`Folio` paper size).

**Safe local-file mode.** Reproduced first: foliate-js (`paginator.js`) sandboxes section iframes with `allow-same-origin allow-scripts`; `epub.js` blocks external script files by default but its own source says inline scripts are not handled. A test builds a hostile EPUB and opens it with foliate's real `EPUB` class: without the guard the section handed to the iframe contains the inline script, an `onerror` handler, a remote tracking pixel, and its stylesheet contains remote `@import`/`url()`.

- `src/lib/safe-document.ts` (pure DOM): removes `<script>`, `on*` attributes, `javascript:`/`vbscript:` URLs (including whitespace-obfuscated), iframes/embeds/non-local objects/`<base>`/meta refresh/`ping`/form actions, SVG `set`/`animate` of `href`/handlers; drops remote `src`/`href`/`srcset`/`poster`/CSS `url()`/`@import`; lists external links; injects a CSP `<meta>`; fails closed (unparseable XML becomes a fixed stand-in). 23 tests. Five mutations each failed a specific test: handlers kept, scheme obfuscation not stripped, scripts kept, protocol-relative URLs treated as local, fail-open on parse error. The three sample EPUBs: every XHTML section keeps byte-identical text and blocks nothing.
- `src/lib/guard-book.ts`: EPUB through foliate's `transformTarget` `data` event (markup and CSS); MOBI/AZW3 by wrapping `section.load()` with read-back, harden and re-publish, revoking on unload and dispose. 9 tests against the real EPUB class and fake MOBI sections. Mutations: listener not attached (2 tests failed); MOBI wrapper returning the original URL (3 failed).
- UI: `safe-reading.tsx` (shield button with count and panel; `ExternalLinkGuard`), `safe-report.ts` store (reports are kept per section so paging back does not double-count). 12 jsdom tests; mutations: Open link not opening, link filter removed, per-section de-duplication removed, Esc/overlay dismissal opening the link — each failed the intended test.
- Wired into the foliate reader (guard attached before `view.open`; `external-link` cancelled and routed to the dialog), HTML reader (whole-page hardening so `<head>` scripts are counted; CSP meta; click handling), CHM reader, and PDF link annotations (`data-external` + handler).
- **Not verified:** CSP enforcement in any browser (iOS/WebKit and XHTML sections especially); MOBI wrapper against real `mobi.js`; the HTML/CHM/PDF click handlers have no unit tests (typechecked only).
- Mistakes made and caught along the way: a first claim that a blind `sed` would corrupt `foliate-js` was wrong ("foliate" does not contain "folio"); `<ExternalLinkGuard />` was first inserted inside the `{selection && …}` conditional (tsc error, fixed); a text replacement missed a Prettier-reflowed import and left a duplicate that only the test run caught, because `tsc` here does not cover `tests/`.

**Annotation export.** `src/lib/annotation-export.ts`: Markdown (front matter only at file start; JSON-quoted YAML values; `<tag` neutralised), HTML (every character escaped; CSP `default-src 'none'`; no script or remote references), JSON (lossless), CSV (RFC 4180, CRLF, UTF-8 BOM, formula-injection guard). Per book from the notes tab, whole shelf from Settings (`groupByBook`). 23 + 4 tests; the CSV is read back with a parser written independently of the writer. A test found a real bug: the filename slug used `[^\p{L}\p{N}]`, which split Devanagari words at vowel signs and the virama (category M); fixed with `\p{M}`. Three other test failures were wrong fixtures, not code (a hostile string that did not start with `=`; a URL regex that matched escaped text; an inaccurate test title). Mutations: formula guard removed, BOM dropped, HTML escaping removed, Markdown tag neutralisation removed, slug fix reverted, wrong format exported, controls shown with nothing to export, empty rows exported — each failed the intended test. One mutation first looked passing because the edit broke the file's syntax (the run reported "no tests"); it was redone properly.

**Measured at the end** (in the working tree, then again from a clean extract of the delivered zip — see the line below): typecheck 0 errors; 413 tests in 42 files; build precaches 36 files (10792.48 KiB); `verify:static` passes; lint 53 errors / 15 warnings, identical to baseline per file (the new files add none); Prettier check clean on every file changed.

**Not examined this checkpoint:** the strategy's other items — shelf search beyond opened books, library health, re-anchoring, OCR studio, semantic search, study workspace, comics, language packs, analytics, vault, reader modes, accessibility. `roadmap.md` records the current state of each, including which were only audited by reading existing features rather than tested.

**Clean-extract check of the delivered zip (2026-10-07):** extracted `nawiri-checkpoint-3.zip` into an empty directory; `npm ci` added 724 packages; typecheck exit 0; 413 tests in 42 files passed; build precached 36 files (10792.48 KiB); `verify:static` passed; lint 53 errors / 15 warnings (equal to baseline). This paragraph was appended after that run, so the delivered zip differs from the verified tree in this file only (checked with `diff -rq`).

### 2026-10-07 — checkpoint 4: wordmark stopgap, brand hand-off, first browser evidence

- **Evidence received.** Four owner screenshots (desktop, dark mode) — see `HANDOVER.md` for exactly what they show and what they do not. They are the first real-browser view of the project: the name renders, covers load, an EPUB opens with the shield button present, a CBR comic opens.
- **Diagnosis from pixels.** A 6x crop of the header shows `NAWIRI` with the A/W touching and W-I-R-I merged, next to a widely tracked `READER`. Source: `tracking-[-0.02em]` on Inter Tight (already a tight face). Changed to `tracking-[0.05em]`. **Not rendered or seen after the change** — no browser here and no font preview was built.
- **Correction.** The signal red is `#de2d1e` (`#ff5541` for text on dark) in `src/styles.css`; an older plan line saying `#FF3B00` is stale. `docs/brand.md` records the measured tokens and the logo hand-off.
- **Test material.** One screenshot's comic file name carries a scene-release tag. It is not used as a fixture; comic tests and demos should use public-domain or synthetic files.

### 2026-10-07 — checkpoint 5: the logo

Input: four SVG files the owner got from an outside tool (an eight-concept sheet, a lockup, a dark lockup, a READER lockup), which turned out to be hand-written SVG code rather than generated images.

**What was measured in them (rendered with librsvg and the real fonts; glyph and layout numbers from the font and the pixels):**

- The wordmark was live `<text font-family="Inter Tight, Inter, Arial">`. Rendered with Arial as the fallback, the widths changed and the hand-tuned `dx` nudges stopped meaning anything. For a logo asset the letters must be outlines.
- The file's own comment claimed a cap height of ~200; Inter Tight's is 0.728 em, so 160 at the 220 px size used.
- Symbol 320 tall against a 160 cap height; wordmark baseline 12 units below the cut-out N's baseline; gap symbol-to-word 33 units (21% of the cap height).
- READER lockup: placed at a fixed x, 149 units after the word, ending 50 units from the canvas edge (left margin 414): lopsided.
- Of the eight concepts, #5 (dog-eared page with a cut-out N and a red fold) was clearly the strongest; #4 read as a bar chart, #8 as an owl face, #6's W was broken, #1's red I floated off the word.
- At 16 px the symbol's page, N and red fold were still distinguishable.

**A correction to my own critique.** I first called the N "off-centre" (margins 64/112/80/64). Rendering five placements showed it is a deliberate construction: inset 64 from the left and bottom, top exactly on the fold line. Centring pushed its corner to 8 units from the fold's vertex, and the near-miss variants looked worse than the exact one. The symbol geometry was therefore kept unchanged.

**What was built.** `scripts/brand/make_brand.py` (fonttools + HarfBuzz for real kerning + librsvg): outlined wordmark; cap height = the N's height (176); cap top on the fold line, baseline on the N's baseline; weight chosen by measurement (I stem at cap 176: wght 600 = 31.9, 650 = 34.5, 700 = 37.1; the N's stem is 32) so the wordmark's stroke equals the symbol's; tracking +0.05 em and a 96-unit gap picked by eye from a four-row comparison; READER on the same baseline. Icons: `any` tiles, a full-bleed maskable with a programmatic check that all content lies inside the 40%-radius safe circle (furthest content pixel 196 px against a 205 px limit), apple-touch-icon without alpha, a favicon.ico of three directly-rendered sizes, and an adaptive favicon.svg. The old manifest pointed one cream icon at both `any` and `maskable`; the new one has a separate maskable file.

**Integration.** `NawiriLogo`/`NawiriSymbol` (inline SVG, `currentColor` for page and letters, `var(--signal-ink)` for the fold, width/height attributes so height-only sizing works in Safari). Header: `h-6 sm:h-7`; the READER label is hidden below `sm` (a 360 px phone cannot fit the larger logo, the label and the buttons; not observed) and has `mb-1`, which was computed from JetBrains Mono's metrics (baseline inset 1.54 px at 11 px / line-height 1; the wordmark's baseline is 20% of 28 px = 5.6 px above the logo's bottom; 5.6 - 1.54 = 4.06 px).

**Tests added (33):** `brand-assets.test.ts` (27: every manifest icon exists at its declared size; the maskable is a separate full-bleed file; 'any' icons have transparent corners; apple icon 180 px with no alpha; ico directory and embedded PNG sizes agree; index.html links resolve; every brand SVG has no `<text>`, font, raster, script, external reference or gradient and uses only the four brand colours; the app's generated paths equal those in `brand/nawiri-logo.svg`), `logo.test.ts` (5), one header assertion in `app-shell.test.ts`. Eight mutations each failed the intended test: maskable pointed at the 'any' icon; `<text>` added to a logo; an off-palette red; drifted wordmark path; apple icon with alpha; N fill-rule removed; header without the logo; transparent corner on the maskable icon. A first version of the corner test only checked the PNG colour type while claiming to check corners; it was replaced by a real pixel read, which then caught that rsvg writes the opaque icon as RGB without alpha.

**Lint:** the generated `paths.ts` first added 2 Prettier errors; the generator now wraps long strings the way Prettier does, and lint is back to the baseline.

**Not verified:** anything in a browser (header, READER baseline, 360 px layout, tab icon in light and dark themes, installed-app icons); the wordmark outlines were cut from the font instanced at exactly wght 600 by fontTools, so they do not depend on any renderer or on Google Fonts; the READER label is HTML text and still does. Precache fell from 10792.54 to 10468.07 KiB because the old 295 KB `icon-512.png` was replaced by a 10 KB flat one.

### 2026-10-07 — first real-browser look at checkpoint 5, and a 502 over ngrok

- **Header logo, desktop, dark mode** (owner screenshot of the dev server at `localhost:5173`; the image is 1.25x the CSS size, consistent with 125% Windows scaling). Measured from the pixels: symbol 35 x 35 px (28 CSS px), wordmark cap height 19 px (54% of the symbol; designed 176/320 = 55%), gap symbol to word 11 px (31%; designed 30%), wordmark baseline y = 108 and READER baseline y = 108. So the `mb-1` computed from JetBrains Mono's metrics put the label on the baseline, and the logo renders as the preview sheet showed, with the coral fold. The shelf stats strip and the continue-reading hero rendered too.
- **ngrok.** The owner's terminal showed the tunnel online on a free-plan domain under `ngrok-free.dev` (a suffix the Vite allow-list already covers), forwarding to `http://localhost:4173`, with three 502 Bad Gateway responses, all at the same instant, for `/favicon.ico`, `/apple-touch-icon.png` and `/apple-touch-icon-precomposed.png`, and 3 connections total, 0 open. A 502 comes from ngrok, not from Vite: nothing answered on port 4173. The same screenshot set showed the app running at port 5173 (the dev server), so the likely cause is that `npm run preview` was not running. Not confirmed: the IPv6/IPv4 `localhost` explanation remains a guess. The three requests are root-level icon lookups, which browsers make for a page that declares no icons; the app declares its icons, so they most likely came from ngrok's own warning page, i.e. the tunnel and domain work and the failure is behind them. That is an inference.

### 2026-10-08 — checkpoint 7: tunnel hosts for phone testing

- **Evidence.** An iPhone Safari screenshot of `https://<name>.ngrok-free.dev` (after the owner pointed ngrok at the dev server on 5173 instead of the preview port, which had caused the earlier 502) shows Vite's plain-text "Blocked request. This host ... is not allowed ... `server.allowedHosts`". So the tunnel reaches the dev server from a phone, and the app itself was not yet shown.
- **Reproduced** by sending the same Host header to a local dev server: `localhost` 200; `scribe-reboot-list.ngrok-free.dev`, `abc123.ngrok-free.app`, `x.ngrok.app`, `evil.example.com` all 403 with the same message.
- **Fix.** `TUNNEL_HOSTS` in `vite.config.ts` (`.ngrok-free.dev`, `.ngrok-free.app`, `.ngrok.app`, `.ngrok.dev`, `.ngrok.io`) used for both `server.allowedHosts` and `preview.allowedHosts`. After the change, both the dev server and `vite preview` return 200 for the four ngrok host names and still return 403 for `evil.example.com`. Not covered by a unit test (the check lives in Vite's server); the spoofed-Host script is in this log's description above and is cheap to repeat.
- **Not verified:** the app loading on a phone through ngrok; that the ngrok warning page does not interfere with the service worker's offline download; the IPv6/IPv4 `localhost` explanation for a possible 502 (still a guess).

### 2026-10-10 — checkpoint 8: first phone feedback (iPhone through ngrok)

- **Evidence.** Seven iPhone Safari screenshots (2026-10-09): the app running over ngrok after the allow-list fix; installed home-screen icon; an EPUB ("Fire & Blood") imported; the continue-reading hero with a broken-image glyph where the cover should be; the safe-reading panel open on a clean book ("Nothing so far") with a red focus ring on its close button; phone header with the new logo (READER hidden by design). Plus three complaints in words: what "safety reading" is, back-swipe that keeps going, the reader's top bar "a nightmare" to bring up.
- **Sandbox reset.** The working tree was wiped between turns and a batch of unzipped edits was lost; checkpoint 7 was restored and the edits redone. Lesson recorded in `HANDOVER.md`: deliver a zip after every meaningful batch.
- **Back-swipe, reproduced first.** `navigation.test.ts` against the unmodified code: history length after each open/close of Settings 3, 5, 7, 9 (two entries per cycle); a cold start on Settings followed by its back arrow left a stack of 10 instead of 9. After `BackLink`: constant. A first version of the cold-start test passed under the mutation "drop `replace`" because `history.length` did not move in jsdom (it printed 2 before and 2 after); it was rewritten to read the router's `__TSR_index` (0 for the bottom of the stack, 1 after a push) and the mutation then failed it ("expected 1 to be +0").
- **Mutations, all caught by the intended tests:** BackLink always pushing; URL revoked at once; cover served from the original blob; `show()` not restarting the timer; shield shown on a clean book; shield shown for PDFs; reveal band reacting to press; reveal band covering the whole screen.
- **Measured:** typecheck 0 errors; 463 tests in 47 files; build precaches 38 files (10469.39 KiB); `verify:static` passes; lint 53/15 equal to baseline; Prettier clean on every changed file.
- **Not verified:** all of it on a phone. The swipe gesture itself; whether the top-edge band feels right (it is a guess at the convention, not a tested interaction); the `100dvh` effect; either cover hypothesis; wiring of the new pointer handlers in `reader-shell.tsx` (no test).
- **Other small things seen in the screenshots and deliberately left:** words hyphenated mid-line in the narrow reading column ("coro-nation", "incom-plete"); the "Added 1 book" toast sitting over the bottom edge. Not changed without a decision.

### 2026-10-11 — checkpoint 9: first real-browser pass (desktop Chromium), two defects fixed

Work done 2026-10-10 and 2026-10-11. **Baseline first**, from a clean `npm install` of the checkpoint-8 zip: typecheck exit 0; 463 tests in 47 files; build precaches 38 entries (10469.39 KiB); `verify:static` passes; eslint 53 errors / 15 warnings (51 `no-explicit-any`, 1 `no-extra-boolean-cast`, 1 `no-unused-expressions`); a `diff -rq` of the working tree against a second extract of the zip showed nothing changed. All as `HANDOVER.md` said, except the environment (below). Install: 724 packages, 15 s, lockfile byte-identical.

**Environment differences from the checkpoint-8 notes.** bash instead of plain `sh`; npm 10.9.4 on Node 22.22.0; and **a Chromium 141 at `/opt/pw-browsers/chromium`** (the notes said no browser had ever been reachable). `playwright-core` 1.63.0 from the project does not match the preinstalled revision, so the browser was launched with `executablePath`. Google Fonts and Wikipedia are refused by the sandbox network; the two console errors on every load (`net::ERR_TUNNEL_CONNECTION_FAILED`) are exactly the two `fonts.googleapis.com` requests in the request log. Inter and Lora are installed locally, JetBrains Mono is not. `brotli`, `uharfbuzz` and `rsvg-convert` are missing, so `make_brand.py` cannot run as it stands.

**Method.** The built `dist/` was served with `vite preview`; scratch scripts outside the repo imported a file through the real file input and drove the app. The hostile test book (`fflate` zip, 2.4 KB) has an inline script that writes flags onto `window.parent`, a script file, `onerror`/`onclick` handlers, a `javascript:` link, a tracking pixel, remote CSS (`@import`, `url()`, `<link>`), a `<meta http-equiv=refresh>`, an SVG with a script, an external link and an internal link. Three mutated copies of the source (in a scratch directory, `node_modules` symlinked) were built and run with the same probes: A `guardBook` disabled; B `hardenDocument` skipped with the CSP `<meta>` kept; C `BackLink` back to a plain pushing `<Link>`.

**Safe mode, EPUB, Chromium (seen).** Original build: section iframe is a `blob:` frame with `sandbox="allow-same-origin allow-scripts"`; it contains 0 `<script>`, 0 `on*` attributes, the pixel `src` emptied, the remote stylesheet link replaced by a `blob:` one, the `javascript:` href emptied, the CSP `<meta>` present; no `window.__pwned*` flag set; **no request to any `*.example` host at all** (including the meta-refresh target); console has only the two font errors and two Chromium warnings ("An iframe which has both allow-scripts and allow-same-origin … can escape its sandboxing", from foliate's own iframes). Shield: `aria-label` "Safe reading: 11 blocked in this book"; panel rows Scripts 3, Event handlers and javascript: links 3, Redirects/base/form actions/pings 1, Remote content (4), Links to other places (1): 3+3+1+4 = 11. Clicking the external link opens a dialog ("This book wants to open a page on example.org…", _Stay here_ / _Open link_) with no request, no popup and no URL change; _Stay here_ opens nothing; _Open link_ opens a popup at exactly `https://example.org/read-more` (a stub route answered it) whose `window.opener` is null; the `javascript:` link and the `onclick` paragraph did nothing; the internal link moved to Chapter Two with no attacker request. **Mutation A:** `__pwned_inline` and `__pwned_onerror` were set on the app's window and requests went out to `evil.example/exfil`, `tracker.example/pixel.gif`, `css-tracker.example/remote.css`, `fonts.example/x.css` and `refresh.example` (the shield was absent). **Mutation B:** no flags; the console shows "Refused to execute inline script … script-src 'none'", "Refused to execute inline event handler", "Refused to load the image 'https://tracker.example/pixel.gif'" and "Refused to load the stylesheet …": the injected CSP `<meta>` **is enforced in Chromium for an XHTML section in a blob iframe**. The meta-refresh navigation (`refresh.example`) was _not_ stopped by it, so the sanitiser is the only defence for that. Playwright's `request` event also lists requests the CSP then refused, so a request-log entry alone does not prove traffic left; the original build had none at all.

**Back navigation, Chromium (seen).** `history.length` over four Settings open/close cycles: 3→3, 3→3, 3→3, 3→3; over four book cycles the same; one Back from the shelf leaves the app; cold start on `#/settings` → _Shelf_ keeps length 2 and one Back leaves; cold start on a book URL → back arrow likewise. **Mutation C** (old behaviour): 3→4, 5→6, 7→8, 9→10, then 11→12 … 17→18; Back from the shelf stays in the app; after a cold start the stack is 3 and Back returns to Settings. The unknown route shows "404 / Page not found / Go home". Not a swipe gesture and not Safari.

**Reader bars, 360 px, touch emulation (seen).** Bars hid about 6.6 s after opening (the first delay is 6 s); a 360x48 `Show reading menu` button appeared; a tap at the top edge showed the bars and stayed on the reader; a tap on the title text 3.5 s after the reveal left the bars shown at 6.0 s (without a restart they would have hidden at 4.5 s) and they hid by 8.2 s; a tap on the page middle showed them; a tap on the back arrow returned to the shelf. The `onPointerDownCapture` wiring that had no test is therefore working in Chromium. No mutation was run on this probe.

**Layout (seen, Chromium emulation).** No horizontal overflow at 360 or 280 px on the shelf, Settings and the reader. Top-bar controls at 360 px (with the shield): back 12–52, shield 152–192, notes 204–244, search 256–296, display 308–348, title block 64–140 (76 px); at 280 px the controls end at 272 and the title block is 0 px wide. Phone header: symbol, wordmark, theme button, Settings, Add books; READER hidden.

**Theme (seen).** With every `/assets/*.js` request aborted (so only the inline boot script and CSS run; `#root` empty): OS dark/nothing stored → dark, `rgb(17, 17, 17)`, theme-color `#111111`; OS dark + `nawiri-theme=light` → light `rgb(253, 253, 253)`; OS light + `nawiri-theme=dark` → dark; OS dark + legacy `folio-theme=light` → light; OS light/nothing → light; OS dark + garbage value → dark (system). Light mode through the Settings radio: `html.dark` removed, `nawiri-theme=light`, theme-color `#fdfdfd`, kept after reload; shelf, reader and the safe-reading panel were looked at in light mode. No mutation was run.

**Defect 1 — the service worker never registered.** The offline probe hung on `navigator.serviceWorker.ready`. `getRegistrations()` returned `[]` after 6 s, there was no `sw.js` request and no cache. An init script wrapping `addEventListener` recorded the `load` listener being added with `document.readyState === "complete"`, 536 ms vs `load` at 495 ms; 465 vs 410; and 2698 vs 2651 in a run with the font stylesheet delayed 2.5 s: always about 50 ms after `load`, so always too late (`registerServiceWorker()` is called from a `useEffect` in `__root.tsx`; the cause of the ordering was inferred, not traced). Fix in `src/lib/pwa.ts`: register at once when `readyState` is `complete`, otherwise `addEventListener("load", register, { once: true })`. `tests/unit/pwa-register.test.ts` (5): three failed on the old code (no registration when already loaded; two registrations on two `load` events; the rejected-registration case never ran); the PROD guard and `?sw=off` tests passed before and after. Mutations: readyState check removed (3 fail); `{ once: true }` removed (1 fails). After the fix, in Chromium: one `sw.js` request; registration scope `http://127.0.0.1:4173/` activated; 38 cache entries (the build precaches 38); controlled after one reload; with the network off a reload returns the title and the shelf with the book card; the book opens and its text is present; cold starts offline on `#/settings` and on the book URL work.

**Defect 2 — a whole-paragraph selection overshoots by one block.** Found by reading the JSON/CSV export of two highlights made with triple-click: the first highlight's CFI was `…,/4[target]/1:0,/6/1:104` (end at the end of the _next_ paragraph) and its `contextAfter` was "Paragraph 2: the quick brown fox" (it should be Paragraph 1); the note on Paragraph 1 tinted Paragraph 2; the selection popover sat 90 px under the selection. The saved quote was right. The raw range in Chromium: triple-click on a paragraph gives start `(text, 0)` and end `(<p> of the next block, 0)`; on the last paragraph the end is inside its text (so it never showed there). `normalizeRange` used `el.childNodes[out.endOffset - 1] ?? el`; for offset 0 that is index -1, so it took the whole next element and its last text. Fix: `src/lib/normalize-range.ts` (moved out of `foliate-reader.tsx` verbatim first, so the new tests ran against the unchanged logic and failed: 5 of 10, with "Alpha one.Beta two." for "Alpha one."; one further test of mine had a wrong premise and was rewritten). For offset 0 the end is now the last non-blank text before the element. Mutations: the old end logic (6 fail), whitespace accepted (1 fails), walking forward (6 fail). After the fix, in Chromium: first CFI `epubcfi(/6/2!/4/4[target],/1:0,/1:83)` (83 = the length of that text), `contextAfter` "Paragraph 1: the quick brown fox"; second CFI ends `/1:104` in Paragraph 1; Paragraph 2 is no longer tinted; the popover sits directly under the selection. **Annotations saved by triple-click before the fix keep their old ranges; whether re-opening re-derives them from the quote was not checked.** Only the end boundary was changed; the start side (`childNodes[startOffset] ?? el`) has the mirror-image shape for a start at the end of an element and was not examined.

**Annotation exports (seen).** All four buttons in the notes drawer download (`nawiri-notes-hostile-probe-2026-10-10.{md,html,json,csv}`). CSV: UTF-8 BOM, CRLF (3 lines), header + 2 rows, a note beginning `=HYPERLINK(` is stored as `'=HYPERLINK(` with doubled quotes, fields with commas quoted; JSON parses (`app`, `kind`, `version`, `exportedAt`, `books[]`); HTML has the `default-src 'none'` CSP meta and every special character escaped (`&lt;b&gt;`); Markdown has front matter and the note, with `<b>` rendered as `&lt;b>`. Not done: the whole-shelf export from Settings; downloads on iOS Safari.

**Measured at the end (working tree):** typecheck exit 0; 478 tests in 49 files (463 + 5 + 10); build precaches 38 entries (10469.64 KiB); `verify:static` passes; eslint 53 errors / 15 warnings with per-file counts identical to the baseline run (a first run showed 54: a Prettier error in my new test file, fixed by formatting that file only); Prettier clean on every file changed (`pwa.ts`, `normalize-range.ts`, `foliate-reader.tsx`, both new tests, `README.md`, `roadmap.md`, `HANDOVER.md`; `futureplans.md` was already not Prettier-clean in the checkpoint-8 zip and is appended to, not reformatted).

**Seen and not changed:** safe-reading panel labels a CSS `url()` PNG as "Stylesheet or font"; title area width with the shield (76 px at 360, 0 at 280); _Stay here_ shows a red focus ring after a mouse click in the book; the progress label reads 80 % on the first screen of a two-section book whose first section is 1616 of 2027 bytes (reasoned, not confirmed in a long book); the `?sw=on` comment in `pwa.ts` does not match the code. **Not verified:** everything above on WebKit/iOS or a touch screen; HTML/CHM/PDF link guards; MOBI/AZW3; FB2; comics; the Add to Home Screen flow; the tab icon; the real Google Fonts. `npm run test:e2e` was not run (the config looks for a browser in `/opt/ms-playwright`).

**Clean-extract check of the delivered zip (2026-10-11):** extracted `nawiri-checkpoint-9.zip` into an empty directory (no `node_modules/` or `dist/` inside); `npm ci` added 724 packages in 16 s, 0 vulnerabilities; typecheck exit 0; 478 tests in 49 files passed; build precached 38 entries (10469.64 KiB); `verify:static` passed; eslint 53 errors / 15 warnings (equal to baseline); Prettier clean on every changed file except the already-unclean `futureplans.md`. The offline probe was also run against that extract's own build in Chromium: worker registered and activated, 38 cache entries, controlled after one reload, offline reload showed the shelf, the book opened offline and cold starts offline on `#/settings` and on the book URL worked. This paragraph was appended after those runs, so the delivered zip differs from the verified tree in `futureplans.md` only (checked with `diff -rq`).

### 2026-10-11 — checkpoint 10: the e2e suite run for the first time; six defects fixed

**Baseline first**, on the working tree equal to the delivered checkpoint-9 zip (`diff -rq` clean): typecheck exit 0; 478 tests in 49 files; build precaches 38 entries (10469.64 KiB); `verify:static` passes; eslint 53 errors / 15 warnings.

**E2E config.** `playwright.config.ts` looked only in `/opt/ms-playwright`; this sandbox has `/opt/pw-browsers/chromium-1194`, and Chromium refuses to start as root without `--no-sandbox`. The config now searches `PLAYWRIGHT_BROWSERS_PATH`, `/opt/ms-playwright` and `/opt/pw-browsers` for `chromium-*/chrome-linux/chrome` and adds the flag when `process.getuid() === 0`. First run of the three existing specs: 9 of 11 passed; `reader-pages.spec.ts:83` failed on a stale locator (`span[aria-live=polite]` matched the progress status span and the announcement; now `span.sr-only[aria-live=polite]`) and `reader-pages.spec.ts:61` on a real defect (below).

**Defect 1 — Pages rail, page 1 never drawn.** Snapshot of the failure: list item 1 had only buttons, items 2–4 had `img "Page N"`. `reader-shell` builds a new `renderThumbnail` closure on every render; `ThumbnailRail`'s draw effect depended on it, cancelled the running loop on every re-render and discarded the in-flight result, while the page stayed in the `queued` set. Page 1 is always first and so always in flight. Reproduced in `tests/unit/pages-tab-thumbnails.test.ts` before the fix (`['Page 2','Page 3']` instead of three). Fix: function read through a ref, in-flight results still land, a generation counter discards results from before a page op, one retry timer. The checkpoint-9 `pages-tab.tsx` fails the new test; dropping the generation check fails the page-op test. After: the pages spec passed 16 of 16 with `--repeat-each 4`.

**Defects 2–4 — links and highlights in the readers.** Written first as `tests/e2e/safe-reading.spec.ts` against the unfixed build: hostile EPUB, HTML, Markdown and PDF built at run time (`tests/e2e/hostile.ts`). Red on the old build: middle click showed no dialog and opened a tab in EPUB, HTML and Markdown (left, Ctrl, Shift and Enter already passed); in the PDF, `link.click()` timed out for left, middle, Ctrl and Shift ("element intercepts pointer events"). Causes: guards listened to `click` only (a middle click is `auxclick`); the PDF text layer (`z-index: 2`, whole page) was above the link layer and above the highlight overlay. Fixes: `guardAuxClick` (`src/lib/safe-report.ts`) wired into the HTML, CHM, foliate and PDF readers; PDF link layer `z-index: 3`, `pointer-events: none`, anchors `auto`; `markAt` and `isPlainClick` (`src/lib/mark-hit.ts`) so a plain click finds a highlight by geometry. Green: 14 safe-reading specs, 2 PDF-highlight specs (`pdf-marks.spec.ts`; the click-to-delete spec was red on the old build, "Delete" never appeared). **Mutations (each applied alone, the build re-made, the spec re-run, then restored):** foliate `auxclick` removed → only the EPUB middle-click assertions fail; HTML reader's removed → the same for HTML and Markdown; PDF `onAuxClick` removed → PDF middle click fails; link layer `z-index` removed → left, middle, Ctrl and Shift clicks cannot reach the link in the PDF (3 tests fail); layer `pointer-events: none` removed → the "text can still be selected" spec fails. Unit mutations on `markAt`/`isPlainClick` (edges exclusive, first mark wins, double click accepted, drag accepted) each fail exactly one test. **A process error worth recording:** a preview server I had started by hand was still on port 4173, so Playwright (`reuseExistingServer: true`) reused it and skipped the build; one run therefore tested a stale bundle and wrongly suggested the highlight fix did nothing. Found by noticing the build step never ran; the server was killed by PID and the spec re-run on a fresh build.

**Defect 5 — a restored backup's EPUBs would not open.** Found by `tests/e2e/backup.spec.ts` (whole-shelf export in four formats; backup, restore into a new browser context, open both books, notes visible, restore again). Console in the restored profile: `foliate failed TypeError: Cannot read properties of undefined (reading 'endsWith')`. Restore stores `new Blob(…, "application/octet-stream")`, which has no `name`; foliate reads it. `asNamedFile` (`src/lib/book-file.ts`) is applied where the reader route loads the file (so previously restored data is repaired too). Without it the spec fails at the EPUB; with it the round trip passes. Mutations: shelf export limited to the first book → the export spec fails; backup built without the book files → the round-trip spec fails on the missing `blobs/` entries.

**Defect 6 (latent) — `normalizeRange` start side.** Real Chromium gestures tried on the hostile EPUB (drag from past a line end, from the gap between paragraphs, from the left margin, upward drag, click then Shift+click, click then Shift+ArrowDown, Ctrl+A): every selection started inside a text node, so `(block, childCount)` was **not reproduced**. Unit tests (four, red on the old code) pin the intended behaviour: the selection starts with the next non-blank text, skipping whitespace between blocks, and an empty selection stays empty. Three mutations fail them.

**Found, not fixed — metadata-only backup.** In Chromium: books imported separately in a second profile, then the metadata-only backup restored there → toast "Restored 2 new and 0 existing books", four cards in the library, two of them records with no file ("This book isn't on your shelf"), and the real copies have no highlights. Cause (read from `importBackup`): books are matched by the random id made at import. Left for the owner (HANDOVER, Decisions).

**Measured at the end (working tree):** typecheck exit 0; 502 tests in 52 files (478 + 24); build precaches 38 entries (10471.50 KiB); `verify:static` passes; eslint 53 errors / 15 warnings (no new file in the list); `npm run test:e2e` 29 passed in 2.7 minutes; Prettier clean on every file changed. `futureplans.md` is not Prettier-clean (before and after this entry), so it was only appended to.

**Not verified:** CHM links (no fixture) and the middle-click guard in the CHM and MOBI/AZW3/FB2 paths; a finger on a PDF link or highlight (the specs use a mouse); a browser's context menu and an iPhone link preview on an external link (page script cannot intercept either; `-webkit-touch-callout` was not tried); all of it in WebKit; a restored book's reading progress and settings (the specs check books and marks only).

**Clean-extract check of the delivered zip (2026-10-11):** extracted `nawiri-checkpoint-10.zip` into an empty directory (no `node_modules/`, `dist/`, `test-results/` or `playwright-report/` inside); `npm ci` added packages in 20 s, 0 vulnerabilities; typecheck exit 0; 502 tests in 52 files passed; build precached 38 entries (10471.50 KiB); `verify:static` passed; `npm run test:e2e` from that extract passed 29 of 29 in 2.7 minutes (browser found by the new config; port 4173 was free, so the build step ran); eslint 53 errors / 15 warnings, per-file counts identical to a lint of the checkpoint-9 tree; Prettier clean on every file changed. This paragraph was appended after those runs, so the delivered zip differs from the checked extract in `futureplans.md` only.

### 2026-10-13 — checkpoint 11: old marks repaired, whole-paragraph selection in the other readers, two cosmetic fixes, metadata-only backup

**Starting point:** the checkpoint-10 end state (typecheck 0 errors; 502 tests in 52 files; 29 specs; build 38 entries, 10471.50 KiB; eslint 53 errors / 15 warnings). Items were taken in this order, each test-first, then broken on purpose. The mutation results below were **re-run on 2026-10-13 against the final sources** (scripts kept outside the repo, restoring from a snapshot of the current files so a restore cannot go backwards; `diff -q` after each run).

**Item 1 — repair of old whole-paragraph marks.** `src/lib/anchor-repair.ts` (`repairOvershoot`, pure), `repairStored` in `src/lib/annotations.ts`, `setAnchorCfi`, `onAnchorCfi` through `foliate-reader.tsx` and `reader-shell.tsx`. Tests: `anchor-repair.test.ts` (20; expected values are the records the fixed build stores for the same gestures, from three overshooting EPUB records of the old build in `tests/unit/fixtures/old-annotations.ts`), `annotation-repair-store.test.ts` (11, fake-indexeddb), `tests/e2e/old-marks.spec.ts` (2). Mutations of `repairOvershoot`: 10 tried, 9 caught (equal-length accepted, no type filter, whitespace-sensitive compare, no lost tail in the suffix, end off by one, CFI kept, no offsets/quote agreement guard, no 32-character cap, not-a-prefix accepted); **1 survived** (dropping the `anchor.kind !== "text"` guard): equivalent as far as reasoned, because a `cfi` or rect anchor has no string `quote` and the next line returns null for it; left as defence in depth. Mutations of the store layer: 9 tried, all caught (list skips repair; list-all skips repair; repairs the handed-in copy instead of the stored one; resurrects a mark deleted between read and repair; no fallback when the write fails; bumps `updatedAt`; opens a transaction with nothing to repair; does not write back; backup export reads the raw store). Browser mutations: repair made a no-op, and the engine's CFI never kept: both caught by `old-marks.spec.ts` at the stored-record comparison. Seen in Chromium while building it: an old-format record is corrected when the book opens; the jump to a repaired mark in an unloaded section initially landed on the section start (a pending jump set in the `load` handler is overridden by foliate's in-flight `goTo`), fixed with `view.goTo(index).then(goTo(cfi))`.

**Item 2 — whole-paragraph selection in HTML, Markdown, CHM and pretty-printed EPUB.** `flatIndex` rewritten around `Range.comparePoint` plus `boundaryIndex` (`src/lib/doc-text-map.ts`); blank-aware `firstText` and end/start fallbacks (`src/lib/normalize-range.ts`). Tests: `doc-text-map.test.ts` 16 (10 added), `normalize-range.test.ts` 19 (5 added), `tests/e2e/triple-click.spec.ts` 5 (real triple clicks). Unit mutations: 9 tried, 7 caught; **2 survived** (`<= 0` to `< 0` for the end boundary, `>= 0` to `> 0` for the start boundary, in `boundaryIndex`): reasoned equivalent, because the equal-point case needs the boundary to sit inside a mapped text node, and that is resolved before this rule is reached (reasoned, not proven). Browser mutations on `triple-click.spec.ts`: the old end rule fails 2 of 5 ("another paragraph follows directly", "Markdown, a paragraph follows"; Received shows the quote running into the next paragraph); dropping the text-less-child fallback and counting blank text as text each fail the pretty-printed EPUB with an image after. **Two of the five specs (HTML with an image after; pretty EPUB with a paragraph after) failed under none of the three browser mutations**; they pin today's behaviour.

**Item 3 — two cosmetic items.** CSS `url()` images are filed as images (`kindForCssUrl`): 4 mutations (always stylesheet, always image, query string not stripped, case-sensitive extension) each fail the one `hardenCss` test (24 tests in the file). Phone header: `gap-1.5 … sm:gap-3`; `tests/e2e/reader-header.spec.ts` (390/360/320 px); with the old spacing the three specs fail with title widths 106, 76 and 36 px against thresholds of 125, 95 and 55 (the fixed bar gives 30 px more at each width; 106 px at 360). 280 px not re-measured. Not reproduced / left: _Stay here_ focus ring, progress label on the two-section book, toast position.

**Item 4 — metadata-only backup.** `src/lib/book-identity.ts` (`fingerprintBlob`, `matchOwnCopies`), `src/lib/backup.ts` (export adds `fingerprint`; import matches own copies, re-keys marks, sessions and collections, never replaces an own file, sets `blobEvicted` from the file actually held), UI wording in `read.$id.tsx` and `settings.tsx`. Tests: `book-identity.test.ts` 19, `backup-identity.test.ts` 16, `backup.spec.ts` +3. Mutations of `book-identity.ts`: 11 tried; **1 survived at first** (dropping the unknown-size guard changed nothing because a one-sided unknown size already fails the size comparison; it matters when both sizes are missing or zero): a test for that was added and the same mutation is now caught; the other 10 were caught. Mutations of `backup.ts`: 15 tried; **3 survived at first** (own `addedAt` not kept, own `fileName` not kept, the `fingerprint` property leaking into the stored record) and each now fails an assertion added for it; the other 12 were caught (no re-key, book keeps the backup's id, matching off, own file overwritten, no "asks for file" flag, stale "removed" flag kept, flag not cleared after storing a file, sessions/annotations/collections not re-keyed, previous record ignores the own copy, export without fingerprint). Browser mutations (each rebuilt): matching off fails "same file on the device" at the toast `Restored 0 new and 1 existing books`; fileless record not flagged fails "no file on the device" at `no file on this device`; annotations not moved fails "same file on the device" at the note text in the notes tab. **Found by reading, then a failing test:** a backup record saying `blobEvicted: true` with a newer stamp won the merge and left the flag set on a book the device does hold (Settings would say "no file on this device" and disable the button; the reader would still open it); the flag is now derived from the file held. **A first browser run failed on a mistake in my test, not in the product:** the fixture builder's `zipSync` stamps the current time, so two calls gave two same-size EPUBs 4 bytes apart (checked: 234-byte archives, 4 differing bytes after 2.2 s), which the fingerprint rule rightly refused to match; the spec now builds one file and carries it between the simulated devices.

**Measured at the end (working tree):** typecheck exit 0; 584 tests in 56 files (502 + 82); build precaches 38 entries (10475.37 KiB); `verify:static` passes; eslint 53 errors / 15 warnings with per-file counts identical to the checkpoint-10 clean-extract run; `npm run test:e2e` 42 passed in 3.4 minutes (29 + 2 old-marks + 5 triple-click + 3 reader-header + 3 metadata-only); Prettier clean on the edited documents and files.

**Not verified:** anything on iOS/WebKit or a real phone (including the asks-for-file screen with a finger); a restore of a very large library (never timed); the PDF triple-click path; old HTML/Markdown/CHM marks (not repairable); CHM links and the middle-click guard in CHM and MOBI/AZW3/FB2; whether the two non-failing triple-click specs would catch a regression in the paths they cover.

**Clean-extract check of the zip (2026-10-13):** extracted `nawiri-checkpoint-11.zip` into an empty directory (no `node_modules/`, `dist/`, `test-results/` or `playwright-report/` inside; its file list differs from the checkpoint-10 zip by exactly the ten new source and test files and the `tests/unit/fixtures/` directory, 319 entries against 308); `npm ci` added 724 packages in 16 s, 0 vulnerabilities; typecheck exit 0; 584 tests in 56 files passed; build precaches 38 entries (10475.37 KiB); `verify:static` passed; eslint 53 errors / 15 warnings, per-file counts identical to the checkpoint-10 clean-extract run; `npm run test:e2e` 42 passed in 3.3 minutes (port 4173 confirmed free first, by connecting to it). `diff -rq` between that extract and the working tree (excluding the four generated directories) reported no differences. The delivered zip was then rebuilt once more, only to add this paragraph to `futureplans.md`; no other file changed.

### 2026-10-14 — checkpoint 12: the privacy disclosures (self-hosted fonts, Define asks first, guarded Read more, Settings → Privacy)

**Starting point:** the checkpoint-11 end state (typecheck 0 errors; 584 tests in 56 files; 42 specs; build 38 entries, 10475.37 KiB; eslint 53 errors / 15 warnings). Taken from `docs/strategy.md`: privacy disclosures come before new features. Two things left the device without the interface saying so: the interface fonts (Google, on every visit) and Define (the selected word, to Wikimedia). The mutation results below were **re-run on 2026-10-14 against the final sources** (scripts kept outside the repo, restoring from a snapshot of the current files; `cmp` after each run).

**Item 1 — fonts.** `@fontsource-variable/{inter,inter-tight,jetbrains-mono,lora}` ^5.3.0 imported in `src/styles.css`; Google `<link>`s and preconnects removed from `index.html`; Google runtime-cache rules removed from `vite.config.ts`; `FONT_STACKS` in `src/lib/reader-settings.ts`, used by `display-tab.tsx`. Browser proof (`tests/e2e/privacy.spec.ts`, 2 specs): `context.on("request")` while opening the shelf, a book and Settings records nothing outside the app's origin (blob:, data: and about: aside); the four families are declared normal (Lora also italic), Inter, Inter Tight and JetBrains Mono report `loaded`, every `.woff2` response is same-origin. Measured while deciding the scope: a book's section iframe has its own empty `FontFaceSet` (0 faces against 34 in the page), so book text never used web fonts. Build: precache 38 → 71 entries (10475.37 → 11329.11 KiB); 33 `.woff2` files (835 KiB) in the precache. **Mutations (each alone, rebuilt, the spec re-run):** Google stylesheet link back in `index.html` → "reach no address but the app's own" fails with `https://fonts.googleapis.com/css2?...` in `outside`; Lora import dropped → "Lora Variable normal" fails; `--font-sans` no longer naming "Inter Variable" → "Inter Variable loaded" fails. **One survived in an earlier round:** dropping only Lora's upright import changed nothing, because the italic import's CSS declares the same family; the spec now checks `style` (normal and italic separately). `npm run verify:static` gained three checks (`index.html`, built stylesheets and `sw.js` name no other host). Mutations, on the built files: a Google `<link>` in `dist/index.html` fails the first; an `@import url("https://…")` at the top of the built CSS fails the second. **The third survived at first:** a Google runtime-cache rule put back in `vite.config.ts` was not noticed, because the minifier keeps the address as an escaped regular expression (`https:\/\/fonts\.googleapis\.com`) and my scan looked for the plain `https://`. Found by running that mutation, not by reading; the scan now drops backslashes first, and the same mutation fails it (`FAIL the service worker names no other host: https://fonts.googleapis.com/.*/i,new`). A bare hostname test in the worker (no scheme) is still not seen.

**Item 2 — Define asks first.** `src/lib/lookup-consent.ts` (key `nawiri-lookup-consent` = `"1"`; storage that cannot be read or written reads as "not allowed"), `definition-card.tsx` (the card starts in an "ask" state with no request; _Look it up_ stores the answer and starts the lookup; _Cancel_ stores nothing), `lookup.ts` (`isLookupUrl`), `safe-report.ts`/`safe-reading.tsx` (`by: "book" | "app"`, "Nawiri wants to open a page on …"), `settings.tsx` (`PrivacySection`). Unit tests: `lookup-consent.test.ts` 6, `definition-card.test.ts` 9 (jsdom, real React; `renderToString` shows only a first render because effects do not run, so the "very first frame" test uses it on purpose), `lookup.test.ts` and `safe-reading.test.ts` extended. **Unit mutations (22, all re-run on the final sources, all caught):** lookup starts whether or not it is allowed; card starts out allowed; initial state ignores consent; answer not remembered; _Look it up_ does not allow; _Cancel_ does not close; click on _Read more_ not held back; middle click not held back; link not checked before it is shown; link claimed to come from the book; any stored value counts as consent; unreadable storage reads as allowed; withdrawal does nothing; `http:` accepted; credentials accepted; port accepted; host not anchored at the end; bare `wikipedia.org` accepted; host not anchored at the start; the Wikipedia summary keeps any link; the dialog says "This book" for the app's own link; `by` always "book". Two mutants survived the first version of the card tests (my notes record the count, not which two); the 22 above all fail now. Two slips of mine from that round, both fixed: the notice text first named only the hostnames, not "Wikipedia"; and a first-render assertion was too broad (it failed on the unmutated card, so two "caught" lines from that round were not valid evidence; it now looks for `/>Looking up</` and the mutants were re-checked against a green baseline).

**Item 3 — browser spec, `tests/e2e/define.spec.ts` (6).** Wikimedia is stubbed with `context.route` (the sandbox cannot reach it; the stub answers with `access-control-allow-origin: *` because the preview origin is `http://127.0.0.1:4173`, and the requests are counted). Word chosen by a double click at the word's measured position in the first paragraph of `makeMarkEpub()`. Specs: nothing is requested until _Look it up_ (waited 1 s), then exactly `https://en.wiktionary.org/api/rest_v1/page/definition/reader` and a `Referer` of the app origin at most; after a reload the next word goes straight out with no notice; _Cancel_ stores nothing and the next Define asks again; Settings shows "Define sends words without asking." and _Ask before looking up words_ makes the next Define ask again with no further request; a reader who never agreed sees "Define asks before it sends a word." and no button; _Read more_ asks for a left and a middle click ("Nawiri wants to open a page on en.wiktionary.org."), _Stay here_ requests nothing, _Open link_ opens one tab (`window.opener === null`, exactly one request to the page). **It passed on its first run, which proves nothing, so it was then broken ten ways (each rebuilt, the spec re-run; all 10 caught, each for the intended reason):** (1) effect ignores consent → the ask card never appears (4 of 6 fail); (2) the yes is not stored → `localStorage` is `null` where `"1"` is expected, and the next word after a reload asks again; (3) _Read more_ unguarded → no dialog; (4) _Settings_ withdrawal does nothing → "Define asks before it sends a word." never appears; (5) _Cancel_ stores the yes → `localStorage` is `"1"` where `null` is expected; (6) middle click not guarded → no dialog; (7) Settings starts from "asks" whatever is stored → "Define sends words without asking." never appears; (8) the notice without the hostname → `toContainText` fails; (9) a request made silently while the card is only asking → "nothing requested before the answer" fails (received 1 request), and the Settings spec sees a second request after the answer was taken back; (10) an extra query string on the request → the exact-URL assertions fail.

**Measured at the end (working tree):** typecheck exit 0; 604 tests in 58 files (584 + 20); build precaches 71 entries (11329.11 KiB); `verify:static` passes; eslint 53 errors / 15 warnings with per-file counts identical to the baseline; `npm run test:e2e` 50 passed in 3.8 minutes (42 + 2 privacy + 6 define; port 4173 confirmed free first); Prettier clean on every edited file except this log, which is not Prettier-clean and was only appended to.

**Not verified:** anything on iOS/WebKit or a real phone; the real Wikimedia replies (only the two shapes `lookup.ts` parses were stubbed; whether the live service still answers as `lookup.ts` expects was not checked); an offline start with the bundled fonts; the card's readability in every reader theme with the longer notice; Referer behaviour under another browser's default policy; "Nothing else from this book is sent" is reasoned from the code (word in the URL path, `accept` header, no body, no `credentials`), and a request log of a real device was not taken.

**Clean-extract check of the zip (2026-10-14):** extracted `nawiri-checkpoint-12.zip` into an empty directory (no `node_modules/`, `dist/`, `test-results/` or `playwright-report/` inside; its file list differs from the checkpoint-11 zip by exactly the five new files `src/lib/lookup-consent.ts`, `tests/e2e/define.spec.ts`, `tests/e2e/privacy.spec.ts`, `tests/unit/definition-card.test.ts` and `tests/unit/lookup-consent.test.ts`, 324 entries against 319); `npm ci` succeeded with 0 vulnerabilities; typecheck exit 0; 604 tests in 58 files passed; build precached 71 entries (11329.11 KiB); `verify:static` passed; `npm run test:e2e` from that extract passed 50 of 50 in 3.8 minutes (port 4173 confirmed free first, by connecting to it); eslint 53 errors / 15 warnings, per-file counts identical to the baseline. `diff -rq` between that extract and the working tree (excluding the four generated directories) reported no differences. The delivered zip was then rebuilt once more, only to add this paragraph to `futureplans.md`; no other file changed.

### 2026-10-15 — checkpoint 13: licence and asset clearance (audit, notices, guards); no licence chosen

**Starting point:** the checkpoint-12 end state (typecheck 0 errors; 604 tests in 58 files; 50 specs; build 71 entries, 11329.11 KiB; eslint 53 errors / 15 warnings). Taken from `docs/strategy.md` (licence/asset clearance precedes accessibility). Choosing Nawiri's licence is the owner's; the work was to establish from the files themselves what is shipped and under what terms, to ship the notices the licences ask for, and to guard the record against drift. All facts below were read from files or fetched on 2026-10-14; legal conclusions were not drawn.

**Vendored files.** By SHA-256 against `node_modules` (all `find`-and-hash, one pass): `libarchive/worker-bundle.js` = `libarchive.js@2.0.2` `dist/worker-bundle.js`; `libarchive/libarchive.wasm` = its `src/webworker/wasm-gen/libarchive.wasm`; `tesseract/worker.min.js` = `tesseract.js@6.0.1` `dist/worker.min.js`; both `tesseract-core*.wasm.js` = `tesseract.js-core@6.0.0`. `eng.traineddata` matched nothing in `node_modules`; fetched `raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata` through the sandbox proxy: 4,113,088 bytes, same SHA-256 (`7d4322bd…`); that repository's LICENSE is the Apache License 2.0. `djvu/djvu.js` matched nothing: it is DjVu.js 0.5.4 (`VERSION: '0.5.4'`), with no header of its own; the only licence lines in it are two `@license MIT` for embedded `buffer` and `is-buffer`.

**DjVu.js licence.** `npm view djvujs-dist` shows version 0.5.4 and no licence field; `npm pack djvujs-dist@0.5.4` and its `LICENSE.md` say the library (`library/src`) "is subject to, and may be distributed under, the GNU General Public License, Version 2", the rest of the repository is under The Unlicense, and the choice of GPL v2 is "conditioned by the fact DjVu.js contains some code fragments copied from DjVuLibre or Java DjVu"; it lists those copyright notices. No linking exception, no "or later" in that file, no per-file headers in `library/src`. **Two web fetches of the upstream pages disagreed with each other and with the file** (one said "or any later version"); I went by the file in the tarball. The built `djvu.js` is not in the tarball, so the vendored copy could not be compared byte for byte. Apache Software Foundation's page (fetched 2026-10-14) states the FSF "has never considered the Apache License to be compatible with GPL version 2" and that Apache 2 software "can therefore be included in GPLv3 projects". The GNU licence-list page could not be fetched (an error), so I did not cite it.

**libarchive.wasm.** `strings`: `libarchive 3.7.2`, `software: libarchive/3.7.2`, messages from bzip2, xz (liblzma), zlib, BLAKE2, and OpenSSL libcrypto (source names `evp_enc.c`, `a_bitstr.c`, `asn1_lib.c`, `mem_dbg.c`, `tasn_dec.c` and others; "OpenSSL internal error, assertion failed"). No OpenSSL version string was found. The `libarchive.js` package has no notices for them. Attempts to find the build recipe: the GitHub page (robots-disallowed for the fetch tool), the GitHub API (not enabled for this session) and five guessed raw paths (all 404). Left **incomplete**, and the notices say so.

**npm.** The lockfile's non-dev set is 286 packages (build tools such as `lightningcss`, `@tailwindcss/oxide-*` are in `dependencies`). A scratch build with `--sourcemap` into a temporary directory (outside the repo) lists the packages that contribute a module to the shipped JavaScript: 56 (48 MIT, 4 Apache-2.0, 2 ISC, 1 MIT-AND-Zlib, 1 0BSD; no copyleft). `foliate-js`'s README names vendored `zip.js` (BSD-3-Clause), `fflate` (MIT) and PDF.js (Apache); the installed copy's `vendor/` holds only `zip.js` and `fflate.js`, and both of those are in the bundle. Three of the 56 needed a closer look: `pako` (MIT AND Zlib: licence file is MIT), `lucide-react` (ISC, with Feather's MIT portions named), `react-remove-scroll-bar` (no licence file; declares MIT). The `@fontsource-variable/*` licence files are OFL-1.1; Lora's names a Reserved Font Name.

**Samples and artwork.** The three covers are 848×1264 PNG data in files named `.jpg`; their XMP/IPTC says `photoshop:Credit="<the tool's credit>"`, `a machine-generated-media source type`. The sample EPUBs declare `cover.jpg` as `image/jpeg` and embed the same bytes (hash-compared). The sample text is typed into `scripts/make-samples.mjs`; no edition is recorded.

**Built.** `scripts/make-notices.mjs` + `npm run notices` → `public/THIRD_PARTY_NOTICES.txt` (84 KB, 6 parts; the three licence texts not in `node_modules` are in `scripts/notices/`), a "Read the notices" link in Settings (`NoticesSection`), a `verify:static` check that the file is in `dist`. **Mutations, each alone:** unit (`tests/unit/notices.test.ts`, 6 tests): vendored file changed by one byte; new vendored file with no entry; entry whose file is gone; a listed package's version moved in the lockfile; stated package count wrong; a cover changed; GPL text cut short; the "INCOMPLETE" warning dropped; DjVu.js described as MIT — all 9 caught, each by the intended test. (The cover mutation first "survived": my harness wrote the byte after the test had run, because the `run()` call sat inside the `with open(...)` block; re-run correctly it fails "pins the cover images by hash". The next mutation then failed an unrelated assertion because of the leftover byte, which is how the harness error showed.) `verify:static`: notices removed from `dist` → `FAIL THIRD_PARTY_NOTICES.txt is part of the built site`. E2E (`tests/e2e/notices.spec.ts`, 1 spec): link made `hidden` → `getAttribute` times out; wrong file name → `Expected …/THIRD_PARTY_NOTICES.txt, Received …/THIRD_PARTY_NOTICE.txt`; `target="_blank"` removed → no new tab; file not shipped → the SPA fallback page is served and the text check fails. Not caught, and left: removing `rel="noopener"` (the browser opens `_blank` links with no opener anyway, so the `window.opener === null` assertion cannot see it).

**Measured at the end (working tree):** typecheck exit 0; 610 tests in 59 files (604 + 6); build precaches 71 entries (11329.81 KiB); `verify:static` passes (one new check); eslint 53 errors / 15 warnings with per-file counts identical to the baseline; `npm run test:e2e` 51 passed in 3.8 minutes (50 + 1; port 4173 confirmed free first); Prettier clean on every edited file except this log (append-only, not Prettier-clean).

**Not verified:** any legal conclusion (none was drawn); what is compiled into `libarchive.wasm` beyond the strings above and into the Tesseract core; that `djvu.js` matches an upstream build; the sample text against an edition; whether the covers made by an outside tool and the logo concept may be redistributed; the rights of the bundled `eng.traineddata` beyond that repository's LICENSE file; the notices on a phone or in Safari.

**Clean-extract check of the zip (2026-10-15):** extracted `nawiri-checkpoint-13.zip` into an empty directory (no `node_modules/`, `dist/`, `test-results/` or `playwright-report/` inside; its file list differs from the checkpoint-12 zip by exactly the seven new entries `public/THIRD_PARTY_NOTICES.txt`, `scripts/make-notices.mjs`, `scripts/notices/` with its three files, `tests/e2e/notices.spec.ts` and `tests/unit/notices.test.ts`, 332 entries against 324); `npm ci` succeeded with 0 vulnerabilities; typecheck exit 0; 610 tests in 59 files passed; build precached 71 entries (11329.81 KiB); `verify:static` passed and `dist/THIRD_PARTY_NOTICES.txt` is there; `npm run notices` run in that extract rewrote `public/THIRD_PARTY_NOTICES.txt` byte for byte as shipped (same 56 packages, same hashes); `npm run test:e2e` from that extract passed 51 of 51 in 3.8 minutes (port 4173 confirmed free first, by connecting to it); eslint 53 errors / 15 warnings, per-file counts identical to the baseline. `diff -rq` between that extract and the working tree (excluding the four generated directories) reported no differences. The delivered zip was then rebuilt once more, only to add this paragraph to `futureplans.md`; no other file changed.

### 2026-10-16 — checkpoint 14: DjVu.js removed, MIT OR Apache-2.0 chosen by the owner, OpenSSL fallback and asset record; two further licence findings

**Starting point:** the checkpoint-13 end state (610 tests in 59 files; 51 specs; build 71 entries, 11329.81 KiB; eslint 53 errors / 15 warnings). **Owner's decisions, in order (2026-10-15):** (1) make DjVu an optional add-on in a separate GPL-v2 repository (I only began reading code for it; nothing was built); (2) OpenSSL fallback notice and the asset authorization; (3) a message asking whether "dual-license MIT OR Apache-2.0 and keep DjVu.js bundled" was better, and for an approach with no extra download and no takedown or lawsuit worry; I answered before changing code (the dual licence does not touch the third-party Apache-2.0 parts; GPL v2 §2(b) and §6 and the ASF page's "has never considered the Apache License to be compatible with GPL version 2"), found a decoder under MIT, and the owner approved: remove DjVu.js now, MIT OR Apache-2.0 with "Copyright (c) 2026 Nawiri Contributors", vendor `djvu-rs` next checkpoint after pinning and the author's provenance statement, lost bookmarks accepted.

**OpenSSL texts.** `raw.githubusercontent.com/openssl/openssl/<tag>/…` through the sandbox proxy: `OpenSSL_1_1_1w` `LICENSE` (6,121 bytes, SHA-256 `c32913b3…`, the OpenSSL License and the original SSLeay License); `openssl-3.0.15` and `openssl-3.3.2` `LICENSE.txt` (both 10,175 bytes, `cmp` identical; SHA-256 of the copy kept `7d5450cb…`; Apache-2.0). Names found in `libarchive.wasm` by a printable-strings pass (27 OpenSSL source names: `a_bitstr.c a_int.c a_object.c asn1_lib.c buffer.c cryptlib.c e_aes.c eng_init.c eng_lib.c eng_table.c err.c evp_enc.c evp_lib.c ex_data.c hmac.c lhash.c mem_dbg.c obj_dat.c pmeth_lib.c rsa_sign.c stack.c tasn_dec.c tasn_enc.c tasn_new.c tasn_utl.c tb_cipher.c tb_digest.c`) were each requested in both tags (`crypto/<dir>/<name>`): `crypto/mem_dbg.c` is HTTP 200 in 1.1.1w and 404 in 3.0.15; the other 26 are 200 in both. That leans toward the 1.1.x line and proves nothing about the version. Written into PART 7 of the notices as a notice, with that observation.

**`djvu-rs` spike (scratch directory only).** `npm pack djvu-rs@0.42.0` (487,787 bytes; `scalar/` and `simd128/` wasm of 572,658 and 582,245 bytes; licence MIT, "Copyright (c) 2026 Lev Matyushkin"). README says "written from the public DjVu v3 specification… no code derived from GPL-licensed DjVuLibre"; `CONTRIBUTING.md` says "Do not copy code from djvulibre or any GPL-licensed source"; `CHANGELOG.md` has "import cos-djvu history, remove GPL legacy code" and "transfer from cos-djvu, remove legacy GPL code, add PD corpus, benchmarks" and "New document model… built on clean-room codecs"; first release 0.1.0 2026-04-04. The GitHub API answered 403 for this session ("not enabled"), so the history could not be read; `raw.githubusercontent.com` worked. Test files (from its repository, provenance not recorded; **not** added to Nawiri): `tests/fixtures/colorbook.djvu` (2,925,013 bytes) and `tests/corpus/cable_1973_100133.djvu` (15,486 bytes). Node 22: `WasmDocument.from_bytes`, `page(0)`, `dpi()`, `width_at/height_at`, `render(dpi)`, `text()`: cable.djvu 2 pages, 300 dpi, 2550×3301, RGBA length 33,670,200 = w×h×4, text begins "Declassified/Released US Department of State"; colorbook.djvu 62 pages, 400 dpi, 2260×3669, RGBA 33,167,760, text "ECLECTIC EDUCATIONAL SERIES…" (the text has control characters in it). DjVu.js 0.5.4 (the vendored copy, scratch only, run in Node with `self`, a dummy `document` and an `ImageData` shim; `await doc.getPage(1)` then `getImageData()`): same dimensions. Pixels, sampled every 13th: cable 647,504 pixels, identical RGB in all, mean abs difference 0; ink pixels (mean < 128, every 7th) 5,910 vs 5,910, 5,910 in both; colorbook 637,842 pixels, 93.55% identical RGB, mean abs difference 0.258 per channel, max 66, 0.09% of channel values off by more than 32; ink 64,735 vs 64,509, 63,831 in both. The wasm API has no bookmark or outline method (`d.ts` read in full). Strings in the wasm name `zune-jpeg-0.5.15`, `tokio-1.53.2`, `js-sys-0.3.106`, `zune-core-0.5.3`, `once_cell-1.21.4` and one line "DjVuLibre rejects version >= 50" (a comment about behaviour, not evidence of copying). **Seen in Node only, two files.**

**What was removed.** `public/vendor/djvu/`, `src/components/reader/djvu-reader.tsx`, the loader/`DjvuClient`/`flattenOutline` part of `src/lib/djvu.ts`, `ENGINES.djvu` in `reader-shell.tsx`, `"djvu"` in `FORMAT_STRIP_ORDER`, `scripts/notices/GNU_GPL_v2.txt` and `djvujs-LICENSE.txt`; `tests/unit/djvu-outline.test.ts` became `djvu-helpers.test.ts` without the outline tests; `asset-url.test.ts` uses another vendored path as its example. Precache 71 → 70 entries, 11329.81 → 10779.92 KiB. The earlier sections of this file that describe DjVu.js as shipped (the engine table, "Phase 9") are history and are superseded by this entry.

**Licence files.** `LICENSE-MIT`: `scripts/notices/shadcn-ui-LICENSE.txt` (shadcn's `LICENSE.md`, fetched; starts "MIT License / Copyright (c) 2023 shadcn") with the copyright line replaced. `LICENSE-APACHE`: `node_modules/tesseract.js/LICENSE.md` (11,357 bytes, no CR; `diff` against the OpenSSL 3.x copy after trimming trailing blanks: only the URL scheme on line 3 and the appendix differ); `https://www.apache.org/licenses/LICENSE-2.0.txt` was refused by the proxy, so it was not compared with apache.org. `package.json` `"license": "MIT OR Apache-2.0"`.

**Two things found that nobody asked about.** (1) `components.json` (style "new-york") and 46 files in `src/components/ui/` with no header: shadcn/ui; now PART 5 of the notices with the upstream text. (2) `src/lib/chm/lzx.ts` line 5: "This is a direct TypeScript port of the canonical cabextract/CHMLib `lzx.c` decoder". CHMLib `src/lzx.c` (raw.githubusercontent.com/jedwing/CHMLib/master, 32,598 bytes) header: "source: modified lzx.c from cabextract v0.5… This program is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation; either version 2 of the License, or (at your option) any later version. Note that an exemption to this license has been granted by Stuart Caie for the purposes of distribution with chmlib. This does not, to the best of my knowledge, constitute a change in the license of this (the LZX) code in general." Shared macro names, count of occurrences in the TypeScript / the C: `LENTABLE_SAFETY` 2/4, `PRETREE_TABLEBITS` 3/1, `MAINTREE_MAXSYMBOLS` 3/3, `ALIGNED_TABLEBITS` 3/1, `NUM_SECONDARY_LENGTHS` 3/3. `chm_lib.c` header: GNU Lesser General Public License, "version 2.1 of the License, or (at your option) any later version" (COPYING is the LGPL 2.1 text). `itsf.ts` says "exactly as CHMLib does"; whether it was derived was not determined. No test touches `LzxDecoder` or the ITSF reader (the CHM tests import only `@/lib/chm`, the path/TOC/index helpers). A candidate permissive replacement: `Lonami/lzxd` (`Cargo.toml` `license = "MIT OR Apache-2.0"`, version 0.2.6; README: "based in the description and code of the document itself", validated against xnbcli and dorkbox's CabParser; the GitHub repository says it moved to codeberg.org/Lonami/lzxd and may be deleted). Not started.

**Notices.** `scripts/make-notices.mjs`: the DjVu.js entry and PART 5 (GPL) are gone; PART 5 is now the source in the repository that is not Nawiri's own (shadcn/ui with its licence text and file count; the CHM files with CHMLib's header quoted); PART 6 records the owner's authorization as the owner's statement; PART 7 is the OpenSSL fallback; the generated file is 85,903 bytes. `tests/unit/notices.test.ts`: 10 tests (the three replacing the GPL test: the non-own source and no claim for it; the licence files and the `license` field; no DjVu.js or GPL title; plus the OpenSSL texts verbatim and pinned by hash, and the owner-decision record). `verify:static`: a "copyleft" section; the scan over built text files (`.js .css .html .json .txt .webmanifest .svg .map`, the notices file excluded) for "general public licen[sc]e", "mozilla public licen[sc]e" or "DjVu.js"; before adding it a scan with the bare acronyms (`GPL`, `MPL`, `LGPL`) found one false positive, base64 in `tesseract-core-lstm.wasm.js`, which is why the phrases are used instead.

**Breakages, each alone, all caught.** Unit (`tests/unit/notices.test.ts`): `LICENSE-MIT` naming someone else (fails the licence-files test); `license` removed from `package.json` (same test); the shadcn licence text changed at its source (fails the non-own-source test); "NOT covered by the MIT OR Apache-2.0 statement" weakened in the generator with the notices regenerated (same test); DjVu.js put back in `public/vendor` (fails "describes every file under public/vendor" and "no longer carries DjVu.js"); "OWNER'S DECISION, 2026-10-15" renamed in the notices (fails the owner-decision test); the generator dropping the OpenSSL 3.x text, regenerated (fails the OpenSSL test). Build (`verify:static` after `npm run build`): the DjVu.js bundle put back in `public/vendor` → `FAIL no shipped file names a copyleft licence: sw.js, vendor/djvu/djvu.js` and `FAIL the DjVu.js bundle is not in the site` (the worker lists it in its precache, so `sw.js` names it too); a file in `public/` naming the GPL in words → `FAIL … gpl-test.txt`. Browser (`tests/e2e/djvu-kept.spec.ts`, 2 specs): DJVU back in `FORMAT_STRIP_ORDER` → `toHaveCount(0)` received 1; `djvu: TextReader` in `ENGINES` → the "isn't rendered" heading not found; a `fetch("./vendor/djvu/djvu.js")` in the reader → "nothing asked the site for a DjVu bundle"; `a.download = "download.bin"` → expected `old-scan.djvu`. Every mutated file was compared with its snapshot afterwards (`cmp`), and no stray file was left in `public/`. (The harness's first `pkill -f "vite preview"` killed its own shell, because the command line contained that text; port 4173 was confirmed free by connecting to it instead.)

**One slip, caught by the linter.** My rewrite of `src/lib/djvu.ts` turned the two regex escapes `\u00ad` and `\u00a0` into the literal characters; eslint reported `no-irregular-whitespace` (54 errors against the 53 baseline), and a byte dump showed the soft hyphen as well. Both put back as escapes; eslint is 53 errors / 15 warnings, identical per file to the baseline; the helper tests pass.

**Measured at the end (working tree):** typecheck exit 0; 611 tests in 59 files; build precaches 70 entries (10779.92 KiB); `verify:static` passes (two new checks); `npm run test:e2e` 53 passed in 4.1 minutes (port 4173 confirmed free first); eslint 53 errors / 15 warnings, per-file counts identical to the baseline; Prettier clean on every edited file.

**Not verified:** any legal conclusion (none was drawn); `LICENSE-APACHE` against apache.org; `djvu-rs`: its provenance, any browser run, more than two files, its Rust dependencies' licences, its patents position; whether the shadcn files differ from upstream; whether `itsf.ts` derives from CHMLib; CHM decoding against any real file; the outside tool's terms; the rights in code written with an outside tool; the OpenSSL version; everything on WebKit and a phone.

**Clean-extract check of the zip (2026-10-16):** extracted `nawiri-checkpoint-14.zip` into an empty directory (entries at the archive root as in earlier zips; no `node_modules/`, `dist/`, `test-results/` or `playwright-report/` inside; its file list differs from the checkpoint-13 zip by exactly: added `LICENSE-APACHE`, `LICENSE-MIT`, `scripts/notices/OpenSSL-1.1.1w-LICENSE.txt`, `OpenSSL-3.x-Apache-2.0.txt`, `shadcn-ui-LICENSE.txt`, `tests/e2e/djvu-kept.spec.ts`, `tests/unit/djvu-helpers.test.ts`; removed `public/vendor/djvu/djvu.js`, `scripts/notices/GNU_GPL_v2.txt`, `djvujs-LICENSE.txt`, `src/components/reader/djvu-reader.tsx`, `tests/unit/djvu-outline.test.ts`; 333 entries against 332); `npm ci` succeeded with 0 vulnerabilities; typecheck exit 0; 611 tests in 59 files passed; build precached 70 entries (10779.92 KiB); `verify:static` passed; `npm run notices` in that extract rewrote `public/THIRD_PARTY_NOTICES.txt` byte for byte as shipped (56 packages); `npm run test:e2e` from that extract passed 53 of 53 in 4.1 minutes (port 4173 confirmed free first, by connecting to it); eslint 53 errors / 15 warnings, per-file counts identical to the baseline. `diff -rq` between that extract and the working tree (excluding the four generated directories) reported no differences. The delivered zip was then rebuilt once more, only to add this paragraph to `futureplans.md`; no other file changed.

### 2026-10-17 — checkpoint 15: CHM removed, the accessibility pass, a phone spec and a WebKit config (desktop Chromium only)

**Asked (owner, 2026-10-16):** remove CHM support completely; endorse the shadcn/ui, OpenSSL and asset notices as they stand; accessibility pass (accessible names, screen-reader tracking, semantic elements); a way to run the specs in WebKit. **Added by the owner on 2026-10-17:** the author of `djvu-rs` answered the owner's inquiry (the owner's screenshot of the reply was seen); `djvu-rs` 0.43.0 and its notices are to be added (that is checkpoint 16, not done here); DRM-free `.m4b` audiobooks go on the post-launch list (no code, no library named). The owner's wording "100% clean of copyleft" and "Apache-2.0 compliance" is not what was tested; what was: `verify:static` finds no shipped text file other than the notices naming a copyleft licence in words, DjVu.js and the CHM decoder are gone from the tree, and the project licence is MIT OR Apache-2.0. No legal conclusion is drawn.

**CHM.** Removed `src/lib/chm/`, `src/lib/chm.ts`, `src/components/reader/chm-reader.tsx`, its unit tests and every branch that named it; notices regenerated (56 packages). A `.chm` file is recognised and kept like a `.djvu` file. Guards: a unit test that scans `src/` for `cabextract`, `CHMLib`, `chm_lib` and `lzx.c` and for the three removed paths; `tests/e2e/kept-not-opened.spec.ts` (3 specs). The six breakages (the decoder file and `chm.ts` put back, the old library name in another file, `chm` in `SAFE_MODE_KINDS`, `chm` back in the strip, `chm` mapped to the text engine) were run again on 2026-10-17 for this record because the first run's output was not kept: 6 of 6 caught, each file restored byte for byte. No `.chm` file was ever available, so no CHM reader was ever run, before or after.

**Accessibility.** Method: `tests/e2e/a11y.ts` reads Chromium's accessibility tree (`Accessibility.getFullAXTree`) and the DOM, and reports by rule (missing name; label not in name, WCAG 2.5.3; the same name twice in one group; landmarks; duplicate ids; dangling references; invalid ARIA; focusable inside `aria-hidden`; positive `tabindex`; untitled frames; heading structure). `tests/e2e/a11y.spec.ts` (20 specs) audits the shelf (empty, with books, tags, a new-collection field), Settings, the 404 page, and the EPUB (every drawer tab), PDF, comic, HTML and Markdown readers, the safe-reading panel and dialogs, and asserts what the interface promises by role and name. `tests/unit/reader-a11y.test.ts` adds 20 tests. The fixes are listed in `HANDOVER.md`, checkpoint 15, item 3. **What the browser found that the code reading did not:** the highlight overlay still exposed as an unnamed image (foliate announces the overlay before it hands it over); **my own tag-editor change reopened the field after Enter** (the Enter keydown moved focus to a button, and the same Enter pressed it); two audit rules that were too blunt; a PDF's drawer tabs arriving after the spec read the list. Not fixed and reported: the collections-by-keyboard gap (WCAG 2.5.7), the selection popover, the `aside` inside `main`, no current-section marker in Contents, colour-only toggles, contrast.

**Phone and WebKit.** `tests/e2e/phone.spec.ts` (7 specs; 390×664, touch, `isMobile`, 3× scale, in Chromium): no sideways scroll on the shelf and Settings at 390 and 320 px, collections folded, reader buttons at least 40×40, a tap turns the page, the drawer is a bottom sheet (flush left and bottom, full width, at most 72% high) and gives focus back, a tap turns a comic page. **It found a real defect: the "Added 1 book" toast sat on the reader's Next page button** and a touch pauses a toast; toasts are now offset 64 px from the bottom on `/read/…` (`src/routes/__root.tsx`). `playwright.webkit.config.ts` and `npm run test:e2e:webkit`: a `webkit` project (Desktop Safari, 81 tests listed) and an `iphone` project (iPhone 15, `phone.spec.ts`, 7 listed); 88 tests listed in all (an earlier note of 86 was stale, found by listing again when writing this). **Never run: the sandbox has no WebKit build and `playwright install` is blocked.** The Chromium path moved into the `chromium` project of `playwright.config.ts` so another engine does not inherit it.

**Breakages (each alone, restored with `cmp`).** Unit level 21 of 21 caught. Browser level, 14 reverts of a fix: 13 caught; the 14th (removing the shelf search's `aria-label`) changes nothing, because its placeholder gives the input the same name; with the placeholder removed too it is caught. Planted defects: 13 of 13 reported under the right audit rule. Phone: 7 of 7 caught, each by its own spec. The first phone run showed unrelated specs failing beside the intended ones, which exposed a tap helper that aimed at coordinates without scrolling or checking what was on top; fixed, then run again.

**Measured at the end (working tree):** typecheck exit 0; 615 tests in 58 files; `npm run notices` rewrote the file with only its date line different (56 packages, 84,409 characters); build precaches 70 entries (10763.58 KiB); `verify:static` passes; `npm run test:e2e` 81 passed in 5.0 minutes (port 4173 free first); eslint 53 errors / 15 warnings, per-file counts identical to the baseline (the new files add none); Prettier clean on every edited file.

**Checked in scratch for checkpoint 16 (nothing shipped).** The `djvu-rs` 0.43.0 tarball exists on npm (MIT, published 2026-10-16 12:42 UTC) and contains a `THIRD_PARTY_NOTICES` listing 38 crates; neither `.wasm` contains the words GPL, LGPL or "GNU General" (one error string says "DjVuLibre rejects version >= 50"); every crate whose source path appears in either `.wasm` is on that list; the repository's `deny.toml` allow-list is broader than the owner's summary (it has ISC, BSD-2, BSD-3, CC0, IJG, LLVM-exception and Unicode-DFS-2016, and **no 0BSD**) and covers the workspace; `SOURCES.md` says no code came from a GPL source and that the decoder follows the public specification; nine of the 38 notice entries (seven `djvu-*` crates, `async-stream`, `wide`) carry licence text with `<year> <copyright holders>` unfilled; the repository also holds DjVu.js's test files (not its library code) under the Unlicense per its own `ATTRIBUTION.md`, and corpus files whose sources `tests/corpus/README.md` lists. **Not audited:** the git history, and anything the author did not say. The author's reply is a statement by the author, seen by the owner and shown to me as a screenshot; it is not an audit and not legal advice.

**Not verified:** any real screen reader or voice control; contrast; WebKit, Safari, an iPhone, a real touch screen; `a11y.spec.ts` outside Chromium; CHM in any form; any legal conclusion; `libarchive.wasm`'s OpenSSL version; the outside tool's terms; a trademark search for "Nawiri".

**Clean-extract check of the zip (2026-10-17):** extracted the candidate `nawiri-checkpoint-15.zip` into an empty directory (300 file entries, at the archive root as in earlier zips; no `node_modules/`, `dist/`, `test-results/` or `playwright-report/` inside; its file list differs from the checkpoint-14 zip (also 300 entries) by exactly: added `playwright.webkit.config.ts`, `src/hooks/use-settled-value.ts`, `tests/e2e/a11y.spec.ts`, `tests/e2e/a11y.ts`, `tests/e2e/kept-not-opened.spec.ts`, `tests/e2e/phone.spec.ts`, `tests/unit/reader-a11y.test.ts`; removed `src/components/reader/chm-reader.tsx`, `src/lib/chm.ts`, `src/lib/chm/itsf.ts`, `src/lib/chm/lzx.ts`, `tests/e2e/djvu-kept.spec.ts`, `tests/unit/chm-index.test.ts`, `tests/unit/chm-toc.test.ts`); `npm ci` added 728 packages with 0 vulnerabilities; typecheck exit 0; 615 tests in 58 files passed; build precached 70 entries (10763.58 KiB); `verify:static` passed; `npm run notices` in that extract rewrote `public/THIRD_PARTY_NOTICES.txt` byte for byte as shipped (56 packages, 84,409 characters); `npm run test:e2e` from that extract passed 81 of 81 in 4.8 minutes (port 4173 confirmed free first, by connecting to it); eslint 53 errors / 15 warnings in 15 files, per-file counts identical to the checkpoint-10 baseline. `diff -rq` between that extract and the working tree (excluding the four generated directories) reported no differences. **Not part of that run:** `npm run test:e2e:webkit` (no WebKit build here). The delivered zip was then rebuilt once more, only to add this paragraph to `futureplans.md`.

### 2026-10-18 — checkpoint 16: `djvu-rs` 0.43.0 and a DjVu reader (desktop Chromium only)

**Asked (owner, 2026-10-17):** add `djvu-rs` 0.43.0 through npm into the core bundle; append the package's compiled third-party notice to `public/THIRD_PARTY_NOTICES.txt` "as verified compliance documentation"; DjVu goes back into the shelf strip and the README only after it is seen working in a browser. Reported as done, not repeated: the notice is the package's own text, reproduced unchanged and labelled so, and Nawiri did not verify it, so the file does not call it verified; the author's reply (issue #949 on the project's tracker) is recorded as the owner's screenshot of it; no legal conclusion anywhere.

**Package.** `djvu-rs` 0.43.0 pinned exactly; lockfile integrity `sha512-ytzRFFeU…`, `license: MIT`. Two WebAssembly builds (scalar 573.02 kB, simd128 582.61 kB, 227.37 and 230.11 kB gzipped) are emitted by Vite from the package's own `new URL(...)`; the package's `init()` chooses. They are **not precached** (about 1.1 MB on every first visit); a Workbox runtime rule keeps the one in use when a DjVu file is first opened (`nawiri-djvu`, cache-first, 4 entries, 90 days, status 200). The built `sw.js` names the worker script in its precache list and no `.wasm`; the rule is in it. Precache 70 → 71 entries, 10763.58 → 10802.60 KiB.

**Reader.** `src/workers/djvu.worker.ts` (module worker; one request at a time; `createImageBitmap`, transferred), `src/lib/djvu.ts` (pure helpers `dpiForWidth`, `fitPage`, `renderWidth`, `renderWindow`, `normalizeDjvuText`, `hasTextLayer`, and `DjvuClient`), `src/components/reader/djvu-reader.tsx` (a paged engine inside the shell's contract: keys, taps on the outer thirds, chrome toggle in the middle, "Page position" slider, kept place, one or two pages, search on the text layer, hidden page text for a screen reader). Not offered: zoom, a table of contents (not in the package's API), thumbnails, highlights and notes, right-to-left. The OCR fallback is declared and was never run on a DjVu page.

**Notices.** PART 8 in `scripts/make-notices.mjs` reads `node_modules/djvu-rs/THIRD_PARTY_NOTICES` (38 crates) and reproduces it below a line of equals signs with its SHA-256, under four paragraphs (what it is; the author's statement as the owner's screenshot shows it; the placeholder `Copyright (c) <year> <copyright holders>` in one licence text shared by nine crates; what is not established). 57 packages, 115,966 characters. `tests/unit/notices.test.ts` 13 tests (2 new).

**Test files.** `tests/e2e/data/cable_1973_100133.djvu` (15,486 bytes, 2 pages) and `cyrillic_simonovich_co2.djvu` (171,563 bytes, 12 pages), from `tests/corpus/` of the `djvu-rs` repository at commit `124ba49`. Its README calls them public domain; the Internet Archive page for the cable has no rights field, the booklet's says "Public Domain Mark 1.0". Claims, not findings; `tests/e2e/data/README.md` lists what was and was not checked (the repository's README says the cable has one page; the file has two).

**What the browser showed that the unit tests had not.** (1) The booklet's text layer separates zones with control characters (0x0B, 0x1D–0x1F, a trailing NUL) that ran words together in search and in the spoken text; `normalizeDjvuText` turns them into breaks, with a unit test, and breaking that line is caught. (2) Six specs first failed because my spec asked for the slider by the wrong name ("Reading position"; a paged engine's is "Page position"): the spec was wrong, not the app. (3) The first lint run on the new files showed 11 errors and 3 warnings of my own (Prettier on two files; `no-control-regex` on the regex that deliberately matches those control characters, now disabled on that one line with the reason; `react-hooks/exhaustive-deps` on three refs read in a cleanup, now read into locals); fixed, then every check was run again.

**Breakages (each alone, restored with `filecmp`).** Unit, 8 of 8 caught on the final code: control characters not stripped; the pixel cap removed; a spread's second page ignored; the 64-pixel rounding removed; the notices saying "confirmed by the author"; the package's licence block altered; `djvu-rs` as a range; "did not verify" changed to "verified". Browser, 19, **18 caught**: the middle turning the page; no end at the last page; no text probe; page text not given to a screen reader; the drawn page unnamed; the saved place ignored; the decoder not cached; a failed open swallowed; a spread ignored; DjVu missing from the strip; no engine; a request to another address on opening; the pixel ratio ignored; the worker drawing at the page's own resolution; the page group unnamed; and four on the reopen-on-a-new-file path. The first fifteen ran before the lint fixes (which touched three lines of the cleanup, the formatting of two files and a comment; a dry run matched every pattern once except the reformatted line, which was run again). Two findings from them. (a) The pixel-ratio and own-resolution breakages were caught **only by `phone.spec.ts`**: at a desktop pixel ratio of 1 nothing else can see them. (b) Three breakages of the effect's cleanup (page shapes, page text, failed pages no longer forgotten) **survived all 14 specs**. `read.$id.tsx` keeps its "ready" state when the book in the address changes and hands the same reader a new `file`, so the cleanup is the only thing that empties the first book's data. A spec was added for it (`another book opened through the address…`: the booklet, then the cable through the hash; the cable's own text, none of the booklet's, a page box in the shape of the drawn page). It passes on the code and catches the shape table (0.085 against a limit of 0.02; the pages' shapes are 0.7725 and 0.6871), the text table and a reader that does not reopen. **The failed-pages table's clearing is still not covered** (no test file has a page that fails while the file opens); it survives.

**Measured at the end (working tree, final code):** typecheck exit 0; 628 tests in 58 files; `npm run notices` wrote the same bytes again (57 packages, 115,966 characters; across the change of day only its date line differed); build precaches 71 entries (10802.60 KiB); `verify:static` passes (71 URLs under a sub-path); `npm run test:e2e` 94 passed in 5.8 minutes (port 4173 free first); `playwright.webkit.config.ts` lists 102 tests (94 `webkit`, 8 `iphone`), still never run; eslint 53 errors / 15 warnings, per-file counts identical to the baseline; Prettier clean on every edited file.

**Not verified:** any legal conclusion; the author's statement (a screenshot, no address); the repository's history before the removal its CHANGELOG mentions; the lockfile's integrity against a second source; DjVu in WebKit, Safari, an iPhone or on a real touch screen; any browser but desktop Chromium; a colour (IW44) page; a large scan (the files are 15 KB and 171 KB; memory and speed were not measured); the OCR fallback; offline use on a phone; how a real screen reader speaks the page; the rights in the two test files.

**Clean-extract check of the zip (2026-10-18):** extracted the candidate `nawiri-checkpoint-16.zip` into an empty directory (306 file entries, at the archive root; no `node_modules/`, `dist/`, `test-results/` or `playwright-report/` inside; its file list differs from the checkpoint-15 zip (300 entries) by exactly six additions: `src/components/reader/djvu-reader.tsx`, `src/workers/djvu.worker.ts`, `tests/e2e/data/README.md`, `tests/e2e/data/cable_1973_100133.djvu`, `tests/e2e/data/cyrillic_simonovich_co2.djvu`, `tests/e2e/djvu.spec.ts`); `npm ci` added 729 packages (one more than checkpoint 15: `djvu-rs`) with 0 vulnerabilities; typecheck exit 0; 628 tests in 58 files passed; build precached 71 entries (10802.60 KiB); `verify:static` passed; `npm run notices` rewrote `public/THIRD_PARTY_NOTICES.txt` byte for byte as shipped (57 packages, 115,966 characters); `npm run test:e2e` 94 passed in 5.8 minutes (port 4173 free first); eslint 53 errors / 15 warnings in 15 files, per-file counts identical to the baseline; `diff -rq` of the extract against the working tree (excluding `node_modules`, `dist`, `test-results`, `playwright-report`) showed no difference. The delivered zip was rebuilt after this paragraph was appended and differs from the verified extract only in this file. Not run: anything on WebKit, Safari, an iPhone or a screen reader.

### 2026-10-18 — checkpoint 16 follow-up: the author's statement linked

**Asked (owner, 2026-10-18):** link the djvu-rs issue the statement came from, from the notices and the README. The owner opened issue #949 (the account `misterwolverine321-ui`, signed "Khaal" in the body) and the screenshot shows the author's reply, the commit `208d9b2` ("feat(npm): ship THIRD_PARTY_NOTICES…") and pull request #950 in the timeline. Pull request #953 in the same timeline is "feat(py): ship LICENSE and THIRD_PARTY_NOTICES in wheels and sdist" and is not a source for the npm notice; it is not linked as one.

**Done.** `scripts/make-notices.mjs` now gives the issue URL, the commit and pull request #950, and says that #953 is the Python packages. `public/THIRD_PARTY_NOTICES.txt` regenerated (57 packages, 116,298 characters). README's DjVu paragraph links issue #949. HANDOVER's decisions item updated.

**Checked.** `tests/unit/notices.test.ts` 13 of 13; `npm run build` 71 entries (10802.60 KiB, unchanged: the notices file is not precached); `npm run verify:static` passed; `tests/e2e/privacy.spec.ts` and `notices.spec.ts` 3 of 3 (no request added: the links are text, not fetched). Prettier clean on README and HANDOVER. **Not run:** the full e2e suite and the clean-extract zip; this change is text only, and the zip `nawiri-checkpoint-16.zip` was delivered before it.

**Clean-extract check after the link change (2026-10-18):** the zip was rebuilt and extracted into an empty directory (306 entries; no `node_modules/`, `dist/`, `test-results/` or `playwright-report/`). `npm ci` exit 0; typecheck exit 0; 628 tests in 58 files passed; build precached 71 entries (10802.60 KiB); `verify:static` passed; `npm run notices` rewrote `public/THIRD_PARTY_NOTICES.txt` identical to the shipped copy; eslint 53 errors / 15 warnings, per-file counts identical to the baseline; `npm run test:e2e` (run as `npx playwright test`) 94 passed in 5.7 minutes. The zip was rebuilt once more after this paragraph was appended; the only file that differs from the verified extract is `futureplans.md`.

### 2026-10-18 — checkpoint 17: DjVu colour page and a large scan (desktop Chromium only)

**Asked:** "continue". No new direction, so the next item of checkpoint 16's follow-ups was taken (item 0: a colour page and a large scan in a browser).

**Colour.** `tests/e2e/data/goody_twoshoes.djvu` added (1,060,487 bytes, 16 pages, 1888, colour IW44 illustrations). Its SHA-256 (`20b594d3…eb97`) matches the pin in `djvu-rs`'s `scripts/fetch_corpus.sh`, which names the archive.org source; the rights are the repository's claim, recorded as such in `tests/e2e/data/README.md`. In Node, page 1 decodes with 2,081,599 coloured pixels of about 7.8 million. The spec `a colour page is drawn in colour, not in grey` measured **108,072 coloured pixels** on the drawn canvas and asserts more than 50,000 and more than 5% of the page; the threshold was set after the measurement, from a failing run. Breakage **B20** (the worker converts its pixels to grey) makes the spec fail; the file was restored and compared with `filecmp`.

**Large scan, local only.** `big_scanned_page.djvu` (6780 × 9148 pixels, almost all colour) is in the `djvu-rs` corpus with an unknown source (a `djvu.js` test asset), so it is not in the repository. `djvu.spec.ts` has a large-scan test that runs only when `NAWIRI_LARGE_DJVU` names a local file (skipped otherwise). With the checkout's copy: first page drawn in **3,264 ms**, width under 3,200 pixels, ink on it. Node, rendering at its native 254 dpi: 2.3 to 5.6 s, which is why the reader draws it downscaled.

**Measured.** `npm run test:e2e`: **95 passed, 1 skipped** (the large scan) in 6.5 minutes. `djvu.spec.ts` 14 specs; WebKit project lists 96 (plus 8 for `iphone`). Typecheck, unit tests and the build are unchanged (no source file changed); eslint of the spec clean; Prettier clean on the spec, the fixtures README and the four documents.

**Not verified:** colour on another machine; the large scan in any browser but desktop Chromium, or on a phone; the large scan's rights; any colour page in WebKit or on touch; a book where every page carries a large colour photo.

**Still open from checkpoint 16's list:** zoom; the OCR fallback on a scan with no text layer; highlights and notes; a table of contents when the package exposes one; thumbnails; a test for the failed-pages table (reasoned, not driven).

**Clean-extract check (2026-10-18):** the zip was extracted into an empty directory (307 entries; no `node_modules/`, `dist/`, `test-results/` or `playwright-report/`). `npm ci` exit 0; typecheck exit 0; 628 tests in 58 files passed; build precached 71 entries (10802.60 KiB); `verify:static` passed; `npm run notices` rewrote the file identical to the shipped copy; eslint 53 errors / 15 warnings, per-file counts identical to the baseline; `npx playwright test` 95 passed, 1 skipped (the large scan), 6.4 minutes. The zip was rebuilt once after this paragraph was appended; the only file that differs from the verified extract is `futureplans.md`.

### 2026-10-18 — checkpoint 18: contrast audit of the colour tokens (measurement only)

**Asked:** "verify everything and continue to the next task in the pipeline". Verification first: checkpoint 17's zip was extracted again and its colour and large-scan specs run with `NAWIRI_LARGE_DJVU` set: both passed (the large scan first page in 3,573 ms); the zip's listing gives 96 specs on the default project and 96 on WebKit, and `tsc` is clean. The next item of the list that a single pass can finish and measure is the contrast audit of checkpoint 16's accessibility follow-ups. Items left in that group need the owner's choice (the collection design) or a real screen reader.

**Method.** The WCAG 2.x relative-luminance formula applied to the token values of the `:root` and `.dark` blocks in `src/styles.css`, and to the three reader themes in `src/lib/reader-settings.ts`. 17 pairs per theme (14 text, 3 boundary), and 9 reader pairs (text ink, secondary text, divider). The script is in the working scratch area and is not shipped; the numbers below are its output.

**Result.** App: 34 pairs, 29 pass, 5 fail. Failing: light border `#e5e5e5` on `#fdfdfd` 1.24:1 and light input 1.24:1; dark border `#2a2a2a` on `#111111` 1.32:1 and dark input `#333333` 1.49:1; white on the dark destructive `#ff5541` 3.17:1 (the `destructive` variants of `Button` and `Badge`, which no screen uses). Passing with the least margin: muted text 5.13:1 (light, on the muted fill), red signal text 4.59:1 (light, on the page) and 4.67:1 (white on red, the signal fill). Reader: text ink 11.0 to 17.1:1 in all three themes; secondary text 4.66:1 in Paper, **3.52:1 in Sepia, 4.45:1 in Dusk** (both fail 4.5:1); dividers 1.22 to 1.29:1 (decoration; not counted).

**Suggested values, not applied** (smallest change that passes): dark destructive `#d14635` (4.53:1 with white); Sepia secondary `#786c5b` (4.55:1); Dusk secondary `#7d7d7d` (4.51:1); light border and input `#939393` (3.02:1); dark border and input `#606060` (3.00:1).

**Not verified:** rendered pixels (overlays, hover and selected tints, disabled states, images, the reader's page edges); colours written outside the tokens; a colour-blindness simulation; a magnifier. No colour was changed, because a colour change is a visible design change for the owner to choose.

**Working tree.** Nothing under `src/`, `tests/` or `scripts/` changed in this checkpoint; the change is to `HANDOVER.md` and this log. The last zip is `nawiri-checkpoint-17.zip`.

### 2026-10-18 — checkpoint 18, part B: private shelf search (desktop Chromium only)

**Asked:** "GO!", after "continue" and "verify everything and then continue to the next task in the pipeline". The first P0 item of the roadmap (item 3 of HANDOVER's "Next"): search books that have never been opened, with a visible "indexed N of M" count, and a hit opens the reader where the index counted.

**What changed.** `src/lib/headless-index.ts` (new): `headlessKind` (EPUB, MOBI/AZW3, FB2 through foliate's `view.js`; PDF through pdf.js), `openUnits` (the unit numbering the readers use: foliate's `book.sections[i]` numbered from 1 with the reader's rounding and clamping; PDF page n), and `indexShelfHeadless`, which indexes each eligible book that has a stored file and no ready record, one at a time, with an abort signal and a status callback. `src/lib/search-index.ts`: `ensureIndex` is a per-book queue around the original build (`ensureIndexNow`), so the shelf and an open reader cannot interleave writes to one record. `src/routes/index.tsx`: an effect that runs the headless index while the shelf is open, an `IndexLine` above the results ("Shelf search: N of M e-books and PDFs indexed", aria-hidden visible text, a settled `role="status"` for speech), and a no-match note that names what was searched.

**Tests (new).** `tests/e2e/shelf-search.spec.ts` (4 specs), `tests/unit/headless-index.test.ts` (3, jsdom: foliate mocked with three sections; numbering, rounding and clamping), `tests/unit/search-index-queue.test.ts` (1, fake-indexeddb: two builds of one book do not interleave).

**Measured (working tree, 2026-10-18).**

- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 632 tests in 60 files, all passing (checkpoint 17: 628 in 58).
- `npm run build`: 71 precache entries, 10805.89 KiB (before the shelf search: 10802.60 KiB).
- `npm run verify:static`: passed.
- eslint and Prettier: clean on the changed files. The whole-project eslint count is re-measured in the clean extract below.
- `npx playwright test --list`: 100 tests in 17 files (default config). `playwright.webkit.config.ts`: 108 tests (100 webkit, 8 iphone).
- Full e2e (`npm run test:e2e`, port 4173 free, run detached): 99 passed, 1 skipped (the large-scan test), 6.7 minutes.

**Mutation checks** (`$SP/mut/run17.py`, log in `$SP/mut/run17.log`; each file restored from a snapshot and compared with `filecmp`, all restored):

- U-M1, EPUB section numbering off by one: 2 unit tests fail.
- U-M2, queueing removed: 1 unit test fails.
- B-M3, PDF page read one page late: `shelf-search.spec.ts` "a PDF and an EPUB that were never opened are found…" fails.
- B-M4, index line removed: 4 browser specs fail.
- B-M5, coverage note removed: the no-match spec fails.
- B-M6, a request added to indexing: the hostile-EPUB spec fails.

**Not verified.** The reader opening an EPUB hit at its section (the unit test checks the numbering, not the reader's position; the browser test checks a PDF hit only, landing on "Page 3" and "Page 3 of 4"). Plain text, HTML, comics and DjVu from the shelf: not built. Notes and highlights in search: not built. WebKit and iPhone: not run. A screen reader: not run. The cost on a large library: not measured. The `building` state after a stopped run: reasoned from the code, not tested.

**Working tree.** Changed: `src/lib/headless-index.ts` (new), `src/lib/search-index.ts`, `src/routes/index.tsx`, the three new test files, `README.md` (count and one sentence), `AGENTS.md` (spec count), `HANDOVER.md`, `roadmap.md` (item for shelf search and the WebKit count). The last zip is still checkpoint 17 until the checkpoint-18 zip is built and verified.

**Clean extract of `nawiri-checkpoint-18.zip` (2026-10-18, same sandbox, desktop Chromium 141 only).** The zip was built from the working tree with `node_modules/`, `dist/`, `test-results/`, `playwright-report/` and `.git/` left out, extracted into an empty directory, and run from there: `npm ci` exit 0 (`found 0 vulnerabilities`); `npx tsc --noEmit` exit 0; `npx vitest run` 632 tests in 60 files, all passing; `npm run build` precaches 71 entries (10805.89 KiB); `npm run verify:static` passed; `npm run notices` left `public/THIRD_PARTY_NOTICES.txt` byte-identical (`cmp`); eslint over the whole project gives 53 errors and 15 warnings in 15 files, the checkpoint-2 baseline; `npm run test:e2e` with port 4173 free and the run detached: 99 passed, 1 skipped (the large-scan test), 6.6 minutes. The zip was then rebuilt once after the two documents named above were edited (`futureplans.md` and the header and measurement line of `HANDOVER.md`); a comparison of the rebuilt zip's tree with the verified extract showed only those documents differing, so the verified code is the code in the zip.

### 2026-10-18 — checkpoint 19: import checks (library health, first part)

**Asked:** "continue properly please", after the shelf search. The next item of the P0 list is item 4, library health on import. This checkpoint takes the part that the code can settle without a new decision: duplicates by content, and files refused before decoding.

**Starting point, read from the code.** `importFiles` skipped a file when `bookExists` found a book with the same name and size, and in no other case. A duplicate under another name was imported twice. A different file with the same name and size was silently dropped. An empty or mislabelled file went into the decoder and failed there with a generic "Couldn't read".

**What changed.**

- `src/lib/book-identity.ts`: `sameBytes(a, b)` compares in 1 MiB pieces; `findSameFile(file, format, candidates)` returns the book on the shelf that is the same file. For each candidate with the same format and size it compares fingerprints (`fingerprintBlob`, already used by backups) and then bytes. A candidate whose stored file is gone matches by name and size only, as before.
- `src/lib/import-check.ts` (new): `fileProblem(file)` returns a reason or null. Empty is refused for every format. For EPUB and CBZ (ZIP header: `PK` then 3/4, 5/6 or 7/8), PDF (`%PDF-` within the first 1 KiB), CBR (`Rar!\x1a\x07`), CB7 (`7z\xBC\xAF\x27\x1C`), DjVu (`AT&TFORM`), MOBI/AZW/AZW3 (`BOOKMOBI` or `TEXtREAd` at byte 60) and CHM (`ITSF`), a header that is missing is refused. TXT, RTF, FB2, HTML and Markdown have no fixed header and are checked for emptiness only.
- `src/lib/import-books.ts`: `ImportResult` gains `rejected: {name, reason}[]`. The shelf is read once per batch, and a book added by the batch is compared with later files in the same batch.
- `src/lib/db.ts`: `bookExists` removed (no other caller).
- `src/routes/index.tsx`: the import message reads "Couldn't read: name (reason), …".

**Fixture check.** Every shipped sample and test file was read for its first bytes before the checks were written: the three sample EPUBs (`PK\x03\x04`), the three DjVu files in `tests/e2e/data` (`AT&TFORM`), the CHM fixture (`ITSF`), and the PDF, CBZ and EPUB fixtures that the e2e helpers build (`%PDF-`, ZIP). None is refused.

**Measured (working tree, 2026-10-18).**

- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 654 tests in 63 files, all passing (the shelf-search checkpoint: 632 in 60; new files: `import-check.test.ts` 11, `duplicate-file.test.ts` 7, `import-duplicates.test.ts` 4).
- Lint: 53 errors and 15 warnings in 15 files, the baseline. Prettier clean on the changed files.
- `npm run build`: 71 precache entries, 10807.58 KiB (10805.89 KiB before).
- `npm run verify:static`: passed.
- `npx playwright test --list`: 102 tests in 18 files. The WebKit config lists 110 (102 webkit, 8 iphone).
- Full e2e (port 4173 free, run detached): 101 passed, 1 skipped (the large-scan test), 6.8 minutes. The new `tests/e2e/library-health.spec.ts` has 2 specs and passes.

**Mutation checks** (`$SP/mut/run18c.py`, log `$SP/mut/run18c.log`; every file restored from a snapshot and compared with `filecmp`, all restored):

- U1, fingerprint alone decides: `duplicate-file.test.ts` "does not take a different file of the same size…" fails. This is the case the byte comparison exists for: a 400 KiB file differing at 100 KiB, between the fingerprint windows, has an equal fingerprint.
- U2, the old name-and-size rule: the same test and `import-duplicates.test.ts` "imports a different file…" fail.
- U3, batch copies not compared: "keeps one copy when two identical files arrive in the same batch" fails.
- U4, empty files not refused: `import-check.test.ts` and the refusal test in `import-duplicates.test.ts` fail.
- U5, PDF header only at offset 0: "accepts a PDF whose header follows some junk…" fails.
- U6, Kindle type field at offset 0: the Kindle test fails.
- U7, header check not run on import: the refusal test in `import-duplicates.test.ts` fails.
- U8, byte comparison looks at the first chunk only: the multi-chunk `sameBytes` test fails.
- B1, the toast leaves out the reasons: the second `library-health.spec.ts` spec fails.

**Not verified.** The header checks read the first bytes and do not parse the file; a zip with a good header and a broken directory still passes and fails later, as before. The cost of the content check on a large library was not measured (each same-size, same-format book is read once to fingerprint it, and a true duplicate is read whole). WebKit and iPhone: not run. A real large file: not tried. Missing covers and metadata, broken encodings, unsearchable scans, bad EPUB manifests and the repair copy are not started.

**Behaviour changes to know about.** A different file with the same name and size is now imported (it was dropped). An empty text file is now refused (it was imported).

**Working tree.** Changed: `src/lib/import-check.ts` (new), `src/lib/book-identity.ts`, `src/lib/import-books.ts`, `src/lib/db.ts`, `src/routes/index.tsx`, three unit test files and `tests/e2e/library-health.spec.ts` (both new), `HANDOVER.md`, `roadmap.md`, `README.md`, `AGENTS.md`, this log.

**Clean extract of `nawiri-checkpoint-19.zip` (2026-10-18, same sandbox, desktop Chromium 141 only).** The zip was built from the working tree with `node_modules/`, `dist/`, `test-results/`, `playwright-report/` and `.git/` left out, extracted into an empty directory and run from there: `npm ci` exit 0; `npx tsc --noEmit` exit 0; `npx vitest run` 654 tests in 63 files, all passing; `npm run build` precaches 71 entries (10807.58 KiB); `npm run verify:static` passed; `npm run notices` left `public/THIRD_PARTY_NOTICES.txt` byte-identical (`cmp`); eslint over the whole project gives 53 errors and 15 warnings in 15 files, the baseline; `npm run test:e2e` with port 4173 free and the run detached: 101 passed, 1 skipped (the large-scan test), 6.8 minutes. The zip was then rebuilt once, after this paragraph was added to `futureplans.md`; comparing the rebuilt zip's tree with the verified extract shows that file as the only difference, so the verified code is the code in the zip.

### 2026-10-19 — checkpoint 20: an EPUB hit checked, a 40-book search cap fixed, and a full audit (desktop Chromium only)

**Asked:** "Rather than best next item, do a full audit of the build until now and see if anything anywhere needs any changes or certain part or a feature can be done better? Continue, fix what you found one gap in checkpoint 18 then do a full audit and properly note down how the fixes can be implemented!", then "continue". So: fix the one gap checkpoint 18 left (its "Not verified" list named the reader opening an EPUB hit at its section), then audit everything, and write down how each fix would be built rather than building them.

**The gap, driven in a browser.** Checkpoint 18 verified a PDF hit landing on page 3 of 4 and left an EPUB hit unchecked. The reader applies `?q=…&page=N` through `navRef.current.goToPage` (foliate `goToSection`, unit n = section index n−1) while foliate's own `view.init` restores saved progress, so a race was possible. `tests/e2e/shelf-search.spec.ts` now has two specs (a loop over `readBefore` false and true): an EPUB of five chapters headed Alpha to Echo (`makeSectionsEpub()` at the end of `tests/e2e/fixtures.ts`) is imported, a word found in one chapter only is searched from the shelf, the hit is clicked, and the chapter text in the reader's iframe (`sectionText(page)`) must contain the chapter's heading. With `readBefore` true the book is opened and read first, so a saved position exists. Both pass; no source change was needed for it.

**Breakages for it** (`$SP/mut/run19a.py`, log `$SP/mut/run19a.log`, named for the checkpoint they were first used in; each file restored from a snapshot and compared with `filecmp`, nothing left differing): E1 the reader's `view.goTo(i)` replaced by `goTo(min(last, i + 1))` in `foliate-reader.tsx`; E2 `Math.round(unit) - 1` replaced by `Math.round(unit)` in `headless-index.ts`; E3 the `goToPage` call removed from `reader-shell.tsx`. Each failed both specs (2 failed), after about 1.1 minutes each.

**A bug found while checking scale.** `searchLibrary` in `src/lib/library-search.ts` did `.slice(0, maxBooks)` on the list of index records before searching them. `maxBooks` is 40, the records come back in key order, and the shelf indexes every book, so a word that only the 41st book held was not found while the shelf's line said "N of N indexed". Reproduced in a scratch test under Node with `fake-indexeddb` (records cleared between sizes, zero-padded ids, a 240-second timeout): **80 books and 200 books, the last book's word not found.** An earlier version of that test was wrong (leftover records, key order that put the "last" book inside the first 40, a 5-second timeout) and its result was not used. **Fix:** the records are filtered to books that are on the shelf and ready, all are searched, and `results.slice(0, maxBooks)` limits the list shown (most matches first). New `tests/unit/library-search.test.ts`, 4 tests: all 60 books are searched, including a rare word only the last holds; at most `maxBooks` books are listed, those with most matches first; books not on the shelf and indexes that are not ready are left out; a query under 2 characters returns nothing.

**Breakages for it** (`$SP/mut/run20c.py`, log `$SP/mut/run20c.log`, snapshot compared with `filecmp` and `cmp` against a copy of the good file, identical): L1 the cap applied before searching (the old behaviour): 2 tests fail ("searches every indexed book…", "lists at most maxBooks books…"); L2 no cap on the list that comes back: 1 fails; L3 indexes that are not ready searched: 1 fails ("leaves out books that are not on the shelf and indexes that are not ready"). The first script for L1 did not match its target (Prettier had wrapped the line), so it was rewritten and L1 was run again; the three results above are from one run made on 2026-10-19 after a session break, because the first run's log was not kept.

**The audit** is `docs/audit-2026-10-19.md` (Prettier-clean): 30 open findings in nine areas, each marked verified, code-read, reasoned, synthetic or not measured, with a priority and an effort, how to build the fix and the test that would show it works; section 10 lists what was checked and found sound, section 11 what it did not cover, section 12 the owner's seven decisions, section 13 a suggested order. Its own numbers were re-measured after a first draft had errors, and the corrections are worth knowing because they show where a draft can go wrong: "five breakages" was six; "23 of the 40 outdated" was 24 of 61; "11 of 53 lint findings" was 6 of 68 (react-refresh in `ui`); "100 transitions" was about 110; a claim that the contrast script was in `futureplans.md` was untrue and the script was moved into `scripts/audit/`; and a first scan for unused dependencies missed side-effect and dynamic imports (16 false positives) until the pattern was fixed (3 remain). A later pass found that the audit's summary table left out finding 6.4; it was added. The only defect reproduced and left open is 3.1: a book deleted while the shelf is indexing it can leave its `searchIndex` and `searchMeta` records, because the indexer writes after the delete.

**Scripts added** (both read-only, print only, no file written, none writes a claim anywhere): `scripts/audit/contrast.py` reads the colour tokens in `src/styles.css` and the reader themes and prints the 34 app pairs (29 pass, 5 fail) and the 9 reader pairs; `scripts/audit/unused-ui.py` prints the UI components nothing imports (35 of 46), the packages only they need (27) and the packages nothing imports (3).

**Measured (working tree, 2026-10-19).**

- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 658 tests in 64 files, all passing (654 in 63 before; new file `library-search.test.ts`, 4 tests).
- Lint: 53 errors and 15 warnings in 15 files, the baseline. Prettier clean on the edited source, tests, `HANDOVER.md`, `roadmap.md`, `README.md`, `AGENTS.md` and the audit.
- `npm run build`: 71 precache entries, 10807.58 KiB (unchanged: no shipped asset changed).
- `npm run verify:static`: passed.
- `npx playwright test --list`: 104 tests in 18 files (102 before; two EPUB-hit specs). The WebKit config lists 112 (104 webkit, 8 iphone).
- Full e2e (port 4173 free, run detached): 103 passed, 1 skipped (the large-scan test), 7.1 minutes (6.8 for checkpoint 19's suite). A first attempt at this run stopped at spec 69 with its processes gone after a pause in the session; it was discarded and the run repeated from the start.

**Not verified.** WebKit, Safari, an iPhone, a real screen reader. Search timings in a real browser, and the cost of indexing a library of hundreds of books (the audit's timings are synthetic, from `fake-indexeddb`). Every audit finding marked code-read or reasoned. The audit's recalled facts: the deploy job's `cancel-in-progress` advice and the SIMD support claim for older Safari. The orphan defect (3.1) and every other finding are written up, not fixed.

**Working tree.** Changed: `src/lib/library-search.ts`; `tests/unit/library-search.test.ts` (new); `tests/e2e/shelf-search.spec.ts` and `tests/e2e/fixtures.ts` (two specs, a fixture and a helper); `docs/audit-2026-10-19.md` and `scripts/audit/contrast.py`, `scripts/audit/unused-ui.py` (new); `HANDOVER.md`, `roadmap.md`, `README.md`, `AGENTS.md`, this log.

**Clean extract of `nawiri-checkpoint-20.zip` (2026-10-19, same sandbox, desktop Chromium 141 only).** The zip was built from the working tree with `node_modules/`, `dist/`, `test-results/`, `playwright-report/` and `.git/` left out (354 entries, none of those), extracted into an empty directory and run from there: `npm ci` exit 0; `npx tsc --noEmit` exit 0; `npx vitest run` 658 tests in 64 files, all passing; `npm run build` precaches 71 entries (10807.58 KiB); `npm run verify:static` passed; eslint over the whole project gives 53 errors and 15 warnings in 15 files, the baseline. **`npm run notices` did not leave the file byte-identical this time:** one line differed, the second, which says "Generated by scripts/make-notices.mjs on 2026-10-19" where the shipped file says 2026-10-18 (a known property: the script writes the date it is run on, see Known issues). Nothing else in the file differed (`diff` showed that one line only), so the shipped file was put back and compared equal to the working tree's. **The full browser suite was run twice in the extract (port 4173 free, run detached):** the first run gave 102 passed, 1 failed and 1 skipped (the large-scan test), 7.3 minutes; the failure was `reader-pages.spec.ts` › "Alt + arrow reorders a page and announces the move" (the polite announcement stayed empty for 30 seconds). The second run gave 103 passed and 1 skipped, 7.1 minutes. That spec passed in the working-tree run, 15 of 15 times in isolation and 6 of 6 times with its whole file repeated, so it failed once in 24 attempts of this checkpoint. **Its cause is not known:** the failure's trace was overwritten by the isolated repeats (a lesson: copy `test-results/` before running anything else), and the code gives hypotheses only (audit 6.4). The checkpoint is not claimed to be free of that flake. The zip was then rebuilt once, after this paragraph and the flake notes in `HANDOVER.md` and `docs/audit-2026-10-19.md` were written; `diff -rq` of the working tree against the verified extract (leaving out `node_modules`, `dist`, `test-results` and `playwright-report`) shows exactly those three documents as the only differences, so the verified code is the code in the zip.

### 2026-10-23 — checkpoint 21: the five problems of the format and screen-size sweep fixed, and four defects found on the way (desktop Chromium only)

**Asked:** after the sweep of 2026-10-19 (a generated file of every supported format, opened at window sizes from 280 px up; its scripts and contact sheets were scratch work): "OKay, let's do it. All of them fixes everything before we launch it. Properly take time and do the best fix in each and every one of them properly please!", then, over three days, "continue properly! and very carefully!", "continue", "continue please". So: fix each of the five problems the sweep found, each properly, test it, break each fix on purpose, and write it down. `HANDOVER.md` (checkpoint 21) has the design of each fix; this entry is the evidence.

**The five.** (1) The README said plain text, HTML, comics and DjVu were "searched once opened"; plain text, RTF, Markdown and HTML had no persisted index, so the shelf never found a word in them. Fixed by cutting those documents into index units (`src/lib/text-units.ts`) built from block lists the reader and the shelf indexer share (`text-document.ts`, `html-blocks.ts`). (2) A click on a result in a long single-section EPUB, FictionBook or MOBI stayed at the start of the book; it now lands on the match (`goToMatch`, `hit-locate.ts`). (3) An RTF result landed at 50% with the match off screen, because `\par` was a single newline and the whole file one paragraph (`rtf.ts`); a paragraph taller than the window now goes to the match's line and marks only the words. (4) A PDF whose pages differ in size landed on the wrong place and label ("Page 3 of 4"): the reader now reads every page's size first and a jump waits for the pages above it (`pdf-reader.tsx`). (5) At 568×320 the search drawer was a bottom sheet with about 170 px for its content: short landscape screens now get the side rail (`useBottomSheet`).

**What the browser showed that reading the code did not.** (a) The search tab ran its search again on every scroll of the reader, wiping the mark a jump had just left, because the shell hands it new function objects on every render; found when an e2e spec checked that the mark stays for 3.5 s. (b) A shelf hit opened the right page but did not select the result; the link now carries the offset. (c) EPUB hits were labelled "Page 7", the seventh section; they now carry the contents entry. (d) A first PDF landing put the match under the 56 px top bar; the page top now goes 38 px below the window's top. (e) The 300-page PDF fixture did not catch a jump that ignores the page sizes (the guessed heights were close enough); at 1,500 pages it does. (f) **A defect that fix (a) uncovered:** a DjVu or comic search typed before the index was built answered "No results" and kept saying it, because those readers have no search of their own and the old accidental re-run no longer happened. The first full run of the final code failed one spec for it (`djvu.spec.ts` › search runs on the scan's own text layer; 60 s timeout, "No results"); alone, that spec passed 12 of 12. A probe that types the moment the Search tab appears (`$SP/probe/djvu-race.mjs`, an unshipped scratch script) failed 4 of 8 runs at normal speed and 8 of 8 with the processor slowed 4× and 8× (CDP `Emulation.setCPUThrottlingRate`). With the wait (`src/lib/search-wait.ts`) it passed 8 of 8 at normal speed and at 6×. (g) **A trap in my own process:** after a breakage round `dist/` kept the build made from the broken source. A deep link into the 1,500-page PDF seemed to stall near page 700 (with `scrollTop` writes from the size correction cancelling the smooth scroll); I traced it before noticing the build was the one made for breakage E5. A clean build of the same source landed on page 1249 in every run (three traces, then 5 of 5 specs).

**Breakages** (scripts `$SP/mut/mut21.py` for the first 22 unit and 12 browser breakages and `$SP/mut/mut22.py` for the last 4 and 2; each file restored from a snapshot and compared with the original afterwards; nothing was left differing in any round). **Unit, 26 of 26 caught:** U1 units not cut at the size limit; U2 `locate` picking the block after; U3 the signature ignoring the text; U4 the label giving only where a unit starts; U5 the offset trusted without looking at the text; U6 the occurrence counted up to and including the offset; U7 text-layer pieces walked by code point (first survived; an astral-plane case was added to `hit-locate.test.ts`); U8 a block counted tall only at eight windows; U9 the block range ignoring the confirmed start; U10 RTF `\par` back to a line break; U11 plain text left out of shelf indexing; U12 e-book labels not supplied; U13 the shelf reading text in the default encoding; U14 a changed text no longer rebuilding the index; U15 the signature not stored; U16 the search tab running again when callbacks change; U17 the deep hit taken from the first on the page; U18 the deep hit never taken; U19 the deep hit selected but the reader not taken to it; U20 the shelf link without its offset; U21 the contents entry looked up one section early; U22 the shelf labeller without section ids; U23 the index wait returning without waiting; U24 a replaced build not followed; U25 a cancelled search still waiting; U26 a failed build throwing. **Browser, 14 of 14 caught:** E1 the one-section EPUB hit going to the section; E2 EPUB labels not supplied; E3 and E4 text and HTML hits going to the start of their unit; E5 the PDF jump not waiting for page sizes; E6 no room under the last page; E7 the match left under the top bar; E8 short landscape screens getting the sheet; E9 the shelf link without its offset; E10 the reader ignoring the offset; E11 the drawer closing after a hit on a wide screen; E12 the drawer staying after a tap on a narrow one; E13 the shell never waiting for the index; E14 the shell waiting for no build. **First survivors, each redesigned until caught:** U7; E2, E6 and E7 (the specs were rewritten: the labels are stripped in IndexedDB and must come back when the book opens; the last page is brought to the top; the word's distance from the top bar is measured); E5 survived at 300 pages and is caught at 1,500 by 1 of the 5 PDF specs (the shelf-hit one) in 2.7 minutes. E13 and E14 each fail the throttled DjVu spec after its 60 s wait.

**Measured (working tree, 2026-10-23).**

- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 742 tests in 74 files, all passing (658 in 64 before; 84 more tests and 10 more files). Per file: `text-units` 11, `hit-locate` 17, `html-blocks` 5, `rtf` 9, `search-index-signature` 3, `search-tab` 5, `section-labels` 8, `use-bottom-sheet` 5, `headless-text-index` 4, `search-wait` 7 (all new); `headless-index` 10 (was 3); `library-search` 7 (was 4).
- Lint: 53 errors, 15 warnings, the baseline totals (the new test files first added 5 Prettier errors; fixed with `prettier --write`). Prettier clean on the edited source, tests and documents.
- `npm run build`: 72 precache entries, 10818.73 KiB (71 and 10807.58 KiB before). Five `INEFFECTIVE_DYNAMIC_IMPORT` notices, three more than before (`text-document`, `text-units` and `html-blocks`, each loaded dynamically by the shelf indexer and directly by a reader). `npm run verify:static`: passed.
- `npx playwright test --list`: 132 tests in 19 files (104 in 18 before; `search-landing.spec.ts` is new with 27 specs, `djvu.spec.ts` has one more). The WebKit config lists 140 (132 webkit, 8 iphone); never run. The throttled DjVu spec skips itself outside Chromium (it needs the DevTools protocol).
- Full e2e, port 4173 free, run detached with the turn kept open: **131 passed, 1 skipped (the large-scan test), 9.8 minutes** (7.1 for checkpoint 20's 104). The run before it, on the code without the index wait: 129 passed, 1 failed (item f), 1 skipped, 11.3 minutes (the failure's 60 s wait is in that figure). Three earlier attempts and one more were found stopped, with no failure in them, at specs 72, 73, 35 and 69 (checkpoint 20): a detached run does not survive a pause of the session between turns, and none of those is counted.
- Large PDFs (scratch, synthetic, tiny pages): reading every page's size took about 2 s for 1,500 pages and about 5 s for 4,000.
- After the last edit to `djvu.spec.ts` (the browser-name guard) the file was run again alone: 14 passed, 1 skipped.

**Not verified.** WebKit, Safari, an iPhone, any real touch screen (the phone specs are Chromium with touch emulation at 390 px; 568×320 is a window size); a real screen reader; dark mode and the sepia and dusk themes for the new match mark (looked at in one theme only); browser zoom; PDF with a zoom other than "fit", with margin trimming, or a real long PDF (the fixture is synthetic text with tiny pages); a real MOBI or AZW3 (KF8); any real-world document (every spec file is generated); the cost of indexing a very large text file or a library of hundreds of them; the Custom Highlight API in a browser without it; a search in a comic in any browser; the old accidental re-run's other effects (reasoned: the search tab is not mounted while another drawer tab is shown); that an index written by an older build for an EPUB or PDF is unharmed (reasoned: unit numbering did not change, labels are refreshed; the label spec is the only browser evidence). The PDF `shiftRef` correction was never broken on purpose.

**Working tree.** New: `src/lib/text-units.ts`, `text-document.ts`, `html-blocks.ts`, `hit-locate.ts`, `section-labels.ts`, `search-wait.ts`; `tests/unit/` `text-units`, `hit-locate`, `html-blocks`, `rtf`, `search-index-signature`, `search-tab`, `section-labels`, `use-bottom-sheet`, `headless-text-index`, `search-wait`; `tests/e2e/search-landing.spec.ts`. Changed: `src/components/reader/` `drawer/search-tab.tsx`, `foliate-reader.tsx`, `html-reader.tsx`, `pdf-reader.tsx`, `reader-drawer.tsx`, `reader-shell.tsx`, `text-reader.tsx`; `src/hooks/use-mobile.tsx`; `src/lib/` `headless-index.ts`, `library-search.ts`, `reader-settings.ts`, `rtf.ts`, `search-index.ts`; `src/routes/index.tsx`, `src/routes/read.$id.tsx`; `src/styles.css`; `src/types/vendor.d.ts`; `tests/unit/headless-index.test.ts`, `library-search.test.ts`; `tests/e2e/fixtures.ts`, `shelf-search.spec.ts`, `djvu.spec.ts`; `README.md`, `AGENTS.md`, `HANDOVER.md`, `roadmap.md`, `docs/audit-2026-10-19.md` (a status note), this log.

**Clean extract of `nawiri-checkpoint-21.zip` (2026-10-23, same sandbox, desktop Chromium 141 only).** The zip was built from the working tree with `node_modules/`, `dist/`, `test-results/`, `playwright-report/` and `.git/` left out (371 entries, none of those; 354 in checkpoint 20, 17 more: 6 source modules, 10 unit test files, 1 e2e spec file), extracted into an empty directory and run from there: `npm ci` exit 0 (19 s); `npx tsc --noEmit` exit 0; `npx vitest run` 742 tests in 74 files, all passing; `npm run build` precaches 72 entries (10818.73 KiB) with five `INEFFECTIVE_DYNAMIC_IMPORT` notices; `npm run verify:static` passed; eslint over the whole project gives 53 errors and 15 warnings, the baseline totals. `npm run notices` left the file identical except for its second line, the date it was generated on (2026-10-23 where the shipped file says 2026-10-18; the known property in Known issues), so the shipped file was put back and compared equal to the working tree's. **The full browser suite was run in the extract (port 4173 free, run detached, the turn kept open until its summary printed): 131 passed and 1 skipped (the large-scan test), 9.4 minutes, no failure.** In this checkpoint's working tree the same suite was run to its end twice: 129 passed with 1 failed (item f above, fixed afterwards) and 131 passed with 0 failed. The zip was then rebuilt once, after this paragraph was written; `diff -rq` of the working tree against the verified extract (leaving out `node_modules`, `dist`, `test-results` and `playwright-report`) must show this log as the only difference, and the result is recorded in the delivery message, not here.

### 2026-10-24 — checkpoint 22: the audit's first group, apart from the OCR core (desktop Chromium only)

Asked by "okay let's go. continue", answering my proposal to take the audit's section 13, "Now", without the items that need an owner decision. Done: 3.1 (orphan index records after a delete), 5.2 (referrer), 5.3 (ready marker, benchmark only for `?bench`), 5.4 (workflow and Dependabot, written, never run), 6.2 (unused components and packages), 7.1 (reduced motion), 9.2 (stale text), 9.6 (dead file). Not touched: 6.1 (the owner's SIMD decision). The details and the reasoning are in `HANDOVER.md`, checkpoint 22 block, items 1 to 12; this entry records what was run.

**Ran and seen.** 3.1 was reproduced before the fix in a scratch test (a delete during page 2 of a build, both index records back afterwards) and the same shape is now a test that passes. `npx tsc --noEmit` 0 errors. `npx vitest run` 767 tests in 78 files, all passing (742 in 74 before; new: `search-index-orphan` 9, `headless-orphan` 4, `motion` 9, `app-ready` 3; `search-index-queue` and `search-index-signature` changed to put a book on the shelf first). Lint 53 errors, 10 warnings, 10 files (15 and 15 before; the five files that dropped out are deleted UI components). `npm run build`: 73 entries, 10784.41 KiB (72 and 10818.73 before; with the UI deletion alone: JavaScript chunks all the same size, stylesheet 106,742 → 69,682 bytes, 10820.60 → 10784.41 KiB), five `INEFFECTIVE_DYNAMIC_IMPORT` notices. `npm run verify:static` passes with its new referrer check. `npm run notices`: only the date line and "46 files" → "5 files" changed, still 57 packages. `npx playwright test --list`: 145 in 21 files; the WebKit config lists 153 (never run). **Full e2e, port 4173 free, detached, the turn kept open: 144 passed, 1 skipped (the large-scan test), 9.9 minutes. The same suite with `use.reducedMotion: "reduce"` for every test (a temporary config, deleted): 144 passed, 1 skipped, 8.5 minutes; a first attempt was killed at spec 87 by a pause of the session and discarded.** New browser specs: `reduced-motion.spec.ts` 11 (each under `reduce` and under `no-preference` as a control), `app-ready.spec.ts` 2; `define.spec.ts` now asserts that the lookup has no `Referer`. The workflow and `dependabot.yml` parse as YAML; the workflow passes `@action-validator/cli` (exit 0) and a deliberately broken copy fails it (exit 1). The release notes of the four actions were read from their GitHub release pages (2026-10-24).

**Breakages (33, each alone, all caught, each touched file restored from a snapshot and compared afterwards).** Unit 13 for 3.1 and 9 for 7.1 and 5.3; browser 11 (list in the HANDOVER block). Two things they exposed: a guard for foliate's `animated` attribute that missed `setAttribute?.(` (one survivor, widened and rerun: caught) and a vacuous first `reduce` pass in the HTML-reader animation test (the control under `no-preference` showed `0s`: the reader drops a page's head styles; the fixture's style moved into the body). Two overlaps are deliberate and are not seen by a browser test when only one is removed: the media-guarded `scroll-behavior` and `REDUCED_MOTION_BOOK_CSS` in the HTML reader.

**Found, not fixed.** `npm audit` reports 8 findings (1 low, 3 moderate, 4 high) where the audit of 2026-10-19 recorded 0 in production dependencies: `zod` <4.6.6 in production (the app's own 3.25.76, used by `src/lib/backup.ts` for one object of scalars; the related advisory I could read puts the fault in array, set and map validation, so reasoned not reachable; the fix npm offers is a major bump), and seven in build and test tooling (`vite` 8.1.5 pinned exactly, `happy-dom`, `undici`, `fast-uri`, `serialize-javascript`, `vitest`, `@vitest/mocker`). The GitHub advisory pages were not reachable from the sandbox. Nothing was changed.

**Not verified.** WebKit, Safari, an iPhone or any real touch screen; the operating system's real reduced-motion setting (only Chromium's emulation); a screen reader; how the leaner stylesheet looks (no screenshot was compared); that the Pages workflow runs; the job-level `cancel-in-progress` behaviour (recalled, not read); the Dependabot file (the validator knows workflows only); how Wikimedia treats a request with no Referer; the atomicity of the write guard against a truly concurrent delete (reasoned from IndexedDB's transaction ordering; the tests cannot interleave); the zod advisory's reach beyond the reasoning above.

**Working tree.** New: `src/lib/motion.ts`, `src/lib/app-ready.ts`; `tests/unit/` `search-index-orphan`, `headless-orphan`, `motion`, `app-ready`, `fixtures/shelf-book.ts`; `tests/e2e/` `reduced-motion.spec.ts`, `app-ready.spec.ts`, `ready.ts`; `.github/dependabot.yml`. Changed: `src/lib/` `search-index.ts`, `headless-index.ts`, `bench.ts` (comment), `spoken-highlight.ts`; `src/routes/__root.tsx`; `src/components/reader/` `html-reader.tsx`, `text-reader.tsx`, `pdf-reader.tsx`, `foliate-reader.tsx`; `src/styles.css`; `index.html`; `scripts/verify-static.mjs`; `playwright.config.ts` (a comment); `package.json`, `package-lock.json` (32 packages removed); `public/THIRD_PARTY_NOTICES.txt`; `.github/workflows/pages.yml`; 18 e2e spec files (the ready helper), `define.spec.ts` (no `Referer`), `fixtures.ts` (two fixtures); `README.md`, `AGENTS.md`, `HANDOVER.md`, `HANDOVER_PROMPT.md`, `roadmap.md`, `docs/audit-2026-10-19.md`, this log. Removed: `src/lib/error-capture.ts`, 41 files in `src/components/ui/`.

**Clean extract of `nawiri-checkpoint-22.zip` (2026-10-24, same sandbox, desktop Chromium 141 only).** The zip was built from the working tree with `node_modules/`, `dist/`, `test-results/`, `playwright-report/` and `.git/` left out (340 entries, none of those; 371 in checkpoint 21: 42 removed, 11 added), extracted into an empty directory and run from there: `npm ci` exit 0 (23 s, with the 32 packages gone from `package.json` and the lockfile); `npx tsc --noEmit` exit 0; `npx vitest run` 767 tests in 78 files, all passing; `npm run build` precaches 73 entries (10784.41 KiB) with five `INEFFECTIVE_DYNAMIC_IMPORT` notices; `npm run verify:static` passed; eslint over the whole project gives 53 errors and 10 warnings; `npm run notices` left `public/THIRD_PARTY_NOTICES.txt` identical to the shipped file (no diff at all: it was generated on 2026-10-24, the day it was run, so the date line also matched). **The full browser suite was run in the extract (port 4173 free, run detached, the turn kept open until its summary printed): 144 passed and 1 skipped (the large-scan test), 10.6 minutes, no failure.** The zip was then rebuilt once, after this paragraph was written; `diff -rq` of the working tree against the verified extract (leaving out `node_modules`, `dist`, `test-results` and `playwright-report`) must show this log as the only difference, and the result is recorded in the delivery message, not here.

### 2026-10-25 — checkpoint 23: the tooling update, `npm audit` from 8 findings to 0 (desktop Chromium only)

Asked by "okay, let's gooooo!", answering my proposal to take the advisories of checkpoint 22 as a checkpoint of their own. Done, each step checked before the next: `happy-dom` removed (nothing used it); `vitest` 4.1.12 and the transitive `undici`, `fast-uri`, `serialize-javascript` through `npm audit fix` without `--force`; `vite` 8.1.5 → 8.3.5 (pin kept); `zod` 3.25.76 → 4.6.7 with a sentence for a bad manifest instead of the validator's issue list. The details and reasoning are in `HANDOVER.md`, checkpoint 23 block, items 1 to 9; this entry records what was run.

**Ran and seen.** Baseline `npm audit`: 8 findings (1 low, 3 moderate, 4 high). After `happy-dom` and `vitest` and `npm audit fix`: 2 (`vite`, `zod`); after `vite`: 1; after `zod`: 0, and 0 with `--omit=dev`. Build output compared with the checkpoint-22 `dist/` by name, size and SHA-256 after each step: after the `happy-dom` and `vitest` step all 85 files **identical**; after `vite` 8.3.5, 84 files of which 22 differ (all hashed names, `sw.js`), the `epubcfi` chunk merged into `view`, one stylesheet rule changed (`.rounded-full` radius `3.40282e38px` → `2147483647px`; both compute to 3.35544e+07px in Chromium and render byte-identical screenshots of a circle, a pill and a tall pill), small chunks read in full (annotations, `0 | e` for `4294967295 & e`, braces, one `if`/`else` rewritten as a ternary in the `search` chunk, an empty-string prefix dropped from a `new URL(…).href`), large chunks (`index`, `pdf`, `es`, `djvu.worker`, `view`, `ocr.worker`) not read; compile target the same in both Vite versions (Chrome 111, Edge 111, Firefox 114, Safari 16.4, read in the two packages). Dev server on a spare port: `/` 200, `x.ngrok-free.app` 200, `evil.example.com` 403, `/@fs/etc/passwd` 403 (and `?raw`), three traversal paths answered with the app's `index.html` (no file text), app ready in Chromium with no console error. `vite.config.ts`: Vite 8.2 warns about the extensionless `./src/lib/theme-boot` import (native config loader); with `.ts` the warning is gone and `dist/` is byte-identical. `zod`: standalone minified size for the manifest schema, zod 3.25.76 56.6 KB (12.9 KB gzip), zod 4.6.7 70.0 KB (20.1 KB gzip); in the app the main script grew 904,883 → 915,723 bytes (precache 10781.88 → 10792.47 KiB). Before the fix, the toast for a zip from another app was zod 3's pretty-printed issue list (`invalid_enum_value`, `path`, …). `npx tsc --noEmit` 0 errors. `npx vitest run` 787 tests in 79 files, all passing (767 in 78 before; new `backup-manifest` 20). Lint 53 errors, 10 warnings (unchanged). `npm run build` 72 entries, 10792.47 KiB; `verify:static` passes; `npm run notices` 57 packages, `zod@4.6.7` in two places (the notices test failed on the old zod version after the upgrade until the file was regenerated, as it should). `npx playwright test --list` 146 tests in 21 files; the WebKit config lists 154. Full e2e on the Vite-only state: 144 passed, 1 skipped, 9.5 minutes. Full e2e on the final state: 145 passed, 1 skipped, 10.8 minutes (slower than the 9.5 of the Vite-only run, most likely because documents were being read and edited alongside it; the list is one spec longer).

**A flaky spec.** `a11y.spec.ts` › "safe-reading panel, link question and selection actions" failed in the first full run on the final source (no `alertdialog` after the click on the external link; book at 78%, where the link sits). Alone: 12 of 12 and 40 of 40 passed on the new build; on the saved checkpoint-22 `dist/` served with `vite preview --outDir` it failed 2 of 40 with the same signature, so it predates this checkpoint. Trace: the first two click attempts were blocked by the safe-reading panel still fading out, and the link's x changed between attempts (352, 870, 585). Reasoned cause: the click races the panel's exit and the reader's re-layout. The spec now waits for the panel to be gone and the link's box to hold still: 0 failures in 120 runs (40 on the new build, 80 on the old build). Consistent with the cause, not a proof of it.

**Breakages (11, each alone, all caught, `backup.ts` restored and compared with a saved copy after each).** Unit 10, on the final test file (the first eight were first run on an earlier version of it, before its "adds nothing" assertions, with the same result): the guard back to `parse()` (15 tests fail), the `folio` name dropped, a strict object, any app accepted, counts not required, the sentence changed, numbers coerced from text, the newer-version check removed, a failed manifest check that logs instead of stopping, a newer-version check that logs instead of stopping. Browser 1: the guard back to `parse()` fails the new backup spec; with the guard it passes.

**Found, not fixed.** A file that is not a zip at all reaches the toast with `fflate`'s own message (code-read, not tried in a browser). `zod` could be dropped altogether (about 70 KB, 20 KB gzip, off the main script); it is a design change and was not made. The `vite-tsconfig-paths` notice and the `::highlight(nawiri-hit)` stylesheet notice are still printed by every build. `npm ci` prints deprecation notices (not advisories) for `glob` 11.1.0 (via `vite-plugin-pwa` → `workbox-build`, build time only, already there before this checkpoint), `eslint` 9.39.5 and `tsconfck` 3.1.6 (via `vite-tsconfig-paths`).

**Not verified.** WebKit, Safari, an iPhone or any real touch screen (the new bundle ran in desktop Chromium only); the dev server through a real ngrok tunnel; the pill radius in Firefox and Safari; the large changed chunks beyond what the suites exercise; which Vite release closed which advisory (the GitHub advisory pages were not reachable, the release notes were read on a summary site, releasebot.io, and label nothing a security fix); that `npm audit` stays at 0.

**Working tree.** New: `tests/unit/backup-manifest.test.ts`. Changed: `package.json`, `package-lock.json`; `vite.config.ts` (the import's extension); `src/lib/backup.ts` (`safeParse`, the sentence); `tests/e2e/backup.spec.ts` (one spec), `tests/e2e/a11y.spec.ts` (the wait before the link click); `public/THIRD_PARTY_NOTICES.txt` (`zod@4.6.7`, date); `HANDOVER.md`, `roadmap.md`, `README.md`, `AGENTS.md`, `docs/audit-2026-10-19.md`.

**Clean extract of `nawiri-checkpoint-23.zip` (2026-10-25, same sandbox, desktop Chromium 141 only).** The zip was built from the working tree with `node_modules/`, `dist/`, `test-results/`, `playwright-report/` and `.git/` left out (341 entries, none of those; 340 in checkpoint 22, one added: `tests/unit/backup-manifest.test.ts`), extracted into an empty directory and run from there: `npm ci` exit 0 (12 s, 646 packages added, 0 vulnerabilities), `npx tsc --noEmit` 0 errors, `npx vitest run` 787 tests in 79 files, all passing, `npm run build` 72 entries, 10792.47 KiB, the same five notices, **its `dist/` byte-identical to the working tree's (84 files, compared by SHA-256)**, `npm run verify:static` passes, `npm run notices` rewrites the shipped file exactly (57 packages), lint 53 errors and 10 warnings, `npm audit` 0, `npx playwright test --list` 146 tests in 21 files, and the full e2e (port 4173 free, detached, the turn kept open until the summary printed): **145 passed, 1 skipped, 10.6 minutes**. The zip was rebuilt once before this run, after the deprecation notices (`glob`, `eslint`, `tsconfck`) were written into the documents; the first extract was discarded and this one is from the rebuilt zip. The zip delivered is the working tree with this paragraph added: `diff -rq` against the extract shows `futureplans.md` and nothing else.

### 2026-10-26 — checkpoint 24: the rename from Nawiri to Eviota (desktop Chromium only)

The owner chose **Eviota** (on GitHub only, no app stores). Changes, in `HANDOVER.md` checkpoint 24 in full: the brand generator now cuts an **E** out of the page (`E_CUT`, same construction as the old N: inset 64, top at y = 80, base at y = 256, 32-unit strokes; cap height 176 and wordmark weight 600 unchanged). Before the change the unchanged generator reproduced all 13 committed brand files byte for byte (fonts: `@fontsource-variable/inter-tight` 5.3.0 and the static `@fontsource/jetbrains-mono` 5.3.0 `latin-500`, fetched with `npm pack`). The new icons are smaller because the E has less ink: the precache fell from 10792.47 to 10785.94 KiB, the 6.9 KB being the icon PNGs and `favicon.ico`. Names changed in the package, the title and manifest, the licence copyright line, the UI, the notices header, the backup export (`eviota-<date>.eviota.zip`, `"app": "eviota"`), the notes export names, the test and environment identifiers, and the internal `__eviotaBench` and CSS names. Kept: every localStorage key that holds stored data (`nawiri-theme`, `nawiri-reader-settings`, the dismissal keys, `nawiri-lookup-consent`, `nawiri-lookup:`, `nawiri-tts-position:`), `folio-library`, the Workbox caches `nawiri-djvu` and `nawiri-vendor`, and every restore path for `.nawiri.zip`, `.folio.zip` and the `nawiri` / `folio` manifest values. Two things in `make-notices.mjs` were restored on purpose: the quoted issue title "Inquiry: Licensing Provenance & WASM Implementation for Nawiri Reader", and the sentence about the owner's screenshot, which now says the project was then called Nawiri.

**Checks.** `npx tsc --noEmit` 0 errors. `npx vitest run` **788 tests in 79 files, all passing** (787 before; the `it.each` in `backup-manifest.test.ts` makes two cases of the old one). The notices test pinned the old wording of the screenshot sentence and was updated to the new wording; the wording is the source of truth. `npx eslint .` 53 errors, 10 warnings (the baseline). `npx prettier --check .` fails only on `futureplans.md` (pre-existing). `npm run build` 72 precache entries; `npm run verify:static` passes; `npm run notices` 57 packages, 116,360 bytes. `npx playwright test --list`: 146 tests in 21 files. **Full e2e, desktop Chromium: 145 passed, 1 skipped, 9.5 minutes** (the skipped one needs `EVIOTA_LARGE_DJVU`). Mutations on `src/lib/backup.ts`, each restored and compared byte for byte: accept only `"eviota"` (3 unit tests fail), export `"nawiri"` (1 fails), sentence back to "Nawiri" (14 fail); all caught. A screenshot of the built app shows the new E lockup in the header and the new title, with no console errors.

**Not verified.** A phone, Safari or WebKit, a screen reader. The E was judged from renders and one screenshot. Trademark status of "Eviota": two general web searches on 2026-10-26 found no software of that name and showed that Eviota is a genus of small gobies (fish); no trademark search was done. The name NAWIRI had a pending US application (serial 98001451, filed 17 May 2023, software, class 9) found during the launch-readiness checks; the reason for the rename is not recorded.

**Clean extract of `eviota-checkpoint-24.zip` (2026-10-26, same sandbox, desktop Chromium 141 only).** The zip was built from the working tree with `node_modules/`, `dist/`, `test-results/` and `playwright-report/` left out: 341 entries, the same count as checkpoint 23, and the only file differences from it are the six `brand/` SVGs renamed from `nawiri-*` to `eviota-*`. Extracted into an empty directory, `npm ci` installed 646 packages (exit 0; the deprecation notices for `eslint` 9.39.5 are the ones checkpoint 23 recorded). There: `npx tsc --noEmit` 0 errors; `npx vitest run` **788 tests in 79 files, all passing**; `npm run build` 72 precache entries, 10785.94 KiB; `npm run verify:static` passes. This entry is the last one because it was written after the zip was built, as the entry for checkpoint 23 was.

### 2026-10-26 — follow-up: logo and name approved, AI-made covers replaced, AI names removed

The owner approved the logo (the E) and the name (Eviota). The owner then asked for the tags that named the generating tool to be removed completely and for no AI names to be left in the project. The three covers carried that tag (IPTC machine-generated-media type, credit naming the tool) and were PNG data under `.jpg` names. They were replaced, not stripped: removing the tag from generated images would hide where they came from. `scripts/covers/make_covers.py` draws the new covers from the Lora and Inter Tight outlines (OFL-1.1), in the brand's colours, at one title size; they are real JPEGs (848 × 1264) with no metadata segments. `bun scripts/make-samples.mjs` rebuilt the sample EPUBs: only `OEBPS/cover.jpg` differs in each, and the text entries are byte-identical.

**Checks.** `tests/unit/covers.test.ts` (6 tests, new) checks each cover is a JPEG with no EXIF, XMP or IPTC segment and that each sample's cover is the same file. `tests/unit/notices.test.ts`: the paragraph that described the old covers and their tags was replaced, and its tests now pin the new wording (the whitespace of the wrapped notice is normalised before comparing). `npm run notices` regenerated the file. The git history was rewritten to drop the old covers and the AI attribution lines from the commit message, because the commit had not been pushed.

**Not verified.** Whether the new covers are wanted as the app's look (they replace AI art; the owner may want other artwork). The rest of the list in the checkpoint 24 entry above still applies.

## 2026-10-27 — Checkpoint 25: reading-comfort pass

The owner asked for the app to be made perfect for reading comfort, checking whatever the sandbox can measure. The built app was measured, then the numbers that were wrong were fixed.

**Measured first (desktop Chromium; phone and 320 px emulated with touch).** Line length from the book's visible lines: desktop 69 characters median, phone 36, 320 px 28. Body text 17.1:1 in every theme. Axe (WCAG 2.2 AA) found the reader's secondary text failing in Sepia (3.52:1) and Dusk (4.45:1). Reader buttons 32 px on desktop and 40 px on phone; the progress slider 4 px tall; many drawer controls under 44 px on touch. Reduced motion stopped the 9 transitions it applies to. The book frame had no `@font-face` rules, so a book set in Lora used whatever serif the device had.

**Changed.** Secondary text: Sepia `#746853` (4.84:1), Dusk `#8A8A8A` (5.38:1). Touch: 44 px targets on coarse pointers for the reader chrome, the drawers, the sliders and the page field; mouse layouts unchanged. The book now receives the bundled Lora and Inter faces (`src/lib/book-fonts.ts`), and its policy allows `font-src 'self'`, the app's own origin only.

**Checks.** Typecheck 0 errors. `npx vitest run` 799 tests in 81 files, passing (5 new, `tests/unit/book-fonts.test.ts`). Lint 53 errors, 10 warnings (baseline). `npm run build` precaches 72 files; `npm run verify:static` passes. `npm run test:e2e` 145 passing, 1 skipped, 9.6 minutes. Measured after the changes: phone reader controls 0 of 8 under 44 px; drawers 0 under 44 px; sub-text contrast passes in all themes; the reader's axe scan clean in all themes; the book frame loads the Latin Lora face (200).

**Not verified.** Safari/WebKit (the `'self'` font source inside a book frame), a real phone's touch geometry, a device without Lora installed, a screen reader. The borders (1.24 to 1.49:1) and the dark-mode destructive colour (3.17:1) were not changed; see HANDOVER, "Decisions waiting on the owner".

## 2026-10-28 — Checkpoint 26: the pass before the first push

The owner asked for everything the sandbox can check to be fixed before the repository goes to GitHub. Nothing was pushed.

**Changed.** The shelf reserves the height of the region above the books while they load (`src/lib/shelf-top-height.ts`; the first-visit guess is 500 px on desktop and 721 px on a phone). Text-field borders reach 3:1 (app `--input` `#8a8a8a` in light and `#6b6b6b` in dark; a `control` colour per reader theme). Dark-mode destructive text is `#111111`. The HTML and text readers take the highlight tint from the resolved theme. The unused `eviota-range` utility is gone, and `vite-tsconfig-paths` is replaced by `resolve.tsconfigPaths`. Lint went from 53 errors to 0 with real types for the foliate-js declarations and the helpers.

**Checks.** Typecheck 0 errors. `npm test` 822 tests in 84 files, all passing. Lint 0 errors, 10 warnings. `npm run build` precaches 72 files (10789.51 KiB); `npm run verify:static` passes. `npm run test:e2e`: 151 passing, 1 skipped, in 10.7 minutes. Layout shift on load: empty first visit 0.2558 (desktop) and 0.5663 (phone) before, 0 after; a returning visit with a book 0.1137 and 0.1443 before, 0.0039 and 0.0000 after. The new shelf spec was run with the reserve switched off: all 12 runs failed.

**Not verified.** WebKit (its browser download fails in the sandbox), real phones, screen readers, and the GitHub Pages workflow, which has never run on GitHub.
