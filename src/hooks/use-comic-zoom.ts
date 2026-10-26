import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** Zoom level a double-tap jumps to. */
export const TAP_ZOOM = 2.75;
/** A pan gesture keeps suppressing taps for this long after the finger lifts. */
const DRAG_TAP_GUARD = 300;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Scroll offsets to apply once the new layout size is committed. */
type ScrollPlan = (container: HTMLElement) => { x: number; y: number } | null;

/**
 * Cursor-anchored zoom for the comic surface.
 *
 * Quality note: nothing here uses `transform: scale()`. The panel is laid out
 * at `base * zoom` CSS pixels and the browser resamples the *source* bitmap at
 * that size, so zooming reveals real detail (up to the scan's native
 * resolution) instead of magnifying an already-downscaled raster — the
 * CDisplayEx behaviour. Panning is plain scrolling of the same container.
 *
 * Anchoring is *measured*, never predicted. The old implementation assumed the
 * scrollable content grows in proportion to the zoom, which is false here: the
 * surface has padding and centres content that is smaller than the frame, so
 * the point under the cursor drifted (and jumped on the first step away from
 * fit). Instead we record which fraction of the content box sits under the
 * cursor, then re-measure the content after the new layout commits and set the
 * scroll offsets so that same fraction lands back under the cursor.
 */
export function useComicZoom(
  containerRef: React.RefObject<HTMLElement | null>,
  contentRef?: React.RefObject<HTMLElement | null>,
) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const pendingScroll = useRef<ScrollPlan | null>(null);
  /** Bumped so the layout effect runs even when the zoom value is unchanged. */
  const [tick, setTick] = useState(0);

  /** Content box position inside the container's scroll space. */
  const contentOrigin = (container: HTMLElement, content: HTMLElement) => {
    const cr = content.getBoundingClientRect();
    const br = container.getBoundingClientRect();
    return {
      x: container.scrollLeft + (cr.left - br.left),
      y: container.scrollTop + (cr.top - br.top),
      w: cr.width,
      h: cr.height,
    };
  };

  /** Zoom to `next`, keeping the content under (clientX, clientY) still. */
  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const el = containerRef.current;
      const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
      if (!el || target === zoomRef.current) return;
      const rect = el.getBoundingClientRect();
      // Viewport-relative anchor: where the point must stay on screen.
      const vx = clientX == null ? rect.width / 2 : clamp(clientX - rect.left, 0, rect.width);
      const vy = clientY == null ? rect.height / 2 : clamp(clientY - rect.top, 0, rect.height);
      const content = contentRef?.current ?? null;

      if (content) {
        const before = contentOrigin(el, content);
        // Which fraction of the content is under the anchor right now.
        const fx = before.w > 0 ? clamp((el.scrollLeft + vx - before.x) / before.w, 0, 1) : 0.5;
        const fy = before.h > 0 ? clamp((el.scrollTop + vy - before.y) / before.h, 0, 1) : 0.5;
        pendingScroll.current = (c) => {
          const after = contentOrigin(c, content);
          return { x: after.x + fx * after.w - vx, y: after.y + fy * after.h - vy };
        };
      } else {
        // No content element to measure: fall back to proportional scaling.
        const k = target / zoomRef.current;
        const cx = (el.scrollLeft + vx) * k - vx;
        const cy = (el.scrollTop + vy) * k - vy;
        pendingScroll.current = () => ({ x: cx, y: cy });
      }
      setZoom(target);
      setTick((t) => t + 1);
    },
    [containerRef, contentRef],
  );

  /**
   * Guided view (§15.4): jump to `next` zoom and centre a point that can only
   * be measured *after* the new layout is committed (the page element is laid
   * out at base × zoom, so its box changes with the zoom). `locate` runs in
   * the layout effect and returns the point in the container's scroll space.
   */
  const focusOn = useCallback(
    (next: number, locate: (el: HTMLElement) => { x: number; y: number } | null) => {
      pendingScroll.current = (c) => {
        const point = locate(c);
        if (!point) return null;
        return { x: point.x - c.clientWidth / 2, y: point.y - c.clientHeight / 2 };
      };
      setZoom(clamp(next, MIN_ZOOM, MAX_ZOOM));
      // The zoom may be unchanged between two same-size panels; bump a tick so
      // the layout effect still runs and re-centres.
      setTick((t) => t + 1);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    const plan = pendingScroll.current;
    pendingScroll.current = null;
    if (!el || !plan) return;
    const point = plan(el);
    if (!point) return;
    // The browser clamps to the scrollable range for us; Math.max keeps the
    // intent readable when the content is smaller than the frame.
    el.scrollLeft = Math.max(0, point.x);
    el.scrollTop = Math.max(0, point.y);
  }, [zoom, tick, containerRef]);

  const reset = useCallback(() => {
    pendingScroll.current = () => ({ x: 0, y: 0 });
    setZoom(1);
    setTick((t) => t + 1);
  }, []);

  /** Double-tap toggles between fit and a close-up on the tapped point. */
  const toggleAt = useCallback(
    (clientX: number, clientY: number) => {
      if (zoomRef.current > 1.01) reset();
      else zoomTo(TAP_ZOOM, clientX, clientY);
    },
    [reset, zoomTo],
  );

  // ctrl/⌘ wheel and trackpad pinch zoom; a plain wheel keeps scrolling.
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomToRef.current(zoomRef.current * Math.exp(-dy * 0.0025), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef]);

  // drag to pan; on touch also two-finger pinch. Touch pointers are tracked in
  // a map so a second finger landing converts the gesture from a pan into a
  // pinch (and the trailing pointer-ups never become a tap page-turn).
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const pinchEndAt = useRef(0);
  /** When the last *moved* pan ended — the click it leaves must not turn a page. */
  const dragEndAt = useRef(0);

  const endPinch = useCallback(() => {
    if (!pinch.current) return;
    pinch.current = null;
    drag.current = null;
    pinchEndAt.current = Date.now();
  }, []);

  const endDrag = useCallback(() => {
    if (drag.current?.moved) dragEndAt.current = Date.now();
    drag.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current;
      if (e.pointerType === "touch") {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          // Second finger down: stop panning, start the pinch baseline.
          drag.current = null;
          const [a, b] = [...pointers.current.values()];
          pinch.current = {
            dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            midX: (a.x + b.x) / 2,
            midY: (a.y + b.y) / 2,
          };
          return;
        }
        // One finger pans when the content is actually scrollable (zoomed in,
        // or a fit mode that overflows the frame).
        if (
          el &&
          (zoomRef.current > 1.01 ||
            el.scrollHeight > el.clientHeight + 1 ||
            el.scrollWidth > el.clientWidth + 1)
        ) {
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        }
        return;
      }
      if (zoomRef.current <= 1.01) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    },
    [containerRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (e.pointerType === "touch" && pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const p = pinch.current;
      if (p && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const k = dist / p.dist;
        // Follow the moving midpoint first, then scale around it — the anchor
        // is measured after layout, so the two compose.
        el.scrollLeft -= midX - p.midX;
        el.scrollTop -= midY - p.midY;
        zoomToRef.current(zoomRef.current * k, midX, midY);
        pinch.current = { dist, midX, midY };
        return;
      }
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      el.scrollLeft -= dx;
      el.scrollTop -= dy;
    },
    [containerRef],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) endPinch();
      if (drag.current?.id === e.pointerId) endDrag();
    },
    [endDrag, endPinch],
  );

  /**
   * True while a pan gesture is in progress, and for a beat after the pointer
   * lifts — the click a drag leaves behind must never turn the page.
   */
  const dragged = useCallback(
    () => !!drag.current?.moved || Date.now() - dragEndAt.current < DRAG_TAP_GUARD,
    [],
  );
  /**
   * True during a pinch and for a beat after the fingers lift, so the click
   * events the gesture leaves behind never turn a page.
   */
  const pinching = useCallback(() => !!pinch.current || Date.now() - pinchEndAt.current < 300, []);

  return {
    zoom,
    zoomed: zoom > 1.01,
    zoomTo,
    focusOn,
    reset,
    toggleAt,
    panHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerLeave: onPointerUp,
    },
    dragged,
    pinching,
  };
}
