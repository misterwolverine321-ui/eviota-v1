// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevealBand } from "@/components/reader/reveal-band";
import { useImmersiveChrome } from "@/hooks/use-immersive-chrome";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: { root: Root; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, host } of roots) {
    act(() => root.unmount());
    host.remove();
  }
  roots = [];
  vi.useRealTimers();
});

function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  roots.push({ root, host });
  return host;
}

/** Drive the real hook from a tiny harness and expose its latest value. */
function harness(pinned = false) {
  const api: { current: ReturnType<typeof useImmersiveChrome> | null } = { current: null };
  function Probe() {
    api.current = useImmersiveChrome(pinned);
    return null;
  }
  mount(createElement(Probe));
  return api as { current: ReturnType<typeof useImmersiveChrome> };
}

describe("the bars' quiet timer", () => {
  beforeEach(() => vi.useFakeTimers());

  it("retreats after the first, longer grace period when nothing is touched", () => {
    const c = harness();
    expect(c.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(5900));
    expect(c.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(200));
    expect(c.current.visible).toBe(false);
  });

  it("touching a bar (show) restarts the timer, so the bars do not vanish mid-reach", () => {
    const c = harness();
    act(() => void vi.advanceTimersByTime(5800)); // nearly gone
    act(() => c.current.show()); // a finger lands on a button
    act(() => void vi.advanceTimersByTime(4400)); // would have been gone long ago
    expect(c.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(200)); // 4.5 s after the touch
    expect(c.current.visible).toBe(false);
  });

  it("show brings hidden bars back, and they then retreat again", () => {
    const c = harness();
    act(() => void vi.advanceTimersByTime(7000));
    expect(c.current.visible).toBe(false);
    act(() => c.current.show());
    expect(c.current.visible).toBe(true);
    act(() => void vi.advanceTimersByTime(4600));
    expect(c.current.visible).toBe(false);
  });

  it("an open drawer pins the bars: they stay however long it takes", () => {
    const c = harness(true);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(c.current.visible).toBe(true);
  });
});

describe("RevealBand", () => {
  it("renders nothing while the bars are showing", () => {
    const host = mount(
      createElement(RevealBand, { active: false, onReveal: () => {}, color: "#000" }),
    );
    expect(host.querySelector("button")).toBeNull();
  });

  it("is a labelled button that reveals on click, once", () => {
    const onReveal = vi.fn();
    const host = mount(createElement(RevealBand, { active: true, onReveal, color: "#000" }));
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(button.getAttribute("aria-label")).toBe("Show reading menu");
    expect(button.getAttribute("type")).toBe("button");
    // A press alone must not reveal: the bars would slide in under the finger.
    act(() => void button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(onReveal).not.toHaveBeenCalled();
    act(() => button.click());
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("covers the top edge only, so page-turn taps below it are unaffected", () => {
    const host = mount(
      createElement(RevealBand, { active: true, onReveal: () => {}, color: "#000" }),
    );
    const cls = host.querySelector("button")!.className;
    expect(cls).toContain("top-0");
    expect(cls).toContain("h-12");
    expect(cls).not.toContain("bottom-");
    expect(cls).not.toContain("inset-y");
  });
});
