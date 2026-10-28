import { installPdfJsPolyfill } from "@/lib/pdfjs-polyfill";
import { comicSeriesMeta, isComicArchive } from "./comicinfo";
import { getFormatInfo } from "./formats";
import type { BookRecord } from "./db";

export interface ExtractedMeta {
  title: string;
  author: string;
  cover?: Blob;
  /** Comic series info, when the file is a comic archive. */
  series?: string;
  seriesIndex?: number;
  seriesTotal?: number;
}

export const prettyTitle = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** The fields of a PDF's document information dictionary that this file reads. */
interface PdfDocInfo {
  Title?: string;
  Author?: string;
}

const str = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (typeof v === "object") return str((v as { name?: unknown }).name ?? "");
  return String(v);
};

/** Metadata + cover via foliate-js parsers (EPUB, MOBI, AZW3, FB2, CBZ). */
async function extractViaFoliate(file: File): Promise<ExtractedMeta> {
  const { makeBook } = await import("foliate-js/view.js");
  const book = await makeBook(file);
  const md = book.metadata ?? {};
  let cover: Blob | undefined;
  try {
    cover = (await book.getCover?.()) ?? undefined;
  } catch {
    cover = undefined;
  }
  return {
    title: str(md.title) || prettyTitle(file.name),
    author: str(md.creator ?? md.author) || "Unknown author",
    cover: cover && cover.size ? cover : undefined,
  };
}

/** Metadata + first-page cover via pdf.js. */
async function extractPdf(file: File): Promise<ExtractedMeta> {
  installPdfJsPolyfill();
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await loadingTask.promise;
  let title = "";
  let author = "";
  try {
    const meta = await doc.getMetadata();
    const docInfo = meta?.info as PdfDocInfo | undefined;
    title = docInfo?.Title ?? "";
    author = docInfo?.Author ?? "";
  } catch {
    /* metadata optional */
  }

  let cover: Blob | undefined;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = 480 / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    cover = await new Promise<Blob | undefined>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? undefined), "image/jpeg", 0.85),
    );
  } catch {
    cover = undefined;
  }
  await loadingTask.destroy().catch(() => {});

  return {
    title: title || prettyTitle(file.name),
    author: author || "Unknown author",
    cover,
  };
}

export async function extractMeta(file: File): Promise<ExtractedMeta> {
  const info = getFormatInfo(file.name);
  const fallback: ExtractedMeta = {
    title: prettyTitle(file.name),
    author: "Unknown author",
  };
  let meta = fallback;
  if (!info) return fallback;
  try {
    if (info.kind === "foliate") meta = await extractViaFoliate(file);
    else if (info.kind === "pdf") meta = await extractPdf(file);
    else if (info.kind === "comic") {
      // Comic archives have no parser-provided cover: use the first page.
      const { extractComicCover } = await import("./comic-cover");
      const cover = await extractComicCover(file);
      meta = { ...fallback, ...(cover ? { cover } : {}) };
    }
  } catch (err) {
    console.warn("metadata extraction failed", err);
  }

  // Comics carry their series in a ComicInfo.xml sidecar (or in the file name).
  if (isComicArchive(file.name)) {
    try {
      const comic = await comicSeriesMeta(file, file.name);
      if (comic.series) {
        meta = {
          ...meta,
          series: comic.series,
          seriesIndex: comic.number,
          seriesTotal: comic.count,
          title: meta.title === fallback.title && comic.title ? comic.title : meta.title,
          author: meta.author === "Unknown author" && comic.writer ? comic.writer : meta.author,
        };
      }
    } catch (err) {
      console.warn("comic metadata failed", err);
    }
  }
  return meta;
}

let idCounter = 0;
export const newBookId = () =>
  `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export async function fileToRecord(file: File, meta: ExtractedMeta): Promise<BookRecord> {
  const info = getFormatInfo(file.name);
  return {
    id: newBookId(),
    title: meta.title,
    author: meta.author,
    format: info?.ext ?? "bin",
    fileName: file.name,
    size: file.size,
    addedAt: Date.now(),
    hasCover: !!meta.cover,
    cover: meta.cover,
    progress: null,
    ...(meta.series ? { series: meta.series } : {}),
    ...(meta.seriesIndex !== undefined ? { seriesIndex: meta.seriesIndex } : {}),
    ...(meta.seriesTotal !== undefined ? { seriesTotal: meta.seriesTotal } : {}),
  };
}

export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
