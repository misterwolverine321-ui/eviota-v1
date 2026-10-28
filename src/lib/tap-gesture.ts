/**
 * What counts as a tap on the reading surface, and what it does.
 *
 * A tap is decided when the finger or mouse button is released, never when it is pressed.
 * A press that becomes a scroll or a drag, a second finger, a text selection, or a second
 * click of a double click is not a tap. Every reading engine uses these rules, so the same
 * gesture does the same thing in every format.
 */

/** Most a finger or the mouse may travel between press and release, in CSS pixels. */
export const TAP_MAX_TRAVEL = 10;
/** Longest press that still counts as a tap, in milliseconds. */
export const TAP_MAX_DURATION = 400;
/** A release this close to the left or right edge belongs to the system's edge gestures. */
export const TAP_EDGE_GUARD = 20;
/**
 * How long the bars wait before a tap in the middle toggles them. A second tap inside this
 * window makes a double tap, which toggles nothing.
 */
export const DOUBLE_TAP_WINDOW = 300;

/** The part of a pointer event the rules need. Native and React events both fit. */
export interface PressEvent {
  clientX: number;
  clientY: number;
  timeStamp: number;
  pointerType: string;
  isPrimary: boolean;
  /** Click count for a mouse press: 2 on the second click of a double click. */
  detail: number;
}

/** Where a press began, in the coordinates of the surface it was made on. */
export interface PressStart {
  x: number;
  y: number;
  time: number;
  pointerType: string;
  primary: boolean;
  detail: number;
}

/** Where the press was released. */
export interface PressEnd {
  x: number;
  y: number;
  time: number;
}

export type TapZone = "back" | "middle" | "forward";
export type TapAction = "back" | "forward" | "toggle" | "none";

export function pressStart(e: PressEvent, originX = 0, originY = 0): PressStart {
  return {
    x: e.clientX - originX,
    y: e.clientY - originY,
    time: e.timeStamp,
    pointerType: e.pointerType,
    primary: e.isPrimary,
    detail: e.detail,
  };
}

/**
 * The fraction (0 to 1) of the surface width where a tap landed, or null when the press was
 * not a tap. `width` is the surface's width in the same units as the press coordinates.
 */
export function tapFraction(
  start: PressStart | null,
  end: PressEnd,
  width: number,
  selected: boolean,
): number | null {
  if (!start || !start.primary || selected || !(width > 0)) return null;
  if (start.pointerType === "mouse" && start.detail > 1) return null;
  if (end.time - start.time > TAP_MAX_DURATION) return null;
  if (Math.hypot(end.x - start.x, end.y - start.y) > TAP_MAX_TRAVEL) return null;
  if (end.x < TAP_EDGE_GUARD || end.x > width - TAP_EDGE_GUARD) return null;
  return end.x / width;
}

/** Thirds of the width: the outer thirds turn pages, the middle third is the bars' zone. */
export function tapZone(fraction: number): TapZone {
  if (fraction < 1 / 3) return "back";
  if (fraction > 2 / 3) return "forward";
  return "middle";
}

/**
 * What a tap does. A mouse click in the middle does nothing, so clicking to select words never
 * shows or hides the bars. Touch and pen taps in the middle do toggle them.
 */
export function tapAction(fraction: number, pointerType: string): TapAction {
  const zone = tapZone(fraction);
  if (zone === "back") return "back";
  if (zone === "forward") return "forward";
  return pointerType === "mouse" ? "none" : "toggle";
}

/**
 * Turns a fraction of an iframe's width into a fraction of the surface that holds it, so an
 * engine whose content lives in a frame can report taps in the shell's terms.
 */
export function surfaceFraction(frame: Element | null, innerFraction: number): number | null {
  const rect = frame?.getBoundingClientRect();
  const outer = frame?.ownerDocument?.defaultView?.innerWidth ?? 0;
  if (!rect || rect.width <= 0 || outer <= 0) return null;
  return (rect.left + innerFraction * rect.width) / outer;
}
