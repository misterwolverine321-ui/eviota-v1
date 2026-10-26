// @vitest-environment node
// The covers are read as bytes: the test checks what is in the files, not what a decoder would show.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const SLUGS = ["alice", "tell-tale-heart", "walden"];
const covers = (slug: string) => readFileSync(join(root, "src/assets/covers", `${slug}.jpg`));

/** Names of the metadata formats (EXIF, XMP, IPTC, Photoshop) that a file can carry. */
const TAGS = [
  "digitalsourcetype",
  "photoshop:",
  "Iptc",
  "IPTC",
  "Exif",
  "XMP",
  "xmp",
  "Photoshop 3.0",
  "http://ns.adobe.com",
];

describe("the cover images", () => {
  it.each(SLUGS)("%s.jpg is a real JPEG with no metadata in it", (slug) => {
    const bytes = covers(slug);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    const text = bytes.toString("latin1");
    for (const tag of TAGS) expect(text, `${slug}.jpg contains "${tag}"`).not.toContain(tag);
    // No APP1 (Exif/XMP) or APP13 (IPTC/Photoshop) segment: the JPEG starts with JFIF only.
    for (let i = 2; i < bytes.length - 1; i++) {
      if (bytes[i] !== 0xff) continue;
      expect([0xe1, 0xed], `marker FF${bytes[i + 1]!.toString(16)} in ${slug}.jpg`).not.toContain(
        bytes[i + 1],
      );
    }
  });

  it.each(SLUGS)("the %s cover inside its sample EPUB is the same file", (slug) => {
    const epub = unzipSync(
      new Uint8Array(readFileSync(join(root, "public/samples", `${slug}.epub`))),
    );
    const inside = epub["OEBPS/cover.jpg"];
    expect(inside, "the sample has a cover").toBeDefined();
    expect(Buffer.from(inside!).equals(covers(slug))).toBe(true);
  });
});
