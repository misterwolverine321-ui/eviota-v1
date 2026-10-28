/**
 * Guided view (panel-by-panel reading).
 *
 * Comic pages are laid out as panels separated by light gutters. Detection is a
 * recursive projection split: find rows (or columns) that are almost entirely
 * page-background, cut there, and recurse on the pieces with the other axis.
 * That is exactly how a human eye reads a gutter, it needs no model, and it is
 * pure — the whole thing is unit-tested on synthetic pages.
 *
 * Everything here works on a downscaled 8-bit grayscale buffer, so a 3000 px
 * scan costs well under a frame.
 */

export interface PanelRect {
  /** Normalised 0..1 coordinates within the page. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectOptions {
  /** Share of a line's pixels that must look like background to be a gutter. */
  purity?: number;
  /** Minimum gutter thickness, as a share of the shorter page edge. */
  minGutter?: number;
  /** Panels smaller than this share of the page area are discarded. */
  minArea?: number;
  /** How many alternating splits to attempt. */
  maxDepth?: number;
}

const DEFAULTS = {
  purity: 0.985,
  minGutter: 0.012,
  minArea: 0.012,
  maxDepth: 6,
};

/**
 * Page background level. Artwork usually covers more of a page than the
 * gutters do, so a whole-page mode picks the ink, not the paper. The page
 * border ring is nearly always paper (or the black surround of a scan), so we
 * take the mode there instead. Falls back to the whole page when no size is
 * given.
 */
export function backgroundLevel(
  gray: Uint8Array | Uint8ClampedArray,
  width?: number,
  height?: number,
): number {
  const hist = new Uint32Array(32);
  if (width && height && width >= 4 && height >= 4 && gray.length >= width * height) {
    const ring = Math.max(1, Math.round(Math.min(width, height) * 0.02));
    for (let y = 0; y < height; y++) {
      const edgeRow = y < ring || y >= height - ring;
      for (let x = 0; x < width; x++) {
        if (edgeRow || x < ring || x >= width - ring) hist[gray[y * width + x] >> 3]++;
      }
    }
  } else {
    for (let i = 0; i < gray.length; i++) hist[gray[i] >> 3]++;
  }
  let best = 0;
  for (let b = 1; b < 32; b++) if (hist[b] > hist[best]) best = b;
  return best * 8 + 4;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Runs of consecutive background lines along one axis, in pixel indices. */
function gutterRuns(
  isBg: (i: number) => boolean,
  from: number,
  to: number,
  minRun: number,
): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = from; i <= to; i++) {
    if (isBg(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minRun) runs.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0 && to + 1 - start >= minRun) runs.push({ start, end: to });
  return runs;
}

/** Trim background margins off a rect so panels hug their artwork. */
function trim(
  rect: Rect,
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  bg: number,
  tol: number,
  purity: number,
): Rect | null {
  const rowIsBg = (y: number) => {
    let ink = 0;
    const span = rect.x1 - rect.x0 + 1;
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (Math.abs(gray[y * width + x] - bg) > tol) ink++;
    }
    return ink / span <= 1 - purity;
  };
  const colIsBg = (x: number) => {
    let ink = 0;
    const span = rect.y1 - rect.y0 + 1;
    for (let y = rect.y0; y <= rect.y1; y++) {
      if (Math.abs(gray[y * width + x] - bg) > tol) ink++;
    }
    return ink / span <= 1 - purity;
  };
  let { x0, y0, x1, y1 } = rect;
  while (y0 < y1 && rowIsBg(y0)) y0++;
  while (y1 > y0 && rowIsBg(y1)) y1--;
  while (x0 < x1 && colIsBg(x0)) x0++;
  while (x1 > x0 && colIsBg(x1)) x1--;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Detect panel rectangles on a grayscale page. Returns at least one rect (the
 * whole page) so callers never have to special-case an undetectable scan.
 */
export function detectPanels(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: DetectOptions = {},
): PanelRect[] {
  const o = { ...DEFAULTS, ...options };
  const whole: PanelRect[] = [{ x: 0, y: 0, w: 1, h: 1 }];
  if (width < 8 || height < 8 || gray.length < width * height) return whole;

  const bg = backgroundLevel(gray, width, height);
  const tol = 28;
  const minGutter = Math.max(2, Math.round(Math.min(width, height) * o.minGutter));
  const out: Rect[] = [];

  const rowIsBg = (rect: Rect) => (y: number) => {
    let ink = 0;
    const span = rect.x1 - rect.x0 + 1;
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (Math.abs(gray[y * width + x] - bg) > tol) ink++;
    }
    return ink / span <= 1 - o.purity;
  };
  const colIsBg = (rect: Rect) => (x: number) => {
    let ink = 0;
    const span = rect.y1 - rect.y0 + 1;
    for (let y = rect.y0; y <= rect.y1; y++) {
      if (Math.abs(gray[y * width + x] - bg) > tol) ink++;
    }
    return ink / span <= 1 - o.purity;
  };

  /** Split `rect` along `axis`; recurse on the pieces with the other axis. */
  const split = (rect: Rect, axis: "row" | "col", depth: number) => {
    const trimmed = trim(rect, gray, width, bg, tol, o.purity);
    if (!trimmed) return;
    rect = trimmed;
    if (depth >= o.maxDepth) {
      out.push(rect);
      return;
    }
    const from = axis === "row" ? rect.y0 : rect.x0;
    const to = axis === "row" ? rect.y1 : rect.x1;
    const runs = gutterRuns(axis === "row" ? rowIsBg(rect) : colIsBg(rect), from, to, minGutter);
    // Interior gutters only — the edges were already trimmed away.
    const cuts = runs.filter((r) => r.start > from && r.end < to);
    if (cuts.length === 0) {
      // Nothing to cut on this axis; try the other one before giving up.
      const other = axis === "row" ? "col" : "row";
      const otherRuns = gutterRuns(
        other === "row" ? rowIsBg(rect) : colIsBg(rect),
        other === "row" ? rect.y0 : rect.x0,
        other === "row" ? rect.y1 : rect.x1,
        minGutter,
      ).filter((r) =>
        other === "row"
          ? r.start > rect.y0 && r.end < rect.y1
          : r.start > rect.x0 && r.end < rect.x1,
      );
      if (otherRuns.length === 0) {
        out.push(rect);
        return;
      }
      split(rect, other, depth + 1);
      return;
    }

    let cursor = from;
    const pieces: Rect[] = [];
    for (const cut of cuts) {
      if (cut.start - 1 >= cursor) {
        pieces.push(
          axis === "row"
            ? { x0: rect.x0, x1: rect.x1, y0: cursor, y1: cut.start - 1 }
            : { y0: rect.y0, y1: rect.y1, x0: cursor, x1: cut.start - 1 },
        );
      }
      cursor = cut.end + 1;
    }
    if (cursor <= to) {
      pieces.push(
        axis === "row"
          ? { x0: rect.x0, x1: rect.x1, y0: cursor, y1: to }
          : { y0: rect.y0, y1: rect.y1, x0: cursor, x1: to },
      );
    }
    const next = axis === "row" ? "col" : "row";
    for (const piece of pieces) split(piece, next, depth + 1);
  };

  split({ x0: 0, y0: 0, x1: width - 1, y1: height - 1 }, "row", 0);

  const pageArea = width * height;
  const rects = out
    .filter((r) => ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)) / pageArea >= o.minArea)
    .map<PanelRect>((r) => ({
      x: r.x0 / width,
      y: r.y0 / height,
      w: (r.x1 - r.x0 + 1) / width,
      h: (r.y1 - r.y0 + 1) / height,
    }));
  return rects.length ? rects : whole;
}

/**
 * Reading order: top-to-bottom in row bands, left-to-right inside a band (or
 * right-to-left for manga). Panels whose vertical centres are within `band` of
 * each other count as the same row.
 */
export function orderPanels(rects: PanelRect[], rtl = false, band = 0.06): PanelRect[] {
  const rows: PanelRect[][] = [];
  for (const rect of [...rects].sort((a, b) => a.y - b.y)) {
    const row = rows.find((r) => Math.abs(r[0].y - rect.y) <= band);
    if (row) row.push(rect);
    else rows.push([rect]);
  }
  return rows.flatMap((row) => row.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x)));
}

/**
 * Zoom level and content-space centre for showing one panel in a viewport of
 * `view` CSS px, given the page laid out at `page` CSS px (fit size, zoom 1).
 * The panel gets a small margin and never zooms out below fit.
 */
export function panelView(
  rect: PanelRect,
  page: { w: number; h: number },
  view: { w: number; h: number },
  opts: { margin?: number; maxZoom?: number } = {},
): { zoom: number; cx: number; cy: number } {
  const margin = opts.margin ?? 0.04;
  const maxZoom = opts.maxZoom ?? 8;
  const pw = Math.max(1, rect.w * page.w * (1 + margin * 2));
  const ph = Math.max(1, rect.h * page.h * (1 + margin * 2));
  const zoom = Math.max(1, Math.min(maxZoom, Math.min(view.w / pw, view.h / ph)));
  return {
    zoom,
    // Centre of the panel in the *zoomed* page's coordinate space.
    cx: (rect.x + rect.w / 2) * page.w * zoom,
    cy: (rect.y + rect.h / 2) * page.h * zoom,
  };
}

/**
 * Downscaled grayscale of an image, for detection. Browser-only (needs
 * OffscreenCanvas); returns null when unavailable so callers fall back to
 * whole-page paging.
 */
export async function grayscaleFor(
  url: string,
  crop: { x: number; w: number } | null,
  maxWidth = 420,
): Promise<{ gray: Uint8Array; width: number; height: number } | null> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined")
    return null;
  try {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const sx = crop ? crop.x * bitmap.width : 0;
    const sw = crop ? crop.w * bitmap.width : bitmap.width;
    const scale = Math.min(1, maxWidth / sw);
    const w = Math.max(8, Math.round(sw * scale));
    const h = Math.max(8, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, sx, 0, sw, bitmap.height, 0, 0, w, h);
    bitmap.close?.();
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    return { gray, width: w, height: h };
  } catch {
    return null;
  }
}
