// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesTab } from "@/components/reader/drawer/notes-tab";
import type { Annotation } from "@/lib/annotations";
import type { ReaderTheme } from "@/lib/reader-settings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = Date.UTC(2026, 9, 7);
const annotations: Annotation[] = [
  {
    id: "a1",
    bookId: "b1",
    type: "highlight",
    color: "yellow",
    anchor: { kind: "cfi", cfi: "epubcfi(/6/4)" },
    text: "I went to the woods",
    label: "Chapter 2",
    createdAt: T,
    updatedAt: T,
  },
];
const theme = { line: "#ddd" } as ReaderTheme;
const book = { id: "b1", title: "Walden", author: "Thoreau" };

let root: Root;
let host: HTMLElement;
let blobs: Blob[];
let downloads: string[];

beforeEach(() => {
  blobs = [];
  downloads = [];
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob);
    return "blob:test/1";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const render = (props: Partial<Parameters<typeof NotesTab>[0]> = {}) =>
  act(() =>
    root.render(
      createElement(NotesTab, {
        anchor: "cfi",
        annotations,
        theme,
        onJump: () => {},
        onUpdate: () => {},
        onDelete: () => {},
        exportBook: book,
        ...props,
      }),
    ),
  );

const exportButton = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="Export notes as ${label}"]`);

describe("exporting from the notes tab", () => {
  it("offers all four formats", () => {
    render();
    for (const label of ["Markdown", "HTML", "JSON", "CSV"])
      expect(exportButton(label)).not.toBeNull();
  });

  it("downloads a dated, named Markdown file containing the highlight", async () => {
    render();
    act(() => exportButton("Markdown")!.click());
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^eviota-notes-walden-\d{4}-\d{2}-\d{2}\.md$/);
    const text = await blobs[0]!.text();
    expect(text).toContain("> I went to the woods");
    expect(text).toContain('title: "Walden"');
  });

  it("downloads a CSV with the header and the row (the BOM itself is covered in annotation-export.test.ts)", async () => {
    render();
    act(() => exportButton("CSV")!.click());
    expect(downloads[0]).toMatch(/\.csv$/);
    expect(blobs[0]!.type).toBe("text/csv;charset=utf-8");
    const text = await blobs[0]!.text();
    // Blob.text() decodes the BOM away, so check the header and row instead.
    expect(text.split("\r\n")[0]).toContain("book,author,type");
    expect(text).toContain("I went to the woods");
  });

  it("shows no export controls when there is nothing to export or no book is known", () => {
    render({ annotations: [] });
    expect(exportButton("Markdown")).toBeNull();
    render({ exportBook: undefined });
    expect(exportButton("Markdown")).toBeNull();
  });
});
