import { describe, expect, it } from "vitest";
import { decodeText, detectEncoding, encodingName, isValidUtf8, sniffBom } from "@/lib/text-decode";

/** Encode a string with a legacy codec using Node's iconv-free tables. */
function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("sniffBom", () => {
  it("recognizes the UTF-8 BOM", () => {
    expect(sniffBom(bytes(0xef, 0xbb, 0xbf, 0x41))).toEqual({ label: "utf-8", length: 3 });
  });
  it("recognizes UTF-16 BOMs in both orders", () => {
    expect(sniffBom(bytes(0xff, 0xfe, 0x41, 0x00))?.label).toBe("utf-16le");
    expect(sniffBom(bytes(0xfe, 0xff, 0x00, 0x41))?.label).toBe("utf-16be");
  });
  it("returns null for plain bytes", () => {
    expect(sniffBom(utf8("hello"))).toBeNull();
  });
});

describe("isValidUtf8", () => {
  it("accepts ascii and multibyte sequences", () => {
    expect(isValidUtf8(utf8("plain ascii"))).toBe(true);
    expect(isValidUtf8(utf8("日本語のテキスト"))).toBe(true);
    expect(isValidUtf8(utf8("Ру́сский текст — тире"))).toBe(true);
  });
  it("rejects truncated and overlong sequences", () => {
    expect(isValidUtf8(bytes(0xe6, 0x97))).toBe(false);
    expect(isValidUtf8(bytes(0xc0, 0xaf))).toBe(false);
    expect(isValidUtf8(bytes(0x41, 0x82, 0x41))).toBe(false);
  });
});

describe("detectEncoding", () => {
  it("is certain about pure ascii", () => {
    const g = detectEncoding(utf8("Chapter One\n\nIt was a bright cold day."));
    expect(g.label).toBe("utf-8");
    expect(g.confidence).toBe(1);
  });

  it("follows the BOM over statistics", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("日本語")]);
    expect(detectEncoding(withBom)).toEqual({ label: "utf-8", confidence: 1 });
  });

  it("detects UTF-16LE without a BOM", () => {
    const src = "The quick brown fox jumps over the lazy dog again and again.";
    const buf = new Uint8Array(src.length * 2);
    for (let i = 0; i < src.length; i++) buf[i * 2] = src.charCodeAt(i);
    expect(detectEncoding(buf).label).toBe("utf-16le");
  });

  it("keeps utf-8 for valid multibyte text", () => {
    const g = detectEncoding(utf8("吾輩は猫である。名前はまだ無い。"));
    expect(g.label).toBe("utf-8");
    expect(g.confidence).toBeGreaterThan(0.9);
  });

  it("picks shift_jis for Shift-JIS bytes", () => {
    // 「吾輩は猫である。名前はまだ無い。」in Shift-JIS.
    const sjis = bytes(
      0x8c,
      0xe1,
      0x94,
      0x50,
      0x82,
      0xcd,
      0x94,
      0x4c,
      0x82,
      0xc5,
      0x82,
      0xa0,
      0x82,
      0xe9,
      0x81,
      0x42,
      0x96,
      0xbc,
      0x91,
      0x4f,
      0x82,
      0xcd,
      0x82,
      0xdc,
      0x82,
      0xbe,
      0x96,
      0xb3,
      0x82,
      0xa2,
      0x81,
      0x42,
    );
    const g = detectEncoding(sjis);
    expect(["shift_jis", "euc-jp", "gbk", "big5", "euc-kr"]).toContain(g.label);
    expect(g.label).toBe("shift_jis");
  });

  it("prefers a Cyrillic codec over Latin for KOI8-R bytes", () => {
    // "Привет мир, это простой текст" in KOI8-R.
    const koi = bytes(
      0xf0,
      0xd2,
      0xc9,
      0xd7,
      0xc5,
      0xd4,
      0x20,
      0xcd,
      0xc9,
      0xd2,
      0x2c,
      0x20,
      0xd0,
      0xd4,
      0xcf,
      0x20,
      0xd0,
      0xd2,
      0xcf,
      0xd3,
      0xd4,
      0xcf,
      0xca,
      0x20,
      0xd4,
      0xc5,
      0xcb,
      0xd3,
      0xd4,
    );
    expect(["koi8-r", "windows-1251"]).toContain(detectEncoding(koi).label);
  });
});

describe("decodeText", () => {
  it("strips the UTF-8 BOM from the decoded text", () => {
    const r = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Title")]));
    expect(r.text).toBe("Title");
    expect(r.label).toBe("utf-8");
    expect(r.overridden).toBe(false);
  });

  it("honors an explicit override and still reports detection", () => {
    const r = decodeText(utf8("plain"), "windows-1252");
    expect(r.label).toBe("windows-1252");
    expect(r.detected).toBe("utf-8");
    expect(r.overridden).toBe(true);
    expect(r.text).toBe("plain");
  });

  it("round-trips Shift-JIS through detection", () => {
    const sjis = bytes(0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x82, 0xa6, 0x82, 0xa8);
    const r = decodeText(sjis);
    expect(r.text).toBe("あいうえお");
  });

  it("never returns replacement characters for valid utf-8", () => {
    const r = decodeText(utf8("naïve café — déjà vu"));
    expect(r.text).toBe("naïve café — déjà vu");
    expect(r.text).not.toContain("\uFFFD");
  });
});

describe("encodingName", () => {
  it("maps known labels and falls back to the raw label", () => {
    expect(encodingName("shift_jis")).toBe("Japanese (Shift-JIS)");
    expect(encodingName("mystery")).toBe("MYSTERY");
  });
});
