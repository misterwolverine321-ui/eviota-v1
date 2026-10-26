import { repairOvershoot } from "./anchor-repair";
import { getDb, recordTombstone } from "./db";
import type { TextAnchorData } from "./text-anchor";

/**
 * Annotation model (Phase 2).
 *
 * Engines never touch persistence — they emit *anchors* (a CFI for reflowable
 * text, page + normalized rects for paged images) and the kernel writes them
 * here. Rects are stored normalized (0..1 of page width/height) so highlights
 * survive zoom changes, DPR changes and re-renders.
 */

export const ANNOTATION_COLORS = {
  yellow: "#F5C542",
  pink: "#F58AA8",
  green: "#79C88F",
  blue: "#6FA8DC",
  purple: "#B08BE0",
} as const;

export type AnnotationColor = keyof typeof ANNOTATION_COLORS;

export const COLOR_ORDER: AnnotationColor[] = ["yellow", "pink", "green", "blue", "purple"];

/** Translucent annotation paint that keeps dark-reading text legible. */
export function annotationPaint(color: AnnotationColor, dark: boolean): string {
  const hex = ANNOTATION_COLORS[color];
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${channels.join(",")},${dark ? 0.5 : 0.38})`;
}

export type AnnotationType = "highlight" | "underline" | "strike" | "note" | "ink" | "bookmark";

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AnnotationAnchor =
  | { kind: "cfi"; cfi: string }
  | { kind: "rect"; page: number; rects: NormRect[] }
  /** Phase 4.3: offsets into the page text, self-healing via quote + context. */
  | TextAnchorData;

export interface Annotation {
  id: string;
  bookId: string;
  anchor: AnnotationAnchor;
  type: AnnotationType;
  color: AnnotationColor;
  /** Selected source text, when the engine could extract it. */
  text?: string;
  /** User-authored note body. */
  note?: string;
  /** Chapter / page label captured at creation time, for the notes list. */
  label?: string;
  /**
   * Set when a text anchor could not be resolved on its page after an edit.
   * Orphans stay in the database and are surfaced in the Notes tab instead of
   * being dropped.
   */
  orphaned?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A selection reported by an engine, in viewport coordinates. */
export interface SelectionEvent {
  anchor: AnnotationAnchor;
  text: string;
  /** Bounding box of the selection in viewport (client) coordinates. */
  rect: { x: number; y: number; width: number; height: number };
  /** Set when the user tapped an existing annotation instead of selecting. */
  existingId?: string;
}

export type AnnotationDraft = Omit<Annotation, "id" | "bookId" | "createdAt" | "updatedAt">;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const hasIdb = () => typeof indexedDB !== "undefined";

export async function listAnnotations(bookId: string): Promise<Annotation[]> {
  if (!hasIdb()) return [];
  const db = await getDb();
  const stored = (await db.getAllFromIndex("annotations", "bookId", bookId)) as Annotation[];
  const rows = await repairStored(db, stored);
  return rows.sort((a, b) => sortKey(a) - sortKey(b) || a.createdAt - b.createdAt);
}

/** Every annotation in the library, for whole-shelf export and backups. */
export async function listAllAnnotations(): Promise<Annotation[]> {
  if (!hasIdb()) return [];
  const db = await getDb();
  return repairStored(db, (await db.getAll("annotations")) as Annotation[]);
}

/**
 * Correct marks that an old build stored with the wrong end (see `anchor-repair.ts`) and write
 * the correction back, so it happens once. Every read path goes through here, which also covers
 * marks that arrive later from an old backup.
 *
 * The write re-reads each record inside its own transaction and repairs what is stored NOW, so
 * an edit saved since `rows` was read is kept, and a mark deleted since is not brought back.
 * `updatedAt` is left alone: this is a correction, not an edit. A store that cannot be written
 * (full disk, private mode) must not stop the book from opening, so the marks come back
 * repaired in memory and the write is tried again on the next read.
 */
export async function repairStored(
  db: Pick<Awaited<ReturnType<typeof getDb>>, "transaction">,
  rows: Annotation[],
): Promise<Annotation[]> {
  const wanted = rows.filter((row) => repairOvershoot(row));
  if (!wanted.length) return rows;
  try {
    const tx = db.transaction("annotations", "readwrite");
    const settled = new Map<string, Annotation | null>();
    for (const row of wanted) {
      const current = (await tx.store.get(row.id)) as Annotation | undefined;
      if (!current) {
        settled.set(row.id, null);
        continue;
      }
      const fixed = repairOvershoot(current);
      if (fixed) await tx.store.put(fixed);
      settled.set(row.id, fixed ?? current);
    }
    await tx.done;
    return rows.flatMap((row) => {
      if (!settled.has(row.id)) return [row];
      const done = settled.get(row.id);
      return done ? [done] : [];
    });
  } catch {
    return rows.map((row) => repairOvershoot(row) ?? row);
  }
}

export async function createAnnotation(
  bookId: string,
  draft: AnnotationDraft,
): Promise<Annotation> {
  const now = Date.now();
  const record: Annotation = {
    ...draft,
    id: newId(),
    bookId,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.put("annotations", record);
  return record;
}

export async function updateAnnotation(
  id: string,
  patch: Partial<Omit<Annotation, "id" | "bookId" | "createdAt">>,
): Promise<Annotation | undefined> {
  const db = await getDb();
  const existing = (await db.get("annotations", id)) as Annotation | undefined;
  if (!existing) return undefined;
  const next: Annotation = { ...existing, ...patch, updatedAt: Date.now() };
  await db.put("annotations", next);
  return next;
}

/**
 * Keep the CFI an engine derived for a text anchor that had none. Like the repair, this is not
 * an edit by the reader, so `updatedAt` stays. Never replaces a CFI that is already there.
 */
export async function setAnchorCfi(id: string, cfi: string): Promise<Annotation | undefined> {
  const db = await getDb();
  const tx = db.transaction("annotations", "readwrite");
  const existing = (await tx.store.get(id)) as Annotation | undefined;
  if (!existing || existing.anchor.kind !== "text" || existing.anchor.cfi) {
    await tx.done;
    return existing;
  }
  const next: Annotation = { ...existing, anchor: { ...existing.anchor, cfi } };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await getDb();
  const existing = (await db.get("annotations", id)) as Annotation | undefined;
  await db.delete("annotations", id);
  if (existing) await recordTombstone(id, existing.bookId);
}

export async function deleteBookAnnotations(bookId: string): Promise<void> {
  if (!hasIdb()) return;
  const db = await getDb();
  const keys = await db.getAllKeysFromIndex("annotations", "bookId", bookId);
  const tx = db.transaction("annotations", "readwrite");
  await Promise.all(keys.map((k) => tx.store.delete(k)));
  await tx.done;
  for (const key of keys) await recordTombstone(String(key), bookId);
}

/** Rough document order, used to keep the notes list reading-ordered. */
function sortKey(a: Annotation): number {
  if (a.anchor.kind === "rect" || a.anchor.kind === "text") return a.anchor.page;
  return 0;
}

export function anchorKey(anchor: AnnotationAnchor): string {
  if (anchor.kind === "cfi") return anchor.cfi;
  if (anchor.kind === "text") return `p${anchor.page}:${anchor.start}`;
  return `p${anchor.page}`;
}

/** Page number for any paged anchor, or null for reflowable CFIs. */
export function anchorPage(anchor: AnnotationAnchor): number | null {
  return anchor.kind === "cfi" ? null : anchor.page;
}

export function isTextMark(type: AnnotationType): boolean {
  return type === "highlight" || type === "underline" || type === "strike";
}

/** Union bounding box of normalized rects, for hit-testing and jump targets. */
export function unionRect(rects: NormRect[]): NormRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}
