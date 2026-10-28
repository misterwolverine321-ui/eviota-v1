/**
 * Comic cover extraction.
 *
 * Comic archives are not handled by the foliate parsers, so they arrived on the
 * shelf without a cover. Here the first page image is pulled out of the archive
 * (libarchive handles CBZ/CBR/CB7/CBT alike) and downscaled to a small JPEG so
 * the shelf card has a real cover without keeping a full-resolution scan in the
 * database.
 */

import { assetUrl } from "./asset-url";

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

/** Longest edge of a stored cover, in px. */
const COVER_WIDTH = 480;

/** Downscale a page image to a shelf-sized JPEG. */
async function toCover(blob: Blob): Promise<Blob | undefined> {
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const k = Math.min(1, COVER_WIDTH / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return await new Promise<Blob | undefined>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? blob), "image/jpeg", 0.82),
    );
  } catch {
    return blob;
  }
}

/**
 * One entry of libarchive.js's `getFilesArray()`, as the comic readers use it. Only entries whose
 * name ends in an image extension are read, and those always carry a file to extract.
 */
export interface ComicArchiveItem {
  /** Folder part of the entry's path. */
  path?: string;
  file: { name?: string; extract(): Promise<Blob> };
}

/**
 * Cover image for a comic archive — its first page — or `undefined` when the
 * archive can't be read. Only one entry is ever inflated.
 */
export async function extractComicCover(file: Blob): Promise<Blob | undefined> {
  try {
    const { Archive } = await import("libarchive.js");
    Archive.init({ workerUrl: assetUrl("vendor/libarchive/worker-bundle.js") });
    // libarchive.js declares `open` for a File; it reads only the bytes, so the stored Blob works.
    const archive = await Archive.open(file as File);
    const flat: ComicArchiveItem[] = await archive.getFilesArray();
    const items = flat
      .map((item) => ({
        name: `${item.path ?? ""}${item.file?.name ?? ""}`,
        file: item.file,
      }))
      .filter((it) => IMAGE_RE.test(it.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const first = items[0];
    if (!first) return undefined;
    const blob: Blob = await first.file.extract();
    if (!blob || !blob.size) return undefined;
    return await toCover(blob);
  } catch {
    return undefined;
  }
}
