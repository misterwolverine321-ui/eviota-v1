import { inflateSync } from "node:zlib";

/**
 * Reads one pixel from a PNG, so a test can check what was painted rather than what the DOM says.
 * Handles 8-bit RGB and RGBA, which is what the browser writes for a screenshot; anything else
 * throws, so a surprise fails loudly instead of reading the wrong byte.
 */
export function pngPixel(png: Buffer, x: number, y: number): [number, number, number] {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`PNG bit depth ${data[8]} is not supported`);
      colorType = data[9]!;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (colorType !== 2 && colorType !== 6)
    throw new Error(`PNG colour type ${colorType} unsupported`);
  if (x < 0 || y < 0 || x >= width || y >= height) throw new Error("pixel outside the image");

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]!;
    const src = row * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? out[row * stride + i - bpp]! : 0;
      const up = row > 0 ? out[(row - 1) * stride + i]! : 0;
      const upLeft = row > 0 && i >= bpp ? out[(row - 1) * stride + i - bpp]! : 0;
      let value = raw[src + i]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`PNG filter ${filter} unsupported`);
      out[row * stride + i] = value & 0xff;
    }
  }
  const at = y * stride + x * bpp;
  return [out[at]!, out[at + 1]!, out[at + 2]!];
}
