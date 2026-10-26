import { describe, expect, it } from "vitest";
import { repairOvershoot } from "@/lib/anchor-repair";
import type { Annotation } from "@/lib/annotations";
import { REAL_PAIRS } from "./fixtures/old-annotations";

/**
 * Checkpoint 8 and earlier stored a triple-click selection with the end of the NEXT
 * paragraph: `anchor.end`, `quote` and `suffix` ran on while `text` (the raw selection)
 * stayed right. `REAL_PAIRS` are records copied from backups made by that real build and by
 * the current build from the same gestures on the same file, so the expected values below
 * come from what the fixed build stores, not from the repair's own reasoning.
 */

const full = (partial: unknown): Annotation =>
  ({
    id: "a1",
    bookId: "b1",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    ...JSON.parse(JSON.stringify(partial)),
  }) as Annotation;

const textAnchor = (a: Annotation) => {
  if (a.anchor.kind !== "text") throw new Error("expected a text anchor");
  return a.anchor;
};

const pairs = REAL_PAIRS.map(([oldRow, newRow]) => ({ old: full(oldRow), fixed: full(newRow) }));
const overshooting = pairs.filter(
  (p) => p.old.anchor.kind === "text" && textAnchor(p.old).end !== textAnchor(p.fixed).end,
);

describe("repairOvershoot: real records", () => {
  it("the fixture holds the three overshooting EPUB records and two that never overshot", () => {
    expect(pairs).toHaveLength(5);
    expect(overshooting).toHaveLength(3);
  });

  it.each(overshooting.map((p, i) => [i, p] as const))(
    "overshooting record %i becomes exactly what the fixed build stores",
    (_i, { old, fixed }) => {
      const repaired = repairOvershoot(old);
      expect(repaired).not.toBeNull();
      const got = textAnchor(repaired!);
      const want = textAnchor(fixed);
      expect({
        page: got.page,
        start: got.start,
        end: got.end,
        quote: got.quote,
        prefix: got.prefix,
        suffix: got.suffix,
      }).toEqual({
        page: want.page,
        start: want.start,
        end: want.end,
        quote: want.quote,
        prefix: want.prefix,
        suffix: want.suffix,
      });
    },
  );

  it("drops the creation-time CFI, which also covers the next paragraph", () => {
    for (const { old } of overshooting) {
      expect(textAnchor(old).cfi).toBeTruthy();
      expect(textAnchor(repairOvershoot(old)!).cfi).toBeUndefined();
    }
  });

  it("changes nothing else about the record, and not the time it was last edited", () => {
    for (const { old } of overshooting) {
      const repaired = repairOvershoot(old)!;
      expect({ ...repaired, anchor: null }).toEqual({ ...old, anchor: null });
    }
  });

  it("leaves records that never overshot alone (last block, PDF rect, and the fixed build's own)", () => {
    expect(repairOvershoot(pairs[1]!.old)).toBeNull(); // last block of the section
    expect(repairOvershoot(pairs[2]!.old)).toBeNull(); // PDF rect anchor
    for (const { fixed } of pairs) expect(repairOvershoot(fixed)).toBeNull();
  });

  it("is idempotent: a repaired record needs no second repair", () => {
    for (const { old } of overshooting) {
      expect(repairOvershoot(repairOvershoot(old)!)).toBeNull();
    }
  });

  it("does not modify the record it is given", () => {
    const old = overshooting[0]!.old;
    const frozen = JSON.stringify(old);
    Object.freeze(old);
    Object.freeze(old.anchor);
    repairOvershoot(old);
    expect(JSON.stringify(old)).toBe(frozen);
  });
});

describe("repairOvershoot: where the text and the stored quote disagree", () => {
  const make = (over: {
    text?: string | undefined;
    quote: string;
    start?: number;
    end?: number;
    prefix?: string;
    suffix?: string;
    type?: Annotation["type"];
  }): Annotation =>
    full({
      type: over.type ?? "highlight",
      color: "yellow",
      text: over.text,
      anchor: {
        kind: "text",
        page: 2,
        start: over.start ?? 10,
        end: over.end ?? (over.start ?? 10) + over.quote.length,
        quote: over.quote,
        prefix: over.prefix ?? "before",
        suffix: over.suffix ?? "after",
        cfi: "epubcfi(/6/4!/4,/2/1:0,/6/1:9)",
      },
    });

  it("cuts a quote that runs on past the selection, and pulls the lost tail into the context", () => {
    const repaired = repairOvershoot(
      make({ text: "Alpha one.", quote: "Alpha one. Beta two.", suffix: "Gamma three." }),
    )!;
    const a = textAnchor(repaired);
    expect(a.quote).toBe("Alpha one.");
    expect(a.start).toBe(10);
    expect(a.end).toBe(20);
    expect(a.suffix).toBe(" Beta two.Gamma three.");
    expect(a.prefix).toBe("before");
  });

  it("keeps the context at 32 characters, the same as a fresh anchor", () => {
    const tail = "x".repeat(50);
    const a = textAnchor(
      repairOvershoot(make({ text: "One.", quote: `One.${tail}`, suffix: "zzz" }))!,
    );
    expect(a.suffix).toBe("x".repeat(32));
  });

  it("compares ignoring whitespace, because the text map collapses runs and drops line breaks", () => {
    const a = textAnchor(
      repairOvershoot(make({ text: "Alpha\n\none", quote: "Alpha one. Beta", suffix: "" }))!,
    );
    expect(a.quote).toBe("Alpha one");
    expect(a.end).toBe(19);
    expect(a.suffix).toBe(". Beta");
  });

  it("does not touch a genuine selection across paragraphs (same words, different spacing)", () => {
    expect(repairOvershoot(make({ text: "One.\n\nTwo.", quote: "One.Two." }))).toBeNull();
    expect(repairOvershoot(make({ text: "One.\n\nTwo.", quote: "One. Two." }))).toBeNull();
  });

  it("does not touch a quote that differs from the text only in trailing space", () => {
    expect(repairOvershoot(make({ text: "One.", quote: "One. " }))).toBeNull();
  });

  it("does nothing when the quote is shorter than the text, or does not begin with it", () => {
    expect(repairOvershoot(make({ text: "One. Two.", quote: "One." }))).toBeNull();
    expect(repairOvershoot(make({ text: "Other words", quote: "One. Two." }))).toBeNull();
    expect(repairOvershoot(make({ text: "ONE.", quote: "One. Two." }))).toBeNull();
  });

  it("does nothing when the stored offsets and the stored quote disagree about its length", () => {
    expect(
      repairOvershoot(make({ text: "One.", quote: "One. Two.", start: 10, end: 14 })),
    ).toBeNull();
    expect(
      repairOvershoot(make({ text: "One.", quote: "One. Two.", start: 10, end: 99 })),
    ).toBeNull();
  });

  it("does nothing without a text or a quote to compare", () => {
    expect(repairOvershoot(make({ text: undefined, quote: "One. Two." }))).toBeNull();
    expect(repairOvershoot(make({ text: "", quote: "One. Two." }))).toBeNull();
    expect(repairOvershoot(make({ text: "   ", quote: "One. Two." }))).toBeNull();
    expect(repairOvershoot(make({ text: "One.", quote: "" }))).toBeNull();
  });

  it("only looks at marks made from a selection, never at bookmarks or other kinds", () => {
    const base = { text: "One.", quote: "One. Two." };
    expect(repairOvershoot(make({ ...base, type: "highlight" }))).not.toBeNull();
    expect(repairOvershoot(make({ ...base, type: "underline" }))).not.toBeNull();
    expect(repairOvershoot(make({ ...base, type: "strike" }))).not.toBeNull();
    expect(repairOvershoot(make({ ...base, type: "bookmark" }))).toBeNull();
    expect(repairOvershoot(make({ ...base, type: "ink" }))).toBeNull();
  });

  it("does not guess for CFI or rect anchors", () => {
    expect(
      repairOvershoot(
        full({ type: "highlight", color: "yellow", text: "x", anchor: { kind: "cfi", cfi: "e" } }),
      ),
    ).toBeNull();
  });

  it("copes with a record that is not shaped like one", () => {
    expect(repairOvershoot(null as unknown as Annotation)).toBeNull();
    expect(repairOvershoot({} as Annotation)).toBeNull();
    expect(
      repairOvershoot(full({ type: "highlight", color: "yellow", text: "x", anchor: null })),
    ).toBeNull();
  });
});
