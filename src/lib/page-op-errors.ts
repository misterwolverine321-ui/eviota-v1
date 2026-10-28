/**
 * Page-op failure classification.
 *
 * pdf-lib, IndexedDB and the browser all fail with wildly different messages.
 * The kernel funnels every page-op rejection through here so the toast can say
 * something true, and so we know whether retrying is worth offering.
 */

export type PageOpFailure =
  "encrypted" | "corrupt" | "memory" | "storage" | "constraint" | "unknown";

export interface ClassifiedOpError {
  kind: PageOpFailure;
  /** Headline shown in the toast. */
  message: string;
  /** Secondary line, usually the raw error. */
  detail?: string;
  /** Retrying a deterministic failure (encrypted, corrupt input) never helps. */
  retryable: boolean;
}

export function classifyPageOpError(error: unknown): ClassifiedOpError {
  const raw = error instanceof Error ? error.message : String(error);
  const m = raw.toLowerCase();

  if (m.includes("encrypt") || m.includes("password"))
    return {
      kind: "encrypted",
      message: "This PDF is encrypted, so its pages can't be edited.",
      detail: raw,
      retryable: false,
    };

  if (m.includes("at least one page") || m.includes("nothing to extract"))
    return { kind: "constraint", message: raw, retryable: false };

  if (m.includes("quota") || m.includes("storage") || m.includes("disk"))
    return {
      kind: "storage",
      message: "Out of browser storage — the original file was kept.",
      detail: raw,
      retryable: true,
    };

  if (
    m.includes("out of memory") ||
    m.includes("allocation") ||
    m.includes("array buffer") ||
    m.includes("too large")
  )
    return {
      kind: "memory",
      message: "This file is too large to edit in the browser.",
      detail: raw,
      retryable: true,
    };

  if (
    m.includes("invalid pdf") ||
    m.includes("failed to parse") ||
    m.includes("unexpected") ||
    m.includes("malformed") ||
    m.includes("no pdf header")
  )
    return {
      kind: "corrupt",
      message: "This PDF's structure couldn't be rewritten.",
      detail: raw,
      retryable: false,
    };

  return { kind: "unknown", message: raw || "The page operation failed.", retryable: true };
}
