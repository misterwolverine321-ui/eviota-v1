import { describe, expect, it } from "vitest";
import { bookOpenState, checkReattach } from "@/lib/book-open-state";

const blob = new Blob(["x"]);
describe("bookOpenState", () => {
  it("ready with record and file", () => expect(bookOpenState({}, blob)).toBe("ready"));
  it("evicted when file removed to free space", () =>
    expect(bookOpenState({ blobEvicted: true }, null)).toBe("evicted"));
  it("missing without a record", () => expect(bookOpenState(null, null)).toBe("missing"));
  it("missing when file absent but not evicted", () =>
    expect(bookOpenState({}, null)).toBe("missing"));
});

describe("checkReattach", () => {
  it("accepts a file of the same size as the removed original", () =>
    expect(checkReattach({ size: 1234 }, { size: 1234 })).toEqual({ ok: true }));
  it("rejects a different-sized file (another edition or the wrong book)", () =>
    expect(checkReattach({ size: 1234 }, { size: 1235 })).toEqual({ ok: false, reason: "size" }));
  it("accepts any file when the record has no stored size to compare", () => {
    expect(checkReattach({}, { size: 99 })).toEqual({ ok: true });
    expect(checkReattach({ size: 0 }, { size: 99 })).toEqual({ ok: true });
    expect(checkReattach(null, { size: 99 })).toEqual({ ok: true });
  });
});
