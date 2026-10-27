import { useEffect, useId, useRef, useState } from "react";
import {
  BookmarkIcon,
  ClipboardList,
  List,
  ListOrdered,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  X,
} from "lucide-react";
import type { Annotation } from "@/lib/annotations";
import {
  type DrawerTab,
  type ReaderSettings,
  type ReaderTheme,
  type RendererCaps,
  type SearchHit,
  type SearchRun,
} from "@/lib/reader-settings";
import { cn } from "@/lib/utils";
import { useBottomSheet } from "@/hooks/use-mobile";
import { TocTab } from "./drawer/toc-tab";
import { IndexTab } from "./drawer/index-tab";
import { DisplayTab } from "./drawer/display-tab";
import { PagesTab, type PageOpsApi } from "./drawer/pages-tab";
import type { AutoScrollApi, ReadAloudApi } from "./drawer/display-tab";
import { NotesTab } from "./drawer/notes-tab";
import { FormsTab, type FormsApi } from "./drawer/forms-tab";
import { SearchTab } from "./drawer/search-tab";
import type { IndexStatus } from "@/lib/search-index";
import type { ExportBook } from "@/lib/annotation-export";

export const TAB_META: Record<DrawerTab, { label: string; icon: typeof List; key: string }> = {
  toc: { label: "Contents", icon: List, key: "t" },
  index: { label: "Index", icon: ListOrdered, key: "i" },
  notes: { label: "Notes", icon: BookmarkIcon, key: "n" },
  search: { label: "Search", icon: Search, key: "f" },
  display: { label: "Display", icon: SlidersHorizontal, key: "d" },
  pages: { label: "Pages", icon: LayoutGrid, key: "g" },
  forms: { label: "Form", icon: ClipboardList, key: "m" },
};

/**
 * The one drawer. Five tabs, never stacked panels.
 * Desktop: 300px right rail. Mobile: bottom sheet with a drag handle.
 */
export function ReaderDrawer({
  tab,
  tabs,
  onTab,
  onClose,
  caps,
  settings,
  theme,
  update,
  currentPage,
  onNavigate,
  onGoToPage,
  annotations,
  onJumpAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  exportBook,
  onSearch,
  onClearSearch,
  onJumpHit,
  matchCase,
  wholeWord,
  renderThumbnail,
  pageOps,
  pagesRevision,
  indexStatus,
  searchInitialQuery,
  searchTakeDeepHit,
  onEncoding,
  cleanView,
  onCleanView,
  ocrEnabled,
  onOcrEnabled,
  sharpZoom,
  onSharpZoom,
  sharpAmount,
  onSharpAmount,
  indexProgress,
  indexKind,
  tts,
  autoScroll,
  forms,
}: {
  tab: DrawerTab;
  tabs: DrawerTab[];
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
  caps: RendererCaps;
  settings: ReaderSettings;
  theme: ReaderTheme;
  update: (patch: Partial<ReaderSettings>) => void;
  currentPage: number;
  onNavigate: (href: string) => void;
  onGoToPage: (page: number) => void;
  annotations: Annotation[];
  onJumpAnnotation: (a: Annotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  /** The open book, for naming and labelling exported notes. */
  exportBook?: ExportBook;
  onSearch: (query: string, run: SearchRun) => Promise<void>;
  onClearSearch: () => void;
  onJumpHit: (hit: SearchHit) => void;
  /** Search matching mode (persisted in reader settings). */
  matchCase: boolean;
  wholeWord: boolean;
  /** Engine-provided page preview renderer (Phase 4 thumbnails). */
  renderThumbnail?: (page: number, width: number) => Promise<string | null>;
  /** Page management handlers, present only when the engine declares pageOps. */
  pageOps?: PageOpsApi;
  /** Bumped when the file is rewritten, so cached thumbnails are dropped. */
  pagesRevision?: number;
  /** Search-index build state, surfaced in the search tab. */
  indexStatus?: IndexStatus;
  /** Deep-linked query (?q=): seeds the search tab's input on first open. */
  searchInitialQuery?: string;
  /** Hands the search tab the place of the shelf hit that opened the book, once (see `SearchTab`). */
  searchTakeDeepHit?: () => { page: number; at: number } | null;
  /** Phase 6.1: force a charset on the decoded source (text engine). */
  onEncoding?: (label: string) => void;
  /** Phase 6.2: whether the HTML engine is showing the extracted article. */
  cleanView?: boolean;
  onCleanView?: (next: boolean) => void;
  /** §6.4: per-book OCR opt-in for image-only engines. */
  ocrEnabled?: boolean;
  onOcrEnabled?: (next: boolean) => void;
  /** Phase 15.5: per-book sharp-zoom override for image books. */
  sharpZoom?: boolean;
  onSharpZoom?: (next: boolean | undefined) => void;
  sharpAmount?: number;
  onSharpAmount?: (next: number | undefined) => void;
  /** Index build progress 0..1, surfaced while OCR grinds through pages. */
  indexProgress?: number;
  /** Whether the index is fed by a text layer or by OCR. */
  indexKind?: "text" | "ocr";
  /** Phase 12: read-aloud controls, surfaced in the Display tab. */
  tts?: ReadAloudApi;
  /** Phase 12: auto-scroll controls, surfaced in the Display tab. */
  autoScroll?: AutoScrollApi;
  /** PDF form filling, present only when the document carries an AcroForm. */
  forms?: FormsApi;
}) {
  const sheet = useBottomSheet();
  const panelRef = useRef<HTMLElement | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const tabId = (t: DrawerTab) => `${baseId}-tab-${t}`;
  const panelId = `${baseId}-panel`;
  const titleId = `${baseId}-title`;

  // Manual activation: the arrow keys move focus along the tabs and Enter or Space opens one, so
  // a tab whose panel takes focus (Search puts the cursor in its field) cannot pull the keyboard
  // away in the middle of an arrow-key walk.
  const [roving, setRoving] = useState<DrawerTab>(tab);
  useEffect(() => setRoving(tab), [tab]);

  /** Arrow keys, Home and End move focus between the tabs. */
  const onTabKeyDown = (e: React.KeyboardEvent, from: number) => {
    const last = tabs.length - 1;
    const target =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? from === last
          ? 0
          : from + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? from === 0
            ? last
            : from - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (target < 0) return;
    e.preventDefault();
    tabListRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
  };

  /**
   * The drawer is a dialog: focus moves in on open, cycles inside it while it's
   * open, and returns to whatever opened it on close.
   */
  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href]:not([tabindex="-1"]),button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),textarea:not([tabindex="-1"]),select:not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel) return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener && document.body.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <aside
      ref={panelRef}
      className={cn(
        "anim-rise absolute z-30 flex flex-col shadow-xl",
        sheet
          ? "inset-x-0 bottom-0 max-h-[72vh] rounded-t-xl border-t"
          : "top-0 right-0 bottom-0 w-[300px] max-w-[85vw] border-l",
      )}
      style={{ background: theme.bg, borderColor: theme.line }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {sheet && (
        <div className="flex justify-center pt-2">
          <span className="h-1 w-10 rounded-full" style={{ background: theme.line }} />
        </div>
      )}

      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-2"
        style={{ borderColor: theme.line }}
      >
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="Reader panels"
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          {tabs.map((t, i) => {
            const Icon = TAB_META[t].icon;
            return (
              <button
                key={t}
                id={tabId(t)}
                type="button"
                role="tab"
                aria-selected={t === tab}
                aria-controls={panelId}
                tabIndex={t === roving ? 0 : -1}
                onClick={() => onTab(t)}
                onFocus={() => setRoving(t)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                aria-label={TAB_META[t].label}
                title={TAB_META[t].label}
                className={cn(
                  "flex h-8 flex-1 items-center justify-center rounded-[3px] transition-colors pointer-coarse:h-11",
                  t === tab ? "bg-signal text-signal-foreground" : "hover:bg-foreground/5",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          className="flex h-8 w-8 items-center justify-center rounded-[3px] hover:bg-foreground/5 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto p-4 outline-none"
      >
        <h2
          id={titleId}
          className="mb-4 font-mono text-[11px] font-normal tracking-[0.2em] uppercase"
          style={{ color: theme.sub }}
        >
          {TAB_META[tab].label}
        </h2>

        {tab === "toc" && <TocTab toc={caps.toc ?? []} onNavigate={onNavigate} theme={theme} />}
        {tab === "index" && (
          <IndexTab keywords={caps.keywords ?? []} onNavigate={onNavigate} theme={theme} />
        )}

        {tab === "notes" && (
          <NotesTab
            anchor={caps.annotations}
            annotations={annotations}
            theme={theme}
            onJump={onJumpAnnotation}
            onUpdate={onUpdateAnnotation}
            onDelete={onDeleteAnnotation}
            exportBook={exportBook}
          />
        )}
        {tab === "search" && (
          <SearchTab
            theme={theme}
            onSearch={onSearch}
            onClearSearch={onClearSearch}
            onJumpHit={onJumpHit}
            matchCase={matchCase}
            wholeWord={wholeWord}
            onMatchOptions={(patch) => update(patch)}
            indexStatus={indexStatus}
            indexProgress={indexProgress}
            indexKind={indexKind}
            initialQuery={searchInitialQuery}
            takeDeepHit={searchTakeDeepHit}
          />
        )}

        {tab === "display" && (
          <DisplayTab
            settings={settings}
            caps={caps}
            theme={theme}
            update={update}
            onEncoding={onEncoding}
            cleanView={cleanView}
            onCleanView={onCleanView}
            ocrEnabled={ocrEnabled}
            onOcrEnabled={onOcrEnabled}
            sharpZoom={sharpZoom}
            onSharpZoom={onSharpZoom}
            sharpAmount={sharpAmount}
            onSharpAmount={onSharpAmount}
            tts={tts}
            autoScroll={autoScroll}
          />
        )}
        {tab === "forms" && forms && <FormsTab theme={theme} forms={forms} />}
        {tab === "pages" && (
          <PagesTab
            pageCount={caps.pageCount ?? 0}
            currentPage={currentPage}
            onGoToPage={onGoToPage}
            theme={theme}
            renderThumbnail={renderThumbnail}
            pageOps={caps.pageOps ? pageOps : undefined}
            revision={pagesRevision}
          />
        )}
      </div>
    </aside>
  );
}
