import { findSameFile, type SameFileCandidate } from "./book-identity";
import { extractMeta, fileToRecord, prettyTitle } from "./books";
import { getBookFile, listBooks, putBook, type BookRecord } from "./db";
import { fileProblem } from "./import-check";
import { getFormatInfo } from "./formats";

export interface ImportResult {
  added: BookRecord[];
  skipped: string[]; // already on the shelf: the same bytes as a book there
  failed: string[]; // unrecognized extension, or could not be decoded
  /** Refused before decoding: empty, or not the kind of file its name says. */
  rejected: { name: string; reason: string }[];
}

/**
 * A file currently being ingested. Emitted as soon as its metadata (and cover,
 * when the format has one) is known, so the shelf can show the real cover with
 * a loading state instead of a bare progress bar.
 */
export interface ImportPending {
  key: string;
  fileName: string;
  title: string;
  author: string;
  format: string;
  cover: Blob | null;
}

export interface ImportHooks {
  /** Queued: filename known, nothing decoded yet. */
  onQueued?: (pending: ImportPending[]) => void;
  /** Metadata (and cover) decoded for one file. */
  onMeta?: (pending: ImportPending) => void;
  /** This file is on the shelf (or failed) and its placeholder can retire. */
  onSettled?: (key: string) => void;
}

const keyFor = (file: File) => `${file.name}:${file.size}`;

/** Imports local files into the IndexedDB library. Fully client-side. */
export async function importFiles(files: File[], hooks: ImportHooks = {}): Promise<ImportResult> {
  const result: ImportResult = { added: [], skipped: [], failed: [], rejected: [] };
  // The shelf is read once per batch; books added by this batch are compared too, so two copies
  // dropped together are not both imported.
  const candidates: SameFileCandidate[] = [];
  let shelfRead = false;

  hooks.onQueued?.(
    files.map((file) => ({
      key: keyFor(file),
      fileName: file.name,
      title: prettyTitle(file.name),
      author: "",
      format: getFormatInfo(file.name)?.ext ?? "",
      cover: null,
    })),
  );

  for (const file of files) {
    const key = keyFor(file);
    const info = getFormatInfo(file.name);
    if (!info) {
      result.failed.push(file.name);
      hooks.onSettled?.(key);
      continue;
    }
    try {
      const problem = await fileProblem(file);
      if (problem) {
        result.rejected.push({ name: file.name, reason: problem });
        hooks.onSettled?.(key);
        continue;
      }
      if (!shelfRead) {
        shelfRead = true;
        for (const record of await listBooks()) {
          candidates.push({ record, load: () => getBookFile(record.id) });
        }
      }
      if (await findSameFile(file, info.ext, candidates)) {
        result.skipped.push(file.name);
        hooks.onSettled?.(key);
        continue;
      }
      // Formats without a decoder are shelved with filename-derived metadata.
      const meta =
        info.kind === "unsupported"
          ? { title: prettyTitle(file.name), author: "Unknown author" }
          : await extractMeta(file);
      hooks.onMeta?.({
        key,
        fileName: file.name,
        title: meta.title || prettyTitle(file.name),
        author: meta.author || "",
        format: info.ext,
        cover: (meta as { cover?: Blob | null }).cover ?? null,
      });
      const record = await fileToRecord(file, meta);
      await putBook(record, file);
      result.added.push(record);
      candidates.push({ record, load: async () => file });
    } catch (err) {
      console.warn("import failed", file.name, err);
      result.failed.push(file.name);
    }
    hooks.onSettled?.(key);
  }
  return result;
}
