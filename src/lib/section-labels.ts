/**
 * Hit-list labels for the books foliate-js opens (EPUB, MOBI, AZW3, FB2).
 *
 * A persisted-index hit is numbered by section, and without a label the hit list says "Page 7" for
 * the seventh section — a number the reader never sees. foliate's own live search labels a hit with
 * the table-of-contents entry its section falls under, so the index does the same: the label of the
 * first entry that points into the section, or else of the nearest entry before it. A section
 * before the first entry has no label, and the list falls back to "Page N".
 *
 * The reader asks the open `View` (`getProgressOf`); the shelf indexer has no view and builds the same
 * mapping from foliate's `TOCProgress`, the class the view uses, so both give the same answer.
 */

interface TocEntry {
  label?: string;
}

interface TocBook {
  sections?: { id?: unknown }[];
  toc?: unknown[];
  splitTOCHref?: (href: string) => unknown;
  getTOCFragment?: (doc: unknown, id: unknown) => unknown;
}

/** The label foliate's view gives section `unit` (1-based, as the index numbers them). */
export function labelFromView(
  view: { getProgressOf?: (index: number) => { tocItem?: TocEntry | null } | undefined },
  unit: number,
): string {
  try {
    return view.getProgressOf?.(Math.round(unit) - 1)?.tocItem?.label?.trim() ?? "";
  } catch {
    return "";
  }
}

/** The same labels for a book that is open without a view; "" for every unit if it has no usable TOC. */
export async function sectionLabeller(book: TocBook): Promise<(unit: number) => string> {
  const sections = book.sections ?? [];
  if (!sections.length || !book.toc?.length || !book.splitTOCHref || !book.getTOCFragment) {
    return () => "";
  }
  try {
    const { TOCProgress } = await import("foliate-js/progress.js");
    const progress = new TOCProgress();
    await progress.init({
      toc: book.toc,
      ids: sections.map((s) => s.id),
      splitHref: book.splitTOCHref.bind(book),
      getFragment: book.getTOCFragment.bind(book),
    });
    return (unit) => {
      try {
        return progress.getProgress(Math.round(unit) - 1)?.label?.trim() ?? "";
      } catch {
        return "";
      }
    };
  } catch {
    return () => "";
  }
}
