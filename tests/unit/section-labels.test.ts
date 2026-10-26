import { describe, expect, it } from "vitest";
import { labelFromView, sectionLabeller } from "@/lib/section-labels";

// A book shaped the way foliate's EPUB reader hands one over: sections with ids, a table of contents
// whose hrefs name a section id (and maybe a fragment), and the two functions that split them.
function fakeBook(toc: unknown[], sectionIds: string[]) {
  return {
    sections: sectionIds.map((id) => ({ id })),
    toc,
    splitTOCHref: (href: string) => href?.split("#") ?? [],
    getTOCFragment: () => null,
  };
}

describe("sectionLabeller", () => {
  const ids = ["s1", "s2", "s3", "s4", "s5"];

  it("labels a section with its table-of-contents entry, and an unlisted one with the entry before it", async () => {
    const label = await sectionLabeller(
      fakeBook(
        [
          { label: "Opening", href: "s1" },
          { label: "The Harbour", href: "s3" },
        ],
        ids,
      ),
    );
    expect(label(1)).toBe("Opening");
    expect(label(2)).toBe("Opening");
    expect(label(3)).toBe("The Harbour");
    expect(label(4)).toBe("The Harbour");
    expect(label(5)).toBe("The Harbour");
  });

  it("gives no label to a section before the first entry", async () => {
    const label = await sectionLabeller(fakeBook([{ label: "Part one", href: "s2" }], ids));
    expect(label(1)).toBe("");
    expect(label(2)).toBe("Part one");
  });

  it("uses the first entry that points into a section, nested or not", async () => {
    const label = await sectionLabeller(
      fakeBook(
        [
          {
            label: "Book I",
            href: "s1",
            subitems: [
              { label: "Chapter 1", href: "s1#c1" },
              { label: "Chapter 2", href: "s2" },
            ],
          },
        ],
        ids,
      ),
    );
    expect(label(1)).toBe("Book I");
    expect(label(2)).toBe("Chapter 2");
    expect(label(5)).toBe("Chapter 2");
  });

  it("rounds the unit as the reader does", async () => {
    const label = await sectionLabeller(fakeBook([{ label: "Only", href: "s1" }], ids));
    expect(label(1.2)).toBe("Only");
  });

  it("answers an empty label for every unit when the book has no table of contents", async () => {
    expect((await sectionLabeller(fakeBook([], ids)))(1)).toBe("");
    expect((await sectionLabeller({ sections: [], toc: [{ label: "x", href: "a" }] }))(1)).toBe("");
    // A format whose parser does not offer the splitting functions.
    expect(
      (await sectionLabeller({ sections: [{ id: "a" }], toc: [{ label: "x", href: "a" }] }))(1),
    ).toBe("");
  });

  it("does not throw when the table of contents is malformed", async () => {
    const book = fakeBook([{ label: "Broken", href: undefined }], ids);
    const label = await sectionLabeller(book);
    expect(() => label(1)).not.toThrow();
  });
});

describe("labelFromView", () => {
  it("reads the entry foliate's view gives the section, counting units from 1", () => {
    const seen: number[] = [];
    const view = {
      getProgressOf: (index: number) => {
        seen.push(index);
        return { tocItem: { label: "  Chapter 3 " } };
      },
    };
    expect(labelFromView(view, 4)).toBe("Chapter 3");
    expect(seen).toEqual([3]);
  });

  it("is empty when the view has no entry, no method, or throws", () => {
    expect(labelFromView({ getProgressOf: () => ({ tocItem: null }) }, 1)).toBe("");
    expect(labelFromView({}, 1)).toBe("");
    expect(
      labelFromView(
        {
          getProgressOf: () => {
            throw new Error("closed");
          },
        },
        1,
      ),
    ).toBe("");
  });
});
