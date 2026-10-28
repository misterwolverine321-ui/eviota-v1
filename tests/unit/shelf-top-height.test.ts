import { describe, expect, it } from "vitest";
import {
  parseShelfTopHeights,
  SHELF_TOP_DEFAULTS,
  withShelfTopHeight,
} from "@/lib/shelf-top-height";

const DEFAULTS = { wide: 500, narrow: 721 };

/**
 * The shelf reserves the height of the region above its grid while the books load. These values are
 * read from storage on every visit, so a bad value must fall back to a usable default, never to a
 * height that would push the grid off screen or collapse it.
 */
describe("parseShelfTopHeights", () => {
  it("uses the empty-shelf defaults when nothing is stored", () => {
    expect(parseShelfTopHeights(null)).toEqual(DEFAULTS);
    expect(SHELF_TOP_DEFAULTS).toEqual(DEFAULTS);
  });

  it("reads a stored pair", () => {
    expect(parseShelfTopHeights('{"wide":236,"narrow":300}')).toEqual({ wide: 236, narrow: 300 });
  });

  it("falls back to the defaults for corrupt JSON", () => {
    expect(parseShelfTopHeights("{not json")).toEqual(DEFAULTS);
  });

  it("falls back to the defaults when the stored value is not an object", () => {
    expect(parseShelfTopHeights("42")).toEqual(DEFAULTS);
    expect(parseShelfTopHeights("null")).toEqual(DEFAULTS);
    expect(parseShelfTopHeights('"text"')).toEqual(DEFAULTS);
  });

  it("falls back per field for a value that is text, zero, negative or absurdly tall", () => {
    expect(parseShelfTopHeights('{"wide":"300","narrow":-4}')).toEqual(DEFAULTS);
    expect(parseShelfTopHeights('{"wide":0,"narrow":5000}')).toEqual(DEFAULTS);
  });

  it("keeps the good field when only the other is bad", () => {
    expect(parseShelfTopHeights('{"wide":5000,"narrow":200}')).toEqual({ wide: 500, narrow: 200 });
    expect(parseShelfTopHeights('{"wide":300}')).toEqual({ wide: 300, narrow: 721 });
  });

  it("rounds a fractional height to whole pixels", () => {
    expect(parseShelfTopHeights('{"wide":235.6,"narrow":300.2}')).toEqual({
      wide: 236,
      narrow: 300,
    });
  });
});

describe("withShelfTopHeight", () => {
  it("replaces only the viewport that was measured", () => {
    expect(withShelfTopHeight(DEFAULTS, "narrow", 300)).toEqual({ wide: 500, narrow: 300 });
    expect(withShelfTopHeight(DEFAULTS, "wide", 236)).toEqual({ wide: 236, narrow: 721 });
  });

  it("returns null when the rounded value is already stored, so a resize writes nothing", () => {
    expect(withShelfTopHeight(DEFAULTS, "wide", 500.2)).toBeNull();
  });

  it("ignores a height that cannot be the region above a shelf", () => {
    expect(withShelfTopHeight(DEFAULTS, "wide", Number.NaN)).toBeNull();
    expect(withShelfTopHeight(DEFAULTS, "wide", 0)).toBeNull();
    expect(withShelfTopHeight(DEFAULTS, "wide", Number.POSITIVE_INFINITY)).toBeNull();
    expect(withShelfTopHeight(DEFAULTS, "narrow", 3000)).toBeNull();
  });

  it("survives a round trip through storage", () => {
    const next = withShelfTopHeight(DEFAULTS, "narrow", 300);
    expect(next).not.toBeNull();
    expect(parseShelfTopHeights(JSON.stringify(next))).toEqual(next);
  });
});
