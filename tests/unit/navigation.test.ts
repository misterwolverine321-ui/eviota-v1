// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";

/**
 * The real router and route tree in jsdom, on hash history like the shipped
 * app. jsdom is not a browser (no swipe gesture), but history.length and the
 * location are the quantities a back-swipe walks through.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: { root: Root; host: HTMLElement }[] = [];

beforeAll(() => {
  const noop = () => undefined;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class Observer {
    observe = noop;
    unobserve = noop;
    disconnect = noop;
    takeRecords = () => [];
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Observer;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= Observer;
  window.scrollTo = noop as typeof window.scrollTo;
});

afterEach(async () => {
  for (const { root, host } of roots) {
    await act(async () => root.unmount());
    host.remove();
  }
  roots = [];
});

/** Start the app at `hash` as a cold load: no earlier app state in the stack. */
async function coldStart(hash: string) {
  window.history.replaceState(null, "", hash);
  const router = createAppRouter();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  return host;
}

// The router renders hash links as "/#/..." in the href attribute.
const link = (host: HTMLElement, href: string, text?: string) => {
  const found = Array.from(host.querySelectorAll<HTMLAnchorElement>("a")).find(
    (a) => a.getAttribute("href") === href && (!text || a.textContent?.includes(text)),
  );
  expect(found, `link ${href} ${text ?? ""}`).toBeTruthy();
  return found!;
};
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};
const at = (hash: string) =>
  vi.waitFor(() => expect(window.location.hash).toBe(hash), { timeout: 4000 });

describe("going back never builds a trail of repeated screens", () => {
  it("opening Settings and tapping its back arrow, again and again, adds no history entries", async () => {
    const host = await coldStart("#/");
    await vi.waitFor(() => expect(link(host, "/#/settings")).toBeTruthy(), { timeout: 8000 });

    const lengths: number[] = [];
    for (let i = 0; i < 4; i++) {
      await click(link(host, "/#/settings"));
      await at("#/settings");
      await vi.waitFor(() => expect(link(host, "/#/", "Shelf")).toBeTruthy());
      await click(link(host, "/#/", "Shelf"));
      await at("#/");
      await vi.waitFor(() => expect(link(host, "/#/settings")).toBeTruthy());
      lengths.push(window.history.length);
    }
    // One entry for the first visit to Settings and none after that.
    expect(new Set(lengths).size, `history length per cycle: ${lengths}`).toBe(1);
  });

  it("the library logo does not add an entry when you are already on the library", async () => {
    const host = await coldStart("#/");
    await vi.waitFor(() => expect(link(host, "/#/settings")).toBeTruthy(), { timeout: 8000 });
    const before = window.history.length;
    const logo = Array.from(host.querySelectorAll<HTMLAnchorElement>("header a")).find(
      (a) => a.getAttribute("href") === "/#/" && a.querySelector('svg[aria-label="Eviota"]'),
    )!;
    expect(logo).toBeTruthy();
    await click(logo);
    await click(logo);
    expect(window.history.length).toBe(before);
    expect(window.location.hash).toBe("#/");
  });

  it("a cold start on Settings: the back arrow replaces it with the library instead of stacking one", async () => {
    const host = await coldStart("#/settings");
    await vi.waitFor(() => expect(link(host, "/#/", "Shelf")).toBeTruthy(), { timeout: 8000 });
    // The router's own position marker: 0 means nothing of ours lies behind this screen.
    const position = () => (window.history.state as { __TSR_index?: number } | null)?.__TSR_index;
    expect(position()).toBe(0);
    await click(link(host, "/#/", "Shelf"));
    await at("#/");
    // A push would make the library entry 1, with Settings still behind it, so a back-swipe
    // would land on Settings again. Replacing keeps the library at the bottom of the stack.
    expect(position()).toBe(0);
  });
});
