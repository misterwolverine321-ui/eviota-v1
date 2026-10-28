import { useTheme } from "@/lib/theme";
import { resolvePdfInvert, resolveReaderTheme } from "@/lib/reader-theme-resolve";
import { setReaderHighlightTheme } from "@/lib/reader-highlight";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { getFormatInfo } from "@/lib/formats";
import {
  availableTabs,
  DEFAULT_SETTINGS,
  getTheme,
  loadSettings,
  saveSettings,
  type DrawerTab,
  type NavApi,
  type ProgressUpdate,
  type ReaderSettings,
  type ReaderTheme,
  type RendererCaps,
} from "@/lib/reader-settings";
import { patchBook, putBookFile, type BookProgress, type BookRecord } from "@/lib/db";
import {
  afterDelete,
  afterMove,
  countPages,
  deletePages,
  downloadBlob,
  extractPages,
  flattenAnnotations,
  mergePdfs,
  movePage,
  remapAnchors,
  rotatePage,
  samePages,
  splitAt as splitPdfAt,
  withSuffix,
  type PageMapper,
} from "@/lib/pdf-ops";

import {
  anchorKey,
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  setAnchorCfi,
  updateAnnotation,
  type Annotation,
  type AnnotationColor,
  type AnnotationType,
  type SelectionEvent,
} from "@/lib/annotations";
import {
  ensureIndex,
  indexAnnotationText,
  indexAppendPages,
  indexDeletePage,
  indexMovePage,
  indexRotatePage,
  queryIndex,
  readIndex,
  type IndexStatus,
  type SearchIndexRecord,
} from "@/lib/search-index";
import { MAX_HITS } from "@/lib/search";
import { waitForIndexBuild } from "@/lib/search-wait";
import { classifyPageOpError } from "@/lib/page-op-errors";
import { cn } from "@/lib/utils";
import { SelectionPopover } from "./layers/selection-popover";
import { useImmersiveChrome } from "@/hooks/use-immersive-chrome";
import { useBottomSheet } from "@/hooks/use-mobile";
import { useReadingSession } from "@/hooks/use-reading-session";
import { useTts, type TtsController, type TtsSource } from "@/hooks/use-tts";
import { loadTtsPosition, saveTtsPosition, type TtsPosition } from "@/lib/tts";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { DefinitionCard, type DefineRequest } from "./layers/definition-card";
import { FoliateReader } from "./foliate-reader";
import { PdfReader } from "./pdf-reader";
import { TextReader } from "./text-reader";
import { HtmlReader } from "./html-reader";
import { ComicReader } from "./comic-reader";
import { DjvuReader } from "./djvu-reader";
import { BackLink } from "@/components/back-link";
import { ReaderDrawer, TAB_META } from "./reader-drawer";
import type { PageOpsApi } from "./drawer/pages-tab";
import type { FormsApi } from "./drawer/forms-tab";
import {
  fillFormFields,
  mergeValues,
  readFormFields,
  type FormField,
  type FormValues,
} from "@/lib/pdf-forms";
import { showSafeReadingButton } from "@/lib/safe-document";
import { useSafeReport } from "@/lib/safe-report";
import { ExternalLinkGuard, SafeReadingButton } from "./safe-reading";
import { RevealBand } from "./reveal-band";
import { IconButton } from "./ui";
import { useSettledValue } from "@/hooks/use-settled-value";

interface Props {
  book: BookRecord;
  file: Blob;
  /** Deep link (?q=): opens the search drawer with this query pre-run. */
  initialQuery?: string;
  /** Deep link (?page=): jumps to this page once the engine is ready. */
  initialPage?: number;
  /**
   * Deep link (?at=): with `initialPage` and `initialQuery`, the offset of the match inside that
   * page or section. Once the search has run, the result at that place is selected and the reader
   * brings it into view.
   */
  initialAt?: number;
}

const ENGINES = {
  foliate: FoliateReader,
  pdf: PdfReader,
  text: TextReader,
  html: HtmlReader,
  comic: ComicReader,
  djvu: DjvuReader,
} as const;

/**
 * Reader kernel.
 *
 * Owns settings, progress persistence, chrome, keyboard, and the single drawer.
 * Engines are dumb surfaces: they declare `RendererCaps`, expose a `NavApi`,
 * and emit progress. Every control here is gated on a declared capability.
 */
export function ReaderShell({ book, file, initialQuery, initialPage, initialAt }: Props) {
  const info = getFormatInfo(book.fileName);
  const kind = info?.kind ?? "unsupported";
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [caps, setCaps] = useState<RendererCaps>({});
  const [status, setStatus] = useState<ProgressUpdate>({
    fraction: book.progress?.fraction ?? 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  /** Live file blob: page ops rewrite it, so the engine reads from here. */
  const [localFile, setLocalFile] = useState<Blob>(file);
  /** Bumped after a page op so the engine remounts against the new blob. */
  const [engineKey, setEngineKey] = useState(0);
  const [busy, setBusy] = useState(false);
  /** Charset override for byte-decoding engines, persisted per book. */
  const [encoding, setEncoding] = useState<string | null>(book.encoding ?? null);
  /** Clean reading view for saved web pages, persisted per book. */
  const [cleanView, setCleanView] = useState<boolean>(book.cleanView ?? false);
  /** §6.4: OCR opt-in for image-only books (comics / scans), persisted per book. */
  const [ocrEnabled, setOcrEnabled] = useState<boolean>(book.ocrEnabled ?? false);
  /** Per-book sharp-zoom override; undefined follows the global. */
  const [sharpZoom, setSharpZoom] = useState<boolean | undefined>(book.sharpZoom);
  const [sharpAmount, setSharpAmount] = useState<number | undefined>(book.sharpAmount);
  /** Persisted search index for this book, once built. */
  const indexRef = useRef<SearchIndexRecord | null>(null);
  /** The build that fills `indexRef`, so a search can wait for it. */
  const indexBuildRef = useRef<Promise<void> | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus>("idle");
  /** Index build progress 0..1 — the OCR pass is slow enough to need a bar. */
  const [indexProgress, setIndexProgress] = useState(1);
  /** Latest page count, readable from callbacks without re-creating them. */
  const pageCountRef = useRef(0);
  /** Timestamp of the last keyboard page turn, for key-repeat coalescing. */
  const lastTurnRef = useRef(0);
  /** Latest annotations, readable from async op callbacks without staleness. */
  const annotationsRef = useRef<Annotation[]>(annotations);
  annotationsRef.current = annotations;

  /** Fillable fields read out of the current PDF (empty for other formats). */
  const [formFields, setFormFields] = useState<FormField[]>([]);
  /** Pending, unsaved answers keyed by field name. */
  const [formValues, setFormValues] = useState<FormValues>({});

  const navRef = useRef<NavApi | null>(null);
  /** Latest speech controller, readable from callbacks defined above it. */
  const ttsRef = useRef<TtsController | null>(null);

  /** Pending dictionary lookup, raised from the selection popover. */
  const [define, setDefine] = useState<DefineRequest | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard focus inside the bars keeps them on screen (no invisible focus).
  const [chromeFocused, setChromeFocused] = useState(false);
  const chrome = useImmersiveChrome(tab !== null || chromeFocused);
  const safeReport = useSafeReport();
  const sheet = useBottomSheet();
  /** Accrues active reading time for the library stats strip. */
  useWakeLock(true);
  const reportSession = useReadingSession(book.id, book.progress?.fraction ?? 0);

  useEffect(() => setSettings(loadSettings()), []);

  useEffect(() => {
    setLocalFile(file);
  }, [file]);

  /**
   * Read the PDF's AcroForm whenever the stored file changes. Non-PDFs and
   * PDFs without a form simply report no fields, and the Form tab stays hidden.
   */
  useEffect(() => {
    if (kind !== "pdf") {
      setFormFields([]);
      return undefined;
    }
    let cancelled = false;
    void readFormFields(localFile)
      .then((fields) => {
        if (!cancelled) {
          setFormFields(fields);
          setFormValues({});
        }
      })
      .catch(() => {
        if (!cancelled) setFormFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, localFile]);

  // The kernel owns annotation persistence; engines only emit anchors.
  useEffect(() => {
    let cancelled = false;
    void listAnnotations(book.id).then((rows) => {
      if (!cancelled) setAnnotations(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  const { resolved: appMode } = useTheme();
  const theme = getTheme(settings.theme, appMode);
  const resolvedTheme = resolveReaderTheme(settings.theme, appMode);
  const view = useMemo(
    () => ({ ...settings, pdfInvert: resolvePdfInvert(settings.pdfInvert, resolvedTheme) }),
    [settings, resolvedTheme],
  );
  useEffect(() => setReaderHighlightTheme(resolvedTheme), [resolvedTheme]);
  const tabs = useMemo(
    () => availableTabs({ ...caps, forms: formFields.length > 0 }),
    [caps, formFields],
  );

  /**
   * What the engine actually reads: the global settings with this book's
   * sharp-zoom override folded in.
   */
  const engineSettings = useMemo<ReaderSettings>(
    () => ({
      ...view,
      enhance: sharpZoom ?? settings.enhance,
      enhanceAmount: sharpAmount ?? settings.enhanceAmount,
    }),
    [view, settings, sharpZoom, sharpAmount],
  );

  const existing = useMemo(
    () =>
      selection?.existingId ? annotations.find((a) => a.id === selection.existingId) : undefined,
    [annotations, selection],
  );

  const upsert = (record: Annotation) =>
    setAnnotations((prev) => {
      const idx = prev.findIndex((a) => a.id === record.id);
      if (idx === -1) return [...prev, record];
      const next = [...prev];
      next[idx] = record;
      return next;
    });

  const applyMark = async (type: AnnotationType, color: AnnotationColor) => {
    if (!selection) return;
    if (existing) {
      const next = await updateAnnotation(existing.id, { type, color });
      if (next) upsert(next);
    } else {
      const record = await createAnnotation(book.id, {
        anchor: selection.anchor,
        type,
        color,
        text: selection.text || undefined,
        label: status.label,
      });
      upsert(record);
    }
    setSelection(null);
  };

  const applyNote = async (note: string, color: AnnotationColor) => {
    if (!selection) return;
    const body = note.trim() || undefined;
    if (existing) {
      const next = await updateAnnotation(existing.id, { note: body, color });
      if (next) upsert(next);
    } else {
      const record = await createAnnotation(book.id, {
        anchor: selection.anchor,
        type: "highlight",
        color,
        text: selection.text || undefined,
        note: body,
        label: status.label,
      });
      upsert(record);
    }
    setSelection(null);
  };

  const removeAnnotation = async (id: string) => {
    await deleteAnnotation(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setSelection((cur) => (cur?.existingId === id ? null : cur));
  };

  const patchAnnotation = async (id: string, patch: Partial<Annotation>) => {
    const next = await updateAnnotation(id, patch);
    if (next) upsert(next);
  };

  const toggleBookmark = async () => {
    const anchor = navRef.current?.currentAnchor?.();
    if (!anchor) return;
    const key = anchorKey(anchor);
    const hit = annotations.find((a) => a.type === "bookmark" && anchorKey(a.anchor) === key);
    if (hit) {
      await removeAnnotation(hit.id);
      return;
    }
    const record = await createAnnotation(book.id, {
      anchor,
      type: "bookmark",
      color: "yellow",
      label: status.label ?? `${Math.round((status.fraction ?? 0) * 100)}%`,
    });
    upsert(record);
  };

  const update = (patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  const openTab = (next: DrawerTab) => {
    if (!tabs.includes(next)) return;
    // Any drawer other than Display takes the reader's attention away from the
    // page, so speech pauses rather than talking over a browsing user.
    if (next !== "display") ttsRef.current?.pause();
    setTab((cur) => (cur === next ? null : next));
  };

  // --------------------------------------------------------- page ops ----

  /**
   * Push page-number changes into stored anchors after a rewrite op.
   *
   * Text anchors keep their offsets and re-heal on the new page; anchors whose
   * page no longer exists are flagged `orphaned` rather than deleted, so the
   * Notes tab can still show the passage.
   */
  const remapAnnotationPages = async (map: PageMapper) => {
    const patches = remapAnchors(annotationsRef.current, map);
    if (!patches.length) return;
    for (const { id, patch } of patches) {
      const next = await updateAnnotation(id, patch);
      if (next) upsert(next);
    }
  };

  /**
   * Run a page operation.
   *
   * `rewrite` ops produce a new file for this book: it lands in IndexedDB,
   * replaces the local blob and remounts the engine. `export` ops only
   * download, leaving the stored file untouched.
   */
  const runOp = async (
    label: string,
    op: (blob: Blob) => Promise<Blob | null>,
    mode: "rewrite" | "export" = "rewrite",
    reindex?: (next: Blob) => Promise<void>,
    remap?: PageMapper,
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const id = toast.loading(`${label}…`);
    /** Kept so a failed rewrite can roll the stored file back. */
    const previous = localFile;
    let wrote = false;
    try {
      const next = await op(previous);
      if (next && mode === "rewrite") {
        await putBookFile(book.id, next);
        wrote = true;
        setLocalFile(next);
        setEngineKey((k) => k + 1);
        if (remap) await remapAnnotationPages(remap).catch?.(() => {});
        try {
          await reindex?.(next);
          indexRef.current = (await readIndex(book.id)) ?? indexRef.current;
        } catch {
          // Index drift is recoverable: the next open rebuilds what's missing.
          indexRef.current = null;
        }
      }
      toast.success(label, { id });
    } catch (e) {
      const failure = classifyPageOpError(e);
      if (wrote) {
        // The blob landed but a later step failed — restore the original.
        await putBookFile(book.id, previous).catch(() => {});
        setLocalFile(previous);
        setEngineKey((k) => k + 1);
      }
      toast.error(failure.message, {
        id,
        description:
          failure.detail && failure.detail !== failure.message ? failure.detail : undefined,
        ...(failure.retryable
          ? {
              action: {
                label: "Retry",
                onClick: () => void runOp(label, op, mode, reindex, remap),
              },
            }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  };

  const pageOps: PageOpsApi = {
    busy,
    rotate: (page) =>
      void runOp(
        `Rotated page ${page}`,
        (blob) => rotatePage(blob, page, 90),
        "rewrite",
        () => indexRotatePage(book.id, page, 90),
        samePages,
      ),
    remove: (page) =>
      void runOp(
        `Deleted page ${page}`,
        (blob) => deletePages(blob, [page]),
        "rewrite",
        () => indexDeletePage(book.id, page),
        afterDelete([page]),
      ),
    move: (from, to) =>
      void runOp(
        `Moved page ${from} → ${to}`,
        (blob) => movePage(blob, from, to),
        "rewrite",
        () => indexMovePage(book.id, from, to),
        afterMove(from, to),
      ),

    extract: (page) =>
      void runOp(
        `Extracted page ${page}`,
        async (blob) => {
          const out = await extractPages(blob, [page]);
          downloadBlob(out, withSuffix(book.fileName, `-p${page}`));
          return null;
        },
        "export",
      ),
    splitAt: (page) =>
      void runOp(
        `Split after page ${page}`,
        async (blob) => {
          const [head, tail] = await splitPdfAt(blob, page);
          downloadBlob(head, withSuffix(book.fileName, `-1-${page}`));
          downloadBlob(tail, withSuffix(book.fileName, `-${page + 1}-end`));
          return null;
        },
        "export",
      ),
    merge: (extra) => {
      const before = pageCountRef.current;
      void runOp(
        extra.length > 1 ? `Merged ${extra.length} PDFs` : "Merged PDF",
        (blob) => mergePdfs(blob, extra),
        "rewrite",
        async (next) => {
          const after = await countPages(next);
          if (after > before) await indexAppendPages(book.id, after - before);
        },
        samePages,
      );
    },
    exportFlattened: () =>
      void runOp(
        "Exported annotated PDF",
        async (blob) => {
          const out = await flattenAnnotations(blob, annotations);
          downloadBlob(out, withSuffix(book.fileName, "-annotated"));
          return null;
        },
        "export",
      ),
  };

  const forms: FormsApi = {
    fields: formFields,
    values: formValues,
    busy,
    dirty: Object.keys(formValues).length > 0,
    onChange: (name, value) => setFormValues((prev) => ({ ...prev, [name]: value })),
    onReset: () => setFormValues({}),
    onSave: () =>
      void runOp("Saved form answers", (blob) =>
        fillFormFields(blob, mergeValues(formFields, formValues)),
      ),
    onSaveCopy: () =>
      void runOp(
        "Saved a filled copy",
        async (blob) => {
          const out = await fillFormFields(blob, mergeValues(formFields, formValues), {
            flatten: true,
          });
          downloadBlob(out, withSuffix(book.fileName, "-filled"));
          return null;
        },
        "export",
      ),
  };

  // --------------------------------------------------- search index ----

  /**
   * Build (or top up) the persisted search index once the engine is ready.
   * Extraction is the engine's job; scheduling and persistence are ours.
   * Engines without `extractPageText` keep using live search only.
   */
  useEffect(() => {
    // Paged engines index by page; foliate indexes by section (`indexUnits`).
    const total = caps.pageCount ?? caps.indexUnits ?? 0;
    if (!caps.search || total < 1) return;

    const controller = new AbortController();
    // Kept, so a search typed while the index is still being built can wait for it (see `runSearch`).
    indexBuildRef.current = (async () => {
      // onReady fires before the engine installs its NavApi — wait for it.
      for (
        let i = 0;
        i < 40 && !(navRef.current?.extractIndexText ?? navRef.current?.extractPageText);
        i++
      ) {
        if (controller.signal.aborted) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      const extract = navRef.current?.extractIndexText ?? navRef.current?.extractPageText;
      if (!extract || controller.signal.aborted) return;
      try {
        const record = await ensureIndex({
          bookId: book.id,
          pageCount: total,
          extract: (page) => extract(page),
          ...(caps.indexKey !== undefined ? { signature: caps.indexKey } : {}),
          ...(navRef.current?.unitLabel
            ? { label: (page: number) => navRef.current?.unitLabel?.(page) ?? "" }
            : {}),
          signal: controller.signal,

          onProgress: (p) => {
            setIndexStatus(p.status);
            setIndexProgress(p.total > 0 ? p.done / p.total : 1);
          },
        });
        if (!controller.signal.aborted) indexRef.current = record;
      } catch {
        indexRef.current = null;
        setIndexStatus("failed");
      }
    })();
    return () => controller.abort();
  }, [book.id, caps.search, caps.pageCount, caps.indexUnits, caps.indexKey, engineKey, ocrEnabled]);

  // Annotation text is searchable: a note edit re-tokenizes just its page.
  useEffect(() => {
    if (!caps.search || !indexRef.current) return;
    const byPage = new Map<number, string[]>();
    for (const a of annotations) {
      if (a.anchor.kind !== "rect") continue;
      const parts = byPage.get(a.anchor.page) ?? [];
      if (a.text) parts.push(a.text);
      if (a.note) parts.push(a.note);
      byPage.set(a.anchor.page, parts);
    }
    if (!byPage.size) return;
    const timer = setTimeout(() => {
      void (async () => {
        await indexAnnotationText(
          book.id,
          [...byPage].map(([page, parts]) => ({ page, text: parts.join(" ") })),
        );
        indexRef.current = (await readIndex(book.id)) ?? indexRef.current;
      })();
    }, 600);
    return () => clearTimeout(timer);
  }, [annotations, caps.search, book.id]);

  /**
   * Search routing: the index answers instantly when it's ready and complete;
   * anything else (no index, still building, zero hits with pages pending)
   * falls back to the engine's live pass.
   */
  const runSearch = async (query: string, run: Parameters<NonNullable<NavApi["search"]>>[1]) => {
    let record = indexRef.current;
    // A reader with no live search of its own (a DjVu scan, a comic) has nothing to answer with
    // until its index is built, so the query waits for the build and is then answered from it. It
    // used to come back with "No results" that stayed on screen until the search happened to run
    // again.
    if (!navRef.current?.search && !(record && record.status === "ready")) {
      await waitForIndexBuild(() => indexBuildRef.current, run.signal);
      if (run.signal.aborted) return;
      record = indexRef.current;
    }
    const options = run.options ?? {
      matchCase: settings.matchCase,
      wholeWord: settings.wholeWord,
    };
    const scoped = { ...run, options };
    // An index built from other text than the engine now shows (another encoding was chosen; the
    // HTML reader's extracted article) is not searched: its offsets point at text that is not there.
    const describesView =
      (caps.indexKey === undefined || record?.signature === caps.indexKey) &&
      navRef.current?.indexUsable?.() !== false;
    if (record && record.status === "ready" && describesView) {
      try {
        const hits = await queryIndex(record, query, { limit: MAX_HITS, ...options });
        if (!run.signal.aborted) {
          run.onProgress(1);
          if (hits.length) run.onHits(hits);
        }
        if (hits.length || !record.pending.length) return;
      } catch {
        /* fall through to live search */
      }
    }
    await (navRef.current?.search?.(query, scoped) ?? Promise.resolve());
  };

  const renderThumbnail = caps.thumbnails
    ? (page: number, width: number) =>
        navRef.current?.renderThumbnail?.(page, width) ?? Promise.resolve(null)
    : undefined;

  // persist progress (debounced)
  const handleProgress = (p: ProgressUpdate) => {
    setStatus(p);
    reportSession(p.fraction, p.page);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const progress: BookProgress = {
        kind: p.cfi ? "cfi" : p.page ? "page" : "fraction",
        fraction: p.fraction,
        updatedAt: Date.now(),
        ...(p.cfi ? { cfi: p.cfi } : {}),
        ...(p.page ? { page: p.page } : {}),
      };
      void patchBook(book.id, { progress, lastOpenedAt: Date.now() });
    }, 700);
  };

  useEffect(() => {
    void patchBook(book.id, { lastOpenedAt: Date.now() });
  }, [book.id]);

  // Close the drawer if the active engine stops supporting its tab.
  useEffect(() => {
    setTab((cur) => (cur && !tabs.includes(cur) ? null : cur));
  }, [tabs]);

  // Deep link (?q=): open the search drawer once the engine supports search.
  const initialQueryRef = useRef(initialQuery?.trim() || null);
  useEffect(() => {
    if (!initialQueryRef.current || !tabs.includes("search")) return;
    initialQueryRef.current = null;
    setTab("search");
  }, [tabs]);

  // Deep link (?page=&at=): the place of the match the shelf listed. The search tab takes it once
  // its first run is over and selects the result there (see `SearchTab`'s `takeDeepHit`).
  const deepHitRef = useRef<{ page: number; at: number } | null>(
    initialPage != null && initialAt != null && initialQuery?.trim()
      ? { page: initialPage, at: initialAt }
      : null,
  );
  const takeDeepHit = useCallback(() => {
    const hit = deepHitRef.current;
    deepHitRef.current = null;
    return hit;
  }, []);

  // Deep link (?page=): jump once the engine installs its NavApi.
  const initialPageRef = useRef(initialPage ?? null);
  useEffect(() => {
    if (initialPageRef.current == null) return undefined;
    const controller = new AbortController();
    void (async () => {
      for (let i = 0; i < 100 && !navRef.current?.goToPage; i++) {
        if (controller.signal.aborted) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (controller.signal.aborted || initialPageRef.current == null) return;
      const target = initialPageRef.current;
      initialPageRef.current = null;
      navRef.current?.goToPage?.(target);
    })();
    return () => controller.abort();
  }, [engineKey]);

  // keyboard map — navigation stays immersive, everything else reveals chrome
  useEffect(() => {
    const NAV_KEYS = new Set(["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " ", "Home", "End"]);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && tabs.includes("search")) {
        e.preventDefault();
        chrome.show();
        openTab("search");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable))
        return;
      const nav = navRef.current;

      if (e.key === "Escape") {
        if (selection) setSelection(null);
        else if (tab) setTab(null);
        else chrome.toggle();
        return;
      }

      // While a drawer is open its own lists own the arrow keys.
      if (tab && NAV_KEYS.has(e.key)) return;

      if (NAV_KEYS.has(e.key)) {
        e.preventDefault();
        // Holding an arrow key would queue far more turns than the engine can
        // animate; coalesce repeats to one turn per frame budget.
        const now = performance.now();
        if (e.repeat && now - lastTurnRef.current < 140) return;
        lastTurnRef.current = now;

        // Manga (RTL) comics read right-to-left: the left key moves forward.
        const flip = !!settings.manga && !!caps.rtl;
        const forwardKey = e.key === "ArrowRight" ? !flip : e.key === "ArrowLeft" ? flip : null;

        if (forwardKey !== null) (forwardKey ? nav?.next : nav?.prev)?.();
        else if (e.key === "PageDown") nav?.next();
        else if (e.key === "PageUp") nav?.prev();
        else if (e.key === "Home") nav?.goToFraction?.(0);
        else if (e.key === "End") nav?.goToFraction?.(1);
        else if (e.shiftKey) nav?.prev();
        else nav?.next();

        chrome.keepHidden();
        return;
      }

      chrome.show();

      if (e.key === "+" || e.key === "=") {
        if (caps.zoom)
          update({
            pdfScale: settings.pdfScale === "fit" ? 1.25 : Math.min(4, settings.pdfScale + 0.15),
          });
      } else if (e.key === "-") {
        if (caps.zoom)
          update({
            pdfScale: settings.pdfScale === "fit" ? 0.9 : Math.max(0.4, settings.pdfScale - 0.15),
          });
      } else if (e.key.toLowerCase() === "b") {
        if (caps.annotations) void toggleBookmark();
      } else {
        const hit = (Object.keys(TAB_META) as DrawerTab[]).find(
          (t) => TAB_META[t].key === e.key.toLowerCase(),
        );
        if (hit) openTab(hit);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    tabs,
    caps.zoom,
    caps.annotations,
    caps.rtl,
    settings.manga,
    settings.pdfScale,
    chrome.show,
    chrome.toggle,
    chrome.keepHidden,
    selection,
    annotations,
    status.label,
  ]);

  const Engine = kind in ENGINES ? ENGINES[kind as keyof typeof ENGINES] : null;
  const pct = Math.round((status.fraction ?? 0) * 100);
  const progressText = status.label ?? `${pct}%`;
  const spokenProgress = useSettledValue(progressText, 1200);
  const pageCount = caps.pageCount ?? status.totalPages ?? 0;
  pageCountRef.current = pageCount;
  const currentPage = status.page ?? 1;

  // ------------------------------------------------- read aloud / scroll ----

  /**
   * Speech reads whole units (a page, a section, or the single document) and
   * asks the engine to follow along as it rolls forward.
   */
  const ttsSource = useMemo<TtsSource>(
    () => ({
      unit: currentPage,
      unitCount: Math.max(1, pageCount || 1),
      getText: async (unit) => (await navRef.current?.extractPageText?.(unit)) ?? "",
      goToUnit: (unit) => navRef.current?.goToPage?.(unit),
      lang: caps.language ?? null,
    }),
    [currentPage, pageCount, caps.language],
  );

  /** Stored resume point, read once so a later save can't restart the session. */
  const restoreRef = useRef<TtsPosition | null | undefined>(undefined);
  if (restoreRef.current === undefined) restoreRef.current = loadTtsPosition(book.id);

  const tts = useTts({
    rate: settings.ttsRate,
    voiceName: settings.ttsVoice,
    source: ttsSource,
    restore: restoreRef.current,
    onPosition: (p) => saveTtsPosition(book.id, p),
  });
  ttsRef.current = tts;

  // Paint the sentence being spoken inside whichever engine is mounted.
  useEffect(() => {
    navRef.current?.highlightSpoken?.(tts.active ? tts.caption : null);
  }, [tts.active, tts.caption]);

  useEffect(
    () => () => {
      navRef.current?.highlightSpoken?.(null);
    },
    [],
  );

  const autoScroll = useAutoScroll({
    speed: settings.autoScrollSpeed,
    scrollBy: (px) => navRef.current?.scrollByPixels?.(px),
    enabled: !!caps.autoScroll,
  });

  // Read-aloud only makes sense while this engine can hand us text.
  const ttsActive = !!caps.tts && tts.active;

  // Center tap toggles chrome; edge taps are the engine's own business.
  const handleSurfaceTap = (x: number) => {
    if (selection) {
      setSelection(null);
      return;
    }
    if (tab) return;
    if (x > 0.3 && x < 0.7) chrome.toggle();
  };
  const onSurfacePointerDown = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    handleSurfaceTap((e.clientX - rect.left) / rect.width);
  };

  return (
    <div
      // h-screen is 100vh, which on iPhone is taller than the visible area while
      // Safari's toolbar shows, so the bottom bar sat behind it. 100dvh follows
      // the visible area; browsers without dvh ignore the inline value and keep h-screen.
      className="relative h-screen overflow-hidden"
      style={{ background: theme.bg, color: theme.ink, height: "100dvh" }}
    >
      {/* reading surface — full bleed, chrome floats over it */}
      <main className="absolute inset-0" onPointerDown={onSurfacePointerDown}>
        {error ? (
          <Fallback title="Couldn't open this file" body={error} book={book} file={localFile} />
        ) : Engine ? (
          <Engine
            key={engineKey}
            file={localFile}
            fileName={book.fileName}
            settings={engineSettings}
            theme={theme}
            progress={book.progress ?? null}
            onReady={setCaps}

            onProgress={handleProgress}
            onError={setError}
            navRef={navRef}
            annotations={annotations}
            onSelection={setSelection}
            onSurfaceTap={handleSurfaceTap}
            onOrphanChange={(id, orphaned) => void patchAnnotation(id, { orphaned })}
            onAnchorCfi={(id, cfi) =>
              void setAnchorCfi(id, cfi).then((next) => next && upsert(next))
            }

            onZoom={(scale) => update({ pdfScale: scale })}
            encoding={encoding}
            cleanView={cleanView}
            ocrEnabled={ocrEnabled}
          />
        ) : (
          <Fallback
            title={`${info?.label ?? "This format"} isn't rendered in-app yet`}
            body="Eviota recognizes this file and keeps it safely in your library. Download it to open in a dedicated viewer."
            book={book}
            file={localFile}
          />
        )}
      </main>

      {/* A tap anywhere along the top edge brings the bars back. Without it the bars
          came back only from a tap in the middle 40% of the screen. */}
      <RevealBand
        active={!chrome.visible && tab === null}
        onReveal={chrome.show}
        color={theme.ink}
      />

      {/* top chrome */}
      <header
        className={cn(
          "absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-1.5 border-b px-3 backdrop-blur-sm transition-transform duration-200 sm:gap-3 sm:px-5",
          !chrome.visible && "-translate-y-full",
        )}
        onPointerDownCapture={chrome.show}
        onFocusCapture={(e) => {
          if (!(e.target as HTMLElement).matches(":focus-visible")) return;
          setChromeFocused(true);
          chrome.show();
        }}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setChromeFocused(false);
        }}
        style={{ background: `${theme.bg}f2`, borderColor: theme.line }}
      >
        <BackLink
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-signal pointer-fine:h-8 pointer-fine:w-8"
          aria-label="Back to library"
        >
          <ArrowLeft className="h-4 w-4" />
        </BackLink>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium tracking-tight">{book.title}</h1>
          <p
            className="truncate font-mono text-[11px] tracking-[0.14em] uppercase"
            style={{ color: theme.sub }}
          >
            {info?.label ?? book.format} · {book.author}
          </p>
        </div>
        {showSafeReadingButton(info?.kind, safeReport) && <SafeReadingButton />}
        {tabs.map((t) => {
          const Icon = TAB_META[t].icon;
          return (
            <IconButton
              key={t}
              active={tab === t}
              onClick={() => openTab(t)}
              label={TAB_META[t].label}
            >
              <Icon className="h-4 w-4" />
            </IconButton>
          );
        })}
      </header>

      {/* bottom chrome — shape adapts to the engine */}
      <nav
        aria-label="Reading controls"
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex h-12 items-center gap-3 border-t backdrop-blur-sm transition-transform duration-200 px-3 sm:px-5",
          !chrome.visible && "translate-y-full",
        )}
        onPointerDownCapture={chrome.show}
        onFocusCapture={(e) => {
          if (!(e.target as HTMLElement).matches(":focus-visible")) return;
          setChromeFocused(true);
          chrome.show();
        }}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setChromeFocused(false);
        }}
        style={{ background: `${theme.bg}f2`, borderColor: theme.line }}
      >
        <IconButton onClick={() => navRef.current?.prev()} label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </IconButton>

        {pageCount > 1 && caps.paged ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              type="number"
              min={1}
              max={pageCount}
              value={currentPage}
              onChange={(e) => {
                const page = Number(e.target.value);
                if (page >= 1 && page <= pageCount) navRef.current?.goToPage?.(page);
              }}
              className="h-11 w-16 shrink-0 rounded-[3px] border bg-transparent px-2 font-mono text-[11px] tabular-nums outline-none pointer-fine:h-7"
              style={{ borderColor: theme.control }}
              aria-label="Go to page"
            />
            <input
              type="range"
              min={1}
              max={pageCount}
              value={Math.min(currentPage, pageCount)}
              onChange={(e) => navRef.current?.goToPage?.(Number(e.target.value))}
              className="accent-signal h-11 min-w-0 flex-1 cursor-pointer"
              aria-label="Page position"
              aria-valuetext={`Page ${Math.min(currentPage, pageCount)} of ${pageCount}`}
            />
          </div>
        ) : (
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((status.fraction ?? 0) * 1000)}
            onChange={(e) => navRef.current?.goToFraction?.(Number(e.target.value) / 1000)}
            className="accent-signal h-11 min-w-0 flex-1 cursor-pointer"
            aria-label="Reading position"
            aria-valuetext={`${pct}% read`}
          />
        )}

        <span
          aria-hidden="true"
          className="w-24 shrink-0 text-right font-mono text-[11px] tracking-[0.14em] uppercase"
          style={{ color: theme.sub }}
        >
          {caps.spread && settings.spread ? "SPREAD · " : ""}
          {progressText}
        </span>
        {/* Progress changes many times a second while a page scrolls; speak it once, when it has
            settled. */}
        <span role="status" className="sr-only">
          {spokenProgress}
        </span>
        <IconButton onClick={() => navRef.current?.next()} label="Next page">
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </nav>

      <ExternalLinkGuard />

      {selection && caps.annotations && (
        <SelectionPopover
          selection={selection}
          existing={existing}
          theme={theme}
          bookTitle={book.title}
          onMark={(type, color) => void applyMark(type, color)}
          onNote={(note, color) => void applyNote(note, color)}
          onDelete={() => {
            if (existing) void removeAnnotation(existing.id);
            else setSelection(null);
          }}
          onDefine={
            selection.text?.trim()
              ? () => {
                  setDefine({ term: selection.text.trim(), rect: selection.rect });
                  setSelection(null);
                }
              : undefined
          }
          onDismiss={() => setSelection(null)}
        />
      )}

      {define && (
        <DefinitionCard
          request={define}
          lang={caps.language ?? null}
          theme={theme}
          onDismiss={() => setDefine(null)}
        />
      )}

      {/* Read-aloud state for a screen reader. The caption below is the sentence being spoken, so it
          is hidden from assistive technology: a live region on it would read the same words over
          the synthetic voice, sentence after sentence. */}
      <span role="status" className="sr-only">
        {ttsActive ? (tts.paused ? "Paused" : tts.loading ? "Loading text" : "Reading aloud") : ""}
      </span>

      {ttsActive && (
        <div
          className="absolute inset-x-0 z-20 flex justify-center px-3"
          style={{ bottom: chrome.visible ? 60 : 16 }}
        >
          <div
            className="anim-rise max-w-xl rounded-[4px] border px-3 py-2 shadow-lg"
            style={{ background: `${theme.bg}f2`, borderColor: theme.line }}
            aria-hidden="true"
          >
            <p
              className="font-mono text-[11px] tracking-[0.16em] uppercase"
              style={{ color: theme.sub }}
            >
              {tts.paused ? "Paused" : "Reading aloud"} · {Math.round(tts.progress * 100)}%
            </p>
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed">
              {tts.caption ?? (tts.loading ? "Loading text…" : "")}
            </p>
          </div>
        </div>
      )}

      {tab && (
        <ReaderDrawer
          tab={tab}
          tabs={tabs}
          onTab={setTab}
          onClose={() => setTab(null)}
          caps={caps}
          onEncoding={(label) => {
            setEncoding(label);
            void patchBook(book.id, { encoding: label });
          }}
          cleanView={cleanView}
          onCleanView={(next) => {
            setCleanView(next);
            void patchBook(book.id, { cleanView: next });
          }}
          sharpZoom={sharpZoom}
          onSharpZoom={
            caps.imageAdjust && caps.rtl
              ? (next) => {
                  setSharpZoom(next);
                  void patchBook(book.id, { sharpZoom: next });
                }
              : undefined
          }
          sharpAmount={sharpAmount}
          onSharpAmount={
            caps.imageAdjust && caps.rtl
              ? (next) => {
                  setSharpAmount(next);
                  void patchBook(book.id, { sharpAmount: next });
                }
              : undefined
          }
          ocrEnabled={ocrEnabled}
          onOcrEnabled={(next) => {
            setOcrEnabled(next);
            if (!next) setIndexStatus("idle");
            void patchBook(book.id, { ocrEnabled: next });
          }}
          settings={view}
          theme={theme}
          update={update}
          currentPage={currentPage}
          onNavigate={(href) => {
            navRef.current?.goTo?.(href);
            setTab(null);
          }}
          onGoToPage={(page) => navRef.current?.goToPage?.(page)}
          annotations={annotations}
          onJumpAnnotation={(a) => {
            navRef.current?.goToAnchor?.(a.anchor);
            setTab(null);
          }}
          onSearch={(query, run) => runSearch(query, run)}
          matchCase={settings.matchCase}
          wholeWord={settings.wholeWord}
          indexStatus={indexStatus}
          indexProgress={indexProgress}
          indexKind={caps.ocr ? "ocr" : "text"}
          searchInitialQuery={initialQuery}
          searchTakeDeepHit={takeDeepHit}
          onClearSearch={() => navRef.current?.clearSearch?.()}
          onJumpHit={(hit) => {
            navRef.current?.goToHit?.(hit);
            // A bottom sheet covers the page, so it steps aside once the jump is made.
            if (sheet) setTab(null);
          }}
          onUpdateAnnotation={(id, patch) => void patchAnnotation(id, patch)}
          onDeleteAnnotation={(id) => void removeAnnotation(id)}
          exportBook={{
            id: book.id,
            title: book.title,
            author: book.author,
            format: book.format,
            fileName: book.fileName,
          }}
          renderThumbnail={renderThumbnail}
          pageOps={pageOps}
          pagesRevision={engineKey}
          forms={formFields.length > 0 ? forms : undefined}
          tts={caps.tts ? tts : undefined}
          autoScroll={caps.autoScroll ? autoScroll : undefined}
        />
      )}
    </div>
  );
}

function Fallback({
  title,
  body,
  book,
  file,
}: {
  title: string;
  body: string;
  book: BookRecord;
  file: Blob;
}) {
  const download = () => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = book.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm opacity-70">{body}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={download}
            className="bg-signal text-signal-foreground rounded-[3px] px-4 py-2 text-sm font-medium"
          >
            Download file
          </button>
          <Link
            to="/"
            className="rounded-[3px] border border-current/20 px-4 py-2 text-sm font-medium"
          >
            Back to library
          </Link>
        </div>
      </div>
    </div>
  );
}

export type { ReaderTheme };
