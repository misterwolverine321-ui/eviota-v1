import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_WINDOW,
  TAP_EDGE_GUARD,
  TAP_MAX_DURATION,
  TAP_MAX_TRAVEL,
  pressStart,
  surfaceFraction,
  tapAction,
  tapFraction,
  tapZone,
  type PressStart,
} from "@/lib/tap-gesture";

const WIDTH = 390;

function press(over: Partial<PressStart> = {}): PressStart {
  return { x: 200, y: 300, time: 1000, pointerType: "touch", primary: true, detail: 1, ...over };
}

function release(over: Partial<{ x: number; y: number; time: number }> = {}) {
  return { x: 200, y: 300, time: 1100, ...over };
}

describe("tapFraction: what counts as a tap", () => {
  it("reads a short, still touch as a tap at its position", () => {
    expect(tapFraction(press(), release({ x: 195 }), WIDTH, false)).toBeCloseTo(195 / WIDTH);
  });

  it("ignores a press that travelled too far, so a scroll or a drag is not a tap", () => {
    const far = release({ x: 200 + TAP_MAX_TRAVEL + 1 });
    expect(tapFraction(press(), far, WIDTH, false)).toBeNull();
    const near = release({ x: 200 + TAP_MAX_TRAVEL });
    expect(tapFraction(press(), near, WIDTH, false)).not.toBeNull();
  });

  it("ignores a press held too long", () => {
    expect(
      tapFraction(press(), release({ time: 1000 + TAP_MAX_DURATION + 1 }), WIDTH, false),
    ).toBeNull();
    expect(
      tapFraction(press(), release({ time: 1000 + TAP_MAX_DURATION }), WIDTH, false),
    ).not.toBeNull();
  });

  it("ignores the second finger of a pinch and the first finger's release that follows", () => {
    expect(tapFraction(press({ primary: false }), release(), WIDTH, false)).toBeNull();
  });

  it("ignores a release while text is selected", () => {
    expect(tapFraction(press(), release(), WIDTH, true)).toBeNull();
  });

  it("ignores the second click of a mouse double click", () => {
    expect(
      tapFraction(press({ pointerType: "mouse", detail: 2 }), release(), WIDTH, false),
    ).toBeNull();
    expect(
      tapFraction(press({ pointerType: "mouse", detail: 1 }), release(), WIDTH, false),
    ).not.toBeNull();
  });

  it("ignores a release at either edge, which belongs to the system's edge gestures", () => {
    expect(tapFraction(press({ x: 19 }), release({ x: 19 }), WIDTH, false)).toBeNull();
    expect(
      tapFraction(press({ x: 380 }), release({ x: WIDTH - TAP_EDGE_GUARD + 1 }), WIDTH, false),
    ).toBeNull();
    expect(
      tapFraction(press({ x: 30 }), release({ x: TAP_EDGE_GUARD }), WIDTH, false),
    ).not.toBeNull();
  });

  it("has no tap on a surface with no width", () => {
    expect(tapFraction(press(), release(), 0, false)).toBeNull();
    expect(tapFraction(null, release(), WIDTH, false)).toBeNull();
  });
});

describe("tapZone and tapAction: where a tap lands and what it does", () => {
  it("splits the width into thirds", () => {
    expect(tapZone(0.1)).toBe("back");
    expect(tapZone(0.5)).toBe("middle");
    expect(tapZone(0.9)).toBe("forward");
    expect(tapZone(1 / 3 - 0.001)).toBe("back");
    expect(tapZone(2 / 3 + 0.001)).toBe("forward");
  });

  it("turns pages on the outer thirds for any pointer", () => {
    expect(tapAction(0.1, "touch")).toBe("back");
    expect(tapAction(0.9, "mouse")).toBe("forward");
    expect(tapAction(0.9, "pen")).toBe("forward");
  });

  it("toggles the bars on a touch or pen tap in the middle, but never on a mouse click", () => {
    expect(tapAction(0.5, "touch")).toBe("toggle");
    expect(tapAction(0.5, "pen")).toBe("toggle");
    expect(tapAction(0.5, "mouse")).toBe("none");
  });

  it("keeps the double-tap window as long as the bars need to tell a double tap apart", () => {
    expect(DOUBLE_TAP_WINDOW).toBeGreaterThan(0);
    expect(DOUBLE_TAP_WINDOW).toBeLessThanOrEqual(400);
  });
});

describe("pressStart and surfaceFraction: coordinates", () => {
  it("records the press relative to the surface it was made on", () => {
    const start = pressStart(
      { clientX: 120, clientY: 90, timeStamp: 5, pointerType: "touch", isPrimary: true, detail: 0 },
      20,
      10,
    );
    expect(start).toEqual({
      x: 100,
      y: 80,
      time: 5,
      pointerType: "touch",
      primary: true,
      detail: 0,
    });
  });

  it("maps a fraction of an iframe onto the surface that holds it", () => {
    const frame = {
      getBoundingClientRect: () => ({ left: 100, width: 200 }),
      ownerDocument: { defaultView: { innerWidth: 400 } },
    } as unknown as Element;
    // Half-way across the frame is 100 + 100 = 200 px of a 400 px window: half of the surface.
    expect(surfaceFraction(frame, 0.5)).toBeCloseTo(0.5);
    // The frame's own left edge sits at 100 px.
    expect(surfaceFraction(frame, 0)).toBeCloseTo(0.25);
  });

  it("returns null when the frame has no size or no window", () => {
    expect(surfaceFraction(null, 0.5)).toBeNull();
    const empty = {
      getBoundingClientRect: () => ({ left: 0, width: 0 }),
      ownerDocument: { defaultView: { innerWidth: 400 } },
    } as unknown as Element;
    expect(surfaceFraction(empty, 0.5)).toBeNull();
  });
});
