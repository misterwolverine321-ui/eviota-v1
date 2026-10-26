import { describe, expect, it } from "vitest";
import { needsCoverBackfill } from "@/lib/cover-backfill";
import type { BookRecord } from "@/lib/db";

const book = (patch: Partial<BookRecord>): BookRecord => ({
  id: "1",
  title: "Issue #1",
  author: "Unknown author",
  format: "cbz",
  fileName: "issue-1.cbz",
  size: 1000,
  addedAt: 0,
  hasCover: false,
  progress: null,
  ...patch,
});

describe("needsCoverBackfill", () => {
  it("selects a comic with no cover", () => {
    expect(needsCoverBackfill(book({}))).toBe(true);
  });

  it("selects cbr and cb7 archives too", () => {
    expect(needsCoverBackfill(book({ fileName: "a.cbr", format: "cbr" }))).toBe(true);
    expect(needsCoverBackfill(book({ fileName: "a.cb7", format: "cb7" }))).toBe(true);
  });

  it("skips comics that already have a cover", () => {
    expect(needsCoverBackfill(book({ hasCover: true }))).toBe(false);
    expect(needsCoverBackfill(book({ cover: new Blob(["x"]) }))).toBe(false);
  });

  it("skips comics whose file was evicted", () => {
    expect(needsCoverBackfill(book({ blobEvicted: true }))).toBe(false);
  });

  it("skips non-comic formats", () => {
    expect(needsCoverBackfill(book({ fileName: "a.epub", format: "epub" }))).toBe(false);
    expect(needsCoverBackfill(book({ fileName: "a.pdf", format: "pdf" }))).toBe(false);
  });

  it("skips unknown extensions", () => {
    expect(needsCoverBackfill(book({ fileName: "a.zzz", format: "zzz" }))).toBe(false);
  });
});
