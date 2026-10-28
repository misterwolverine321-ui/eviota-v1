import type { Annotation } from "./annotations";
import { ANNOTATION_COLORS } from "./annotations";

/**
 * PDF page operations.
 *
 * Every op is pure: it takes the current file blob and returns a **new** blob.
 * Persistence is the kernel's job — these functions never touch IndexedDB.
 *
 * pdf-lib is loaded lazily so the reader bundle stays small for readers that
 * never open the Pages tab.
 */

const loadLib = () => import("pdf-lib");

async function open(blob: Blob) {
  const { PDFDocument } = await loadLib();
  return PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
}

const toBlob = (bytes: Uint8Array) =>
  new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });

/** Page count of a PDF blob, used to size incremental index updates. */
export async function countPages(blob: Blob): Promise<number> {
  const doc = await open(blob);
  return doc.getPageCount();
}

/** Rotate one page by a multiple of 90°, clockwise for positive deltas. */
export async function rotatePage(blob: Blob, page: number, delta: number): Promise<Blob> {
  const { degrees } = await loadLib();
  const doc = await open(blob);
  const target = doc.getPage(page - 1);
  const next = (((target.getRotation().angle + delta) % 360) + 360) % 360;
  target.setRotation(degrees(next));
  return toBlob(await doc.save());
}

/** Remove pages (1-based). Never removes the last remaining page. */
export async function deletePages(blob: Blob, pages: number[]): Promise<Blob> {
  const doc = await open(blob);
  const total = doc.getPageCount();
  const kill = [...new Set(pages)].filter((p) => p >= 1 && p <= total).sort((a, b) => b - a);
  if (kill.length >= total) throw new Error("A PDF needs at least one page.");
  for (const p of kill) doc.removePage(p - 1);
  return toBlob(await doc.save());
}

/** Move a page to a new 1-based index, shifting the rest. */
export async function movePage(blob: Blob, from: number, to: number): Promise<Blob> {
  const doc = await open(blob);
  const total = doc.getPageCount();
  if (from < 1 || from > total || to < 1 || to > total || from === to) return blob;
  const order = Array.from({ length: total }, (_, i) => i);
  const [moved] = order.splice(from - 1, 1);
  order.splice(to - 1, 0, moved);
  const out = await (await loadLib()).PDFDocument.create();
  const copied = await out.copyPages(doc, order);
  copied.forEach((p) => out.addPage(p));
  return toBlob(await out.save());
}

/** Build a new document from a subset of pages, in the given order. */
export async function extractPages(blob: Blob, pages: number[]): Promise<Blob> {
  const doc = await open(blob);
  const total = doc.getPageCount();
  const wanted = pages.filter((p) => p >= 1 && p <= total).map((p) => p - 1);
  if (!wanted.length) throw new Error("Nothing to extract.");
  const out = await (await loadLib()).PDFDocument.create();
  const copied = await out.copyPages(doc, wanted);
  copied.forEach((p) => out.addPage(p));
  return toBlob(await out.save());
}

/** Append one or more PDFs, in order, to the end of `blob`. */
export async function mergePdfs(blob: Blob, extra: Blob | Blob[]): Promise<Blob> {
  const doc = await open(blob);
  const list = Array.isArray(extra) ? extra : [extra];
  if (!list.length) throw new Error("Pick at least one PDF to merge.");
  for (const item of list) {
    const other = await open(item);
    const copied = await doc.copyPages(other, other.getPageIndices());
    copied.forEach((p) => doc.addPage(p));
  }
  return toBlob(await doc.save());
}

/** Split into [1..page] and [page+1..end]. */
export async function splitAt(blob: Blob, page: number): Promise<[Blob, Blob]> {
  const doc = await open(blob);
  const total = doc.getPageCount();
  if (page < 1 || page >= total) throw new Error("Pick a split point inside the document.");
  const head = Array.from({ length: page }, (_, i) => i + 1);
  const tail = Array.from({ length: total - page }, (_, i) => page + i + 1);
  return [await extractPages(blob, head), await extractPages(blob, tail)];
}

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

/**
 * Burn `page-rect` annotations into the file so any viewer shows them.
 *
 * Rects are normalized to the *rendered* page box (top-left origin); PDF user
 * space is bottom-left, so y flips here.
 */
export async function flattenAnnotations(blob: Blob, annotations: Annotation[]): Promise<Blob> {
  const { rgb } = await loadLib();
  const doc = await open(blob);
  const total = doc.getPageCount();

  for (const a of annotations) {
    if (a.anchor.kind !== "rect") continue;
    if (a.anchor.page < 1 || a.anchor.page > total) continue;
    const page = doc.getPage(a.anchor.page - 1);
    const { width, height } = page.getSize();
    const { r, g, b } = hexToRgb(ANNOTATION_COLORS[a.color]);
    const color = rgb(r, g, b);

    if (a.type === "bookmark" || a.type === "note") {
      // Corner tab marker so the mark is visible without an annotation UI.
      const size = Math.min(18, width * 0.04);
      page.drawRectangle({
        x: width - size - 12,
        y: height - size - 12,
        width: size,
        height: size,
        color,
        opacity: 0.9,
      });
      continue;
    }

    for (const rect of a.anchor.rects) {
      const x = rect.x * width;
      const w = rect.w * width;
      const h = rect.h * height;
      const y = height - (rect.y + rect.h) * height;
      if (w <= 0 || h <= 0) continue;
      if (a.type === "highlight") {
        page.drawRectangle({ x, y, width: w, height: h, color, opacity: 0.35 });
      } else if (a.type === "underline") {
        page.drawRectangle({ x, y, width: w, height: 1.4, color, opacity: 0.9 });
      } else {
        page.drawRectangle({
          x,
          y: y + h / 2,
          width: w,
          height: 1.4,
          color,
          opacity: 0.9,
        });
      }
    }
  }
  return toBlob(await doc.save());
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const withSuffix = (fileName: string, suffix: string) =>
  fileName.replace(/(\.pdf)?$/i, "") + suffix + ".pdf";

// ----------------------------------------------------- anchor remapping ----

/**
 * Page remapping for anchors after a page op.
 *
 * Ops rewrite the file, so a stored page number can point at the wrong page
 * (reorder), one page too far (delete) or nothing at all (the page it lived on
 * is gone). These mappers are pure: `null` means "this page no longer exists",
 * which the kernel records as an orphan instead of deleting the annotation.
 */
export type PageMapper = (page: number) => number | null;

/** Rotation and merge keep every existing page index. */
export const samePages: PageMapper = (page) => page;

export function afterDelete(deleted: number[]): PageMapper {
  const gone = new Set(deleted);
  return (page) => {
    if (gone.has(page)) return null;
    let shift = 0;
    for (const p of gone) if (p < page) shift++;
    return page - shift;
  };
}

export function afterMove(from: number, to: number): PageMapper {
  return (page) => {
    if (page === from) return to;
    if (from < to) return page > from && page <= to ? page - 1 : page;
    if (from > to) return page >= to && page < from ? page + 1 : page;
    return page;
  };
}

export interface AnchorPatch {
  id: string;
  patch: Partial<Annotation>;
}

/**
 * Rewrite paged anchors through a mapper. Text anchors keep their offsets and
 * self-heal on the new page; an anchor whose page vanished is flagged
 * `orphaned` so the Notes tab can surface it.
 */
export function remapAnchors(annotations: Annotation[], map: PageMapper): AnchorPatch[] {
  const out: AnchorPatch[] = [];
  for (const a of annotations) {
    if (a.anchor.kind === "cfi") continue;
    const next = map(a.anchor.page);
    if (next === null) {
      if (!a.orphaned) out.push({ id: a.id, patch: { orphaned: true } });
      continue;
    }
    if (next !== a.anchor.page) {
      out.push({
        id: a.id,
        patch: { anchor: { ...a.anchor, page: next } },
      });
    }
  }
  return out;
}
