// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBottomSheet } from "@/hooks/use-mobile";

/**
 * Whether the reader's drawer is a bottom sheet or a side rail (checkpoint 21). A phone held upright
 * gets the sheet; a screen that is narrow but short (a phone on its side) would have a sheet of 72%
 * of a 320 px height, which leaves no room for a first result, so it gets the rail like a wide one.
 * jsdom has no media queries: the two queries the hook reads are answered by a stub.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = () => void;

function stubMedia(state: { narrow: boolean; shortLandscape: boolean }) {
  const listeners = new Set<Listener>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("max-width") ? state.narrow : state.shortLandscape;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }));
  window.matchMedia = (
    globalThis as unknown as { matchMedia: typeof window.matchMedia }
  ).matchMedia;
  return { change: () => listeners.forEach((l) => l()) };
}

describe("useBottomSheet", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: boolean[];

  function Probe() {
    seen.push(useBottomSheet());
    return null;
  }

  beforeEach(() => {
    seen = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    // @ts-expect-error jsdom has no matchMedia; remove the stub again
    delete window.matchMedia;
  });

  const mount = () => act(() => root.render(createElement(Probe)));

  it("is a sheet on a narrow screen held upright", () => {
    stubMedia({ narrow: true, shortLandscape: false });
    mount();
    expect(seen.at(-1)).toBe(true);
    // The first render already has the answer: no frame of the wrong layout.
    expect(seen[0]).toBe(true);
  });

  it("is a rail on a narrow screen that is also short and wide (a phone on its side)", () => {
    stubMedia({ narrow: true, shortLandscape: true });
    mount();
    expect(seen.at(-1)).toBe(false);
    expect(seen[0]).toBe(false);
  });

  it("is a rail on a wide screen", () => {
    stubMedia({ narrow: false, shortLandscape: false });
    mount();
    expect(seen.at(-1)).toBe(false);
  });

  it("follows the screen when it is turned", () => {
    const state = { narrow: true, shortLandscape: false };
    const media = stubMedia(state);
    mount();
    expect(seen.at(-1)).toBe(true);
    state.shortLandscape = true;
    act(() => media.change());
    expect(seen.at(-1)).toBe(false);
    state.shortLandscape = false;
    act(() => media.change());
    expect(seen.at(-1)).toBe(true);
  });

  it("is a rail, and does not throw, where there is no matchMedia", () => {
    mount();
    expect(seen.at(-1)).toBe(false);
  });
});
