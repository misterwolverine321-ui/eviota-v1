// Node environment on purpose, like backup-legacy.test.ts: fake-indexeddb with Node's Blob.
import "fake-indexeddb/auto";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  listAllAnnotations,
  listAnnotations,
  repairStored,
  setAnchorCfi,
  type Annotation,
} from "@/lib/annotations";
import { exportBackup } from "@/lib/backup";
import { getDb } from "@/lib/db";
import { REAL_PAIRS } from "./fixtures/old-annotations";

/**
 * Old triple-click marks are repaired the first time anything reads them, and the repair is
 * written back so it happens once. The records are the real ones from the checkpoint-8 build.
 */

beforeAll(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  });
});

const T0 = 1_700_000_000_000;

/** The three overshooting records of REAL_PAIRS, as the old build stored them. */
function oldRecords(bookId: string): Annotation[] {
  return [0, 3, 4].map((i) => ({
    ...JSON.parse(JSON.stringify(REAL_PAIRS[i]![0])),
    id: `${bookId}-${i}`,
    bookId,
    createdAt: T0 + i,
    updatedAt: T0 + 1000 + i,
  }));
}
const fixedEnd = (i: number) => (REAL_PAIRS[i]![1].anchor as { end: number }).end;

async function seed(rows: Annotation[]) {
  const db = await getDb();
  for (const row of rows) await db.put("annotations", row);
}
const raw = async (id: string) => (await (await getDb()).get("annotations", id)) as Annotation;
const end = (a: Annotation) => (a.anchor as { end: number }).end;

describe("annotations are repaired when read", () => {
  it("listAnnotations returns the repaired marks and stores them, once", async () => {
    const rows = oldRecords("book-list");
    await seed(rows);
    const got = await listAnnotations("book-list");
    expect(got.map(end).sort()).toEqual([fixedEnd(0), fixedEnd(3), fixedEnd(4)].sort());
    for (const [n, i] of [0, 3, 4].entries()) {
      const stored = await raw(rows[n]!.id);
      expect(end(stored)).toBe(fixedEnd(i));
      expect((stored.anchor as { cfi?: string }).cfi).toBeUndefined();
      // a correction, not an edit by the reader
      expect(stored.updatedAt).toBe(rows[n]!.updatedAt);
    }
  });

  it("listAllAnnotations repairs too", async () => {
    const rows = oldRecords("book-all");
    await seed(rows);
    const got = (await listAllAnnotations()).filter((a) => a.bookId === "book-all");
    expect(got.map(end).sort()).toEqual([fixedEnd(0), fixedEnd(3), fixedEnd(4)].sort());
    expect(end(await raw(rows[0]!.id))).toBe(fixedEnd(0));
  });

  it("a backup exported afterwards carries the repaired marks", async () => {
    const rows = oldRecords("book-backup");
    await seed(rows);
    const zip = unzipSync(
      new Uint8Array(await (await exportBackup({ includeBlobs: false })).arrayBuffer()),
    );
    const exported = JSON.parse(new TextDecoder().decode(zip["annotations.json"]!)) as Annotation[];
    const mine = exported.filter((a) => a.bookId === "book-backup");
    expect(mine.map(end).sort()).toEqual([fixedEnd(0), fixedEnd(3), fixedEnd(4)].sort());
  });

  it("leaves marks that never overshot exactly as they are", async () => {
    const clean: Annotation = {
      ...JSON.parse(JSON.stringify(REAL_PAIRS[1]![0])),
      id: "book-clean-0",
      bookId: "book-clean",
      createdAt: T0,
      updatedAt: T0 + 5,
    };
    const pdf: Annotation = {
      ...JSON.parse(JSON.stringify(REAL_PAIRS[2]![0])),
      id: "book-clean-1",
      bookId: "book-clean",
      createdAt: T0,
      updatedAt: T0 + 6,
    };
    await seed([clean, pdf]);
    const got = await listAnnotations("book-clean");
    expect(got).toHaveLength(2);
    expect(await raw(clean.id)).toEqual(clean);
    expect(await raw(pdf.id)).toEqual(pdf);
  });
});

describe("repairStored", () => {
  it("repairs what is stored now, not the copy it was handed, so a newer edit survives", async () => {
    const [stale] = oldRecords("book-race");
    await seed([stale!]);
    // The reader saved a note after `stale` was read and before the repair ran.
    const db = await getDb();
    await db.put("annotations", { ...stale!, note: "written meanwhile", updatedAt: T0 + 9999 });
    const [done] = await repairStored(db, [stale!]);
    expect(done!.note).toBe("written meanwhile");
    expect(end(done!)).toBe(fixedEnd(0));
    const stored = await raw(stale!.id);
    expect(stored.note).toBe("written meanwhile");
    expect(stored.updatedAt).toBe(T0 + 9999);
    expect(end(stored)).toBe(fixedEnd(0));
  });

  it("drops a mark deleted between the read and the repair instead of bringing it back", async () => {
    const [gone] = oldRecords("book-gone");
    await seed([gone!]);
    const db = await getDb();
    await db.delete("annotations", gone!.id);
    expect(await repairStored(db, [gone!])).toEqual([]);
    expect(await db.get("annotations", gone!.id)).toBeUndefined();
  });

  it("still hands back the repaired marks when the store cannot be written", async () => {
    const rows = oldRecords("book-readonly");
    const broken = {
      transaction() {
        throw new Error("QuotaExceededError");
      },
    };
    const got = await repairStored(broken as never, rows);
    expect(got.map(end).sort()).toEqual([fixedEnd(0), fixedEnd(3), fixedEnd(4)].sort());
  });

  it("does not open a transaction when nothing needs repair", async () => {
    const transaction = vi.fn();
    const fine = JSON.parse(JSON.stringify(REAL_PAIRS[1]![1]));
    const row = { ...fine, id: "x", bookId: "book-fine", createdAt: 1, updatedAt: 1 } as Annotation;
    expect(await repairStored({ transaction } as never, [row])).toEqual([row]);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("setAnchorCfi", () => {
  const cfi = "epubcfi(/6/2!/4/6,/1:0,/1:104)";

  it("gives a repaired mark the CFI the engine derived, without counting as an edit", async () => {
    const rows = oldRecords("book-cfi");
    await seed(rows);
    const [repaired] = await listAnnotations("book-cfi");
    expect((repaired!.anchor as { cfi?: string }).cfi).toBeUndefined();
    const next = await setAnchorCfi(repaired!.id, cfi);
    expect((next!.anchor as { cfi?: string }).cfi).toBe(cfi);
    const stored = await raw(repaired!.id);
    expect((stored.anchor as { cfi?: string }).cfi).toBe(cfi);
    expect(stored.updatedAt).toBe(repaired!.updatedAt);
    // the quote the repair fixed is still the fixed one
    expect(end(stored)).toBe(end(repaired!));
  });

  it("never replaces a CFI that is already there", async () => {
    const rows = oldRecords("book-cfi-keep");
    await seed([{ ...rows[0]!, id: "keep-1" }]);
    const before = await raw("keep-1");
    // the old CFI is dropped by the repair, so seed an already-repaired record that has one
    const db = await getDb();
    const withCfi = {
      ...before,
      anchor: {
        ...(before.anchor as object),
        cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)",
        end: 1,
        quote: "x",
      },
      text: "x",
    };
    await db.put("annotations", withCfi);
    const next = await setAnchorCfi("keep-1", cfi);
    expect((next!.anchor as { cfi?: string }).cfi).toBe("epubcfi(/6/2!/4/2,/1:0,/1:5)");
    expect(await raw("keep-1")).toEqual(withCfi);
  });

  it("ignores marks that are gone and anchors that are not text", async () => {
    expect(await setAnchorCfi("no-such-mark", cfi)).toBeUndefined();
    const pdf: Annotation = {
      ...JSON.parse(JSON.stringify(REAL_PAIRS[2]![0])),
      id: "pdf-cfi",
      bookId: "book-cfi-pdf",
      createdAt: T0,
      updatedAt: T0,
    };
    await seed([pdf]);
    expect(await setAnchorCfi("pdf-cfi", cfi)).toEqual(pdf);
    expect(await raw("pdf-cfi")).toEqual(pdf);
  });
});
