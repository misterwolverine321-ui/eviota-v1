/**
 * Header-only image dimension probe.
 *
 * Comic archives hold hundreds of pages; decoding each one just to learn its
 * aspect ratio costs minutes. Every format below states its size in the first
 * few bytes, so we read a small slice of the blob and parse it directly. Only
 * exotic formats (AVIF/HEIC and friends) fall back to a real decode.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** Bytes read from the head of each file — enough for any header below. */
const HEAD_BYTES = 65536;

function u16be(v: DataView, o: number) {
  return v.getUint16(o, false);
}

function parsePng(v: DataView): ImageSize | null {
  if (v.byteLength < 24) return null;
  if (v.getUint32(0, false) !== 0x89504e47) return null;
  return { width: v.getUint32(16, false), height: v.getUint32(20, false) };
}

function parseGif(v: DataView, b: Uint8Array): ImageSize | null {
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
}

function parseBmp(v: DataView, b: Uint8Array): ImageSize | null {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) return null;
  return {
    width: Math.abs(v.getInt32(18, true)),
    height: Math.abs(v.getInt32(22, true)),
  };
}

function parseJpeg(v: DataView, b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = u16be(v, o + 2);
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      return { height: u16be(v, o + 5), width: u16be(v, o + 7) };
    }
    if (len <= 0) return null;
    o += 2 + len;
  }
  return null;
}

function parseWebp(v: DataView, b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const chunk = tag(12);
  if (chunk === "VP8X") {
    const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return { width: w, height: h };
  }
  if (chunk === "VP8 ") {
    return {
      width: v.getUint16(26, true) & 0x3fff,
      height: v.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = v.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * Read an image's dimensions without decoding it. Returns `{0,0}` when the
 * format is unknown and no decoder is available.
 */
export async function probeImageSize(blob: Blob): Promise<ImageSize> {
  try {
    const head = await blob.slice(0, HEAD_BYTES).arrayBuffer();
    const bytes = new Uint8Array(head);
    const view = new DataView(head);
    const parsed =
      parsePng(view) ??
      parseJpeg(view, bytes) ??
      parseGif(view, bytes) ??
      parseWebp(view, bytes) ??
      parseBmp(view, bytes);
    if (parsed && parsed.width > 0 && parsed.height > 0) return parsed;
  } catch {
    /* fall through to the decoder */
  }

  // Unknown container (AVIF/HEIC, or a truncated header): decode once.
  if (typeof createImageBitmap !== "undefined") {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size;
    } catch {
      /* ignore */
    }
  }
  return { width: 0, height: 0 };
}
