import { describe, expect, it } from "vitest";
import { rtfToText } from "@/lib/rtf";
import { readTextDocument } from "@/lib/text-document";

const rtf = (body: string) => `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times;}}\\pard ${body}}`;

describe("rtfToText", () => {
  it("makes a paragraph break of \\par, so a document is not one paragraph", () => {
    const text = rtfToText(
      rtf("First paragraph.\\par Second paragraph.\\par Third paragraph.\\par"),
    );
    expect(text).toBe("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  });

  it("keeps \\line a soft line break inside its paragraph", () => {
    const text = rtfToText(rtf("Line one\\line Line two\\par Next paragraph\\par"));
    expect(text).toBe("Line one\nLine two\n\nNext paragraph");
  });

  it("does not let empty paragraphs pile up blank lines", () => {
    expect(rtfToText(rtf("A\\par\\par\\par\\par B"))).toBe("A\n\nB");
  });

  it("does not take \\pard (paragraph defaults) for a paragraph end", () => {
    expect(rtfToText(rtf("Only one \\pard paragraph here"))).toBe("Only one paragraph here");
  });

  it("decodes escapes and keeps the text of paragraphs intact", () => {
    expect(rtfToText(rtf("caf\\'e9\\par \\u8212? done\\par"))).toContain("café");
  });
});

describe("readTextDocument", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("turns an RTF file into one paragraph per \\par", () => {
    const doc = readTextDocument(
      bytes(rtf("Alpha one.\\par Bravo two.\\par Charlie three.\\par")),
      "notes.rtf",
      null,
    );
    expect(doc.paras).toEqual(["Alpha one.", "Bravo two.", "Charlie three."]);
  });

  it("recognises RTF by its content when the name does not say so", () => {
    const doc = readTextDocument(bytes(rtf("One.\\par Two.\\par")), "notes.txt", null);
    expect(doc.paras).toEqual(["One.", "Two."]);
  });

  it("splits plain text on blank lines and trims each paragraph", () => {
    const doc = readTextDocument(
      bytes("First\r\nline\r\n\r\n  Second  \n\n\n\nThird"),
      "a.txt",
      null,
    );
    expect(doc.paras).toEqual(["First\nline", "Second", "Third"]);
  });

  it("uses the encoding it is told to", () => {
    // 0xE9 is "é" in Windows-1252 and not valid UTF-8 on its own.
    const latin = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    expect(readTextDocument(latin, "a.txt", "windows-1252").paras).toEqual(["café"]);
  });
});
