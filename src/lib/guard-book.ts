import {
  UNCHECKABLE_SECTION,
  hardenCss,
  hardenMarkup,
  isMarkupType,
  type BlockedReport,
  type RemoteRef,
  emptyReport,
} from "./safe-document";

/**
 * Applies safe mode to a book opened by foliate-js, before any section is
 * handed to an iframe.
 *
 *  - EPUB exposes `transformTarget`: every resource it is about to turn into a
 *    blob URL fires a `data` event whose `detail.data` we may replace. Markup
 *    and CSS are hardened there.
 *  - MOBI/AZW3 have no such hook, so each section's `load()` is wrapped: the
 *    blob it produced is read back, hardened and re-published.
 *  - FB2 is converted from a whitelisted XSLT and carries embedded images
 *    only; it needs nothing.
 *
 * `onReport(key, report)` is called per section so the UI can show what was
 * blocked. The returned function removes the listeners and frees any blob URL
 * this module created.
 */

export interface GuardIo {
  /** Read a blob URL back as text plus its media type. */
  read(url: string): Promise<{ text: string; type: string }>;
  make(markup: string, type: string): string;
  revoke(url: string): void;
}

const browserIo: GuardIo = {
  async read(url) {
    const blob = await (await fetch(url)).blob();
    return { text: await blob.text(), type: blob.type };
  },
  make: (markup, type) => URL.createObjectURL(new Blob([markup], { type })),
  revoke: (url) => URL.revokeObjectURL(url),
};

type Section = {
  id?: string;
  load?: (...args: unknown[]) => Promise<string | undefined> | string | undefined;
  unload?: (...args: unknown[]) => unknown;
};

export interface GuardableBook {
  /** Present on EPUB only. */
  transformTarget?: EventTarget;
  sections?: Section[];
}

type ReportFn = (key: string, report: BlockedReport) => void;

export function guardBook(
  book: GuardableBook,
  onReport: ReportFn,
  io: GuardIo = browserIo,
): () => void {
  if (book.transformTarget) return guardEpub(book.transformTarget, onReport);
  return guardSectionLoads(book.sections ?? [], onReport, io);
}

// ------------------------------------------------------------------ EPUB --

function guardEpub(target: EventTarget, onReport: ReportFn): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as {
      data: unknown;
      type: string;
      name?: string;
    };
    const type = detail.type;
    const key = detail.name ?? "(unnamed)";
    const original = detail.data;

    if (isMarkupType(type)) {
      detail.data = Promise.resolve(original).then(async (data) => {
        const text =
          typeof data === "string" ? data : data instanceof Blob ? await data.text() : null;
        if (text === null) {
          detail.type = "text/html";
          return UNCHECKABLE_SECTION;
        }
        const result = hardenMarkup(text, type);
        // The stand-in is HTML; serving it as XHTML would show an XML error.
        if (result.failed) detail.type = "text/html";
        onReport(key, result.report);
        return result.markup;
      });
    } else if (/^text\/css\b/i.test(type ?? "")) {
      detail.data = Promise.resolve(original).then(async (data) => {
        const text =
          typeof data === "string" ? data : data instanceof Blob ? await data.text() : null;
        if (text === null) return data;
        const found: RemoteRef[] = [];
        const css = hardenCss(text, found);
        if (found.length) onReport(key, { ...emptyReport(), remote: found });
        return css;
      });
    }
  };
  target.addEventListener("data", handler);
  return () => target.removeEventListener("data", handler);
}

// ------------------------------------------------------------- MOBI/AZW3 --

function guardSectionLoads(sections: Section[], onReport: ReportFn, io: GuardIo): () => void {
  const created = new Set<string>();
  const restore: (() => void)[] = [];

  sections.forEach((section, index) => {
    const load = section.load;
    if (typeof load !== "function") return;
    const unload = section.unload;
    const key = section.id ?? `section-${index}`;
    /** original blob URL -> hardened blob URL */
    const safeFor = new Map<string, string>();

    section.load = async (...args: unknown[]) => {
      const url = await load.apply(section, args);
      if (!url || typeof url !== "string") return url;
      const known = safeFor.get(url);
      if (known) return known;
      try {
        const { text, type } = await io.read(url);
        if (!isMarkupType(type)) return url; // an image or stylesheet, not a document
        const result = hardenMarkup(text, type);
        onReport(key, result.report);
        const safe = io.make(result.markup, result.failed ? "text/html" : type);
        safeFor.set(url, safe);
        created.add(safe);
        return safe;
      } catch {
        // Could not be read back: show the stand-in, never the unchecked original.
        const safe = io.make(UNCHECKABLE_SECTION, "text/html");
        safeFor.set(url, safe);
        created.add(safe);
        return safe;
      }
    };
    if (typeof unload === "function") {
      section.unload = (...args: unknown[]) => {
        for (const safe of safeFor.values()) {
          io.revoke(safe);
          created.delete(safe);
        }
        safeFor.clear();
        return unload.apply(section, args);
      };
    }
    restore.push(() => {
      section.load = load;
      if (unload) section.unload = unload;
    });
  });

  return () => {
    for (const undo of restore) undo();
    for (const url of created) io.revoke(url);
    created.clear();
  };
}
