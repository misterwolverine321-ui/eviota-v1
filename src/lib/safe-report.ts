import { useSyncExternalStore } from "react";
import { classifyLink, emptyReport, mergeReports, type BlockedReport } from "./safe-document";

/**
 * What safe mode has blocked in the book that is open, and the one external
 * link (if any) waiting for the reader's yes/no. Only one book is open at a
 * time, so this is a single module-level store rather than per-book state.
 *
 * Reports are kept per section key and merged on read, so turning back to a
 * section that was already loaded does not count its scripts twice.
 */

const sections = new Map<string, BlockedReport>();
let snapshot: BlockedReport = emptyReport();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

export function resetSafeReport(): void {
  sections.clear();
  snapshot = emptyReport();
  notify();
}

/** Record what was removed from one section (replaces any earlier record of it). */
export function recordSafeReport(key: string, report: BlockedReport): void {
  sections.set(key, report);
  snapshot = [...sections.values()].reduce(mergeReports, emptyReport());
  notify();
}

export const getSafeReport = (): BlockedReport => snapshot;

export function subscribeSafeReport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useSafeReport = (): BlockedReport =>
  useSyncExternalStore(subscribeSafeReport, getSafeReport, getSafeReport);

// ------------------------------------------------------- external links --

export interface PendingLink {
  url: string;
  host: string;
  /** Who is asking: a link in the book, or one the app itself offers (Define's "Read more"). */
  by: "book" | "app";
}

let pending: PendingLink | null = null;
const linkListeners = new Set<() => void>();
const notifyLink = () => {
  for (const listener of linkListeners) listener();
};

/**
 * A book asked to open a link. Nothing opens until `resolveExternalLink(true)`.
 * Returns false when the link is not something that may leave (so the caller
 * can simply swallow the click).
 */
export function requestExternalLink(href: string, by: "book" | "app" = "book"): boolean {
  const link = classifyLink(href);
  if (link.kind !== "external" || !link.url) return false;
  pending = { url: link.url, host: link.host ?? "", by };
  notifyLink();
  return true;
}

/**
 * A middle click raises `auxclick`, not `click`, and the browser's default for
 * it on a link is to open the address in a new tab. A guard that only listens
 * for `click` never sees it, so the book could open a tab without asking. Add
 * this as an `auxclick` listener to every document that holds book markup.
 * The default is cancelled for any link (even one that may not leave); a link
 * that may leave goes to the same confirmation as a left click. Other buttons
 * are left alone: the right button belongs to the browser's context menu.
 */
export function guardAuxClick(event: MouseEvent): void {
  if (event.button !== 1) return;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!link) return;
  event.preventDefault();
  requestExternalLink(link.getAttribute("href") ?? "");
}

export function resolveExternalLink(open: boolean): void {
  const link = pending;
  pending = null;
  notifyLink();
  if (open && link) window.open(link.url, "_blank", "noopener,noreferrer");
}

export const getPendingLink = (): PendingLink | null => pending;

export const usePendingLink = (): PendingLink | null =>
  useSyncExternalStore(
    (listener) => {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    getPendingLink,
    getPendingLink,
  );
