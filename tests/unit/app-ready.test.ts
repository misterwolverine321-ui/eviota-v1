import { describe, expect, it } from "vitest";
import { benchRequested, markAppReady } from "@/lib/app-ready";

/** The part of a Document `markAppReady` touches. */
function fakeDocument() {
  const dataset: Record<string, string> = {};
  return { doc: { documentElement: { dataset } } as unknown as Document, dataset };
}

describe("markAppReady", () => {
  it("sets data-app-ready=1 on the root element, and is harmless to repeat", () => {
    const { doc, dataset } = fakeDocument();
    expect(dataset["appReady"]).toBeUndefined();
    markAppReady(doc);
    markAppReady(doc);
    expect(dataset["appReady"]).toBe("1");
  });
});

describe("benchRequested", () => {
  it("is true only when the address has a bench parameter", () => {
    expect(benchRequested("?bench")).toBe(true);
    expect(benchRequested("?bench=1")).toBe(true);
    expect(benchRequested("?x=1&bench")).toBe(true);
  });

  it("is false for an ordinary address and for look-alikes", () => {
    expect(benchRequested("")).toBe(false);
    expect(benchRequested("?")).toBe(false);
    expect(benchRequested("?benchmark")).toBe(false);
    expect(benchRequested("?x=bench")).toBe(false);
    // The router's hash is not part of `location.search`.
    expect(benchRequested("#/?bench")).toBe(false);
  });
});
