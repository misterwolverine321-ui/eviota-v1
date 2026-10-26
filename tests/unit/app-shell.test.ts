// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";

/**
 * Mounts the real router with the real route tree in jsdom. This is not a
 * browser: layout, CSS, the service worker and real touch input are untested.
 * What it does prove is that the shell starts, the hash routes resolve, the
 * head tags are managed in single-page mode, and nothing throws on load.
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

async function mount(hash: string) {
  window.location.hash = hash;
  const router = createAppRouter();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  return { router, host };
}
const text = (host: HTMLElement) => host.textContent ?? "";

describe("app shell (hash routing, no server)", () => {
  it("starts on the library and shows the first-run hero on an empty shelf", async () => {
    const { host } = await mount("#/");
    await vi.waitFor(() => expect(text(host)).toContain("Every book you own"), { timeout: 8000 });
    expect(text(host)).toContain("in one quiet shelf.");
  });

  it("shows the Eviota logo in the header as outlines, with a name a screen reader can use", async () => {
    const { host } = await mount("#/");
    await vi.waitFor(() => expect(host.querySelector("header")).not.toBeNull(), { timeout: 8000 });
    const logo = host.querySelector('header svg[role="img"][aria-label="Eviota"]');
    expect(logo).not.toBeNull();
    expect(logo!.querySelectorAll("path")).toHaveLength(3);
    expect(logo!.querySelector("text")).toBeNull(); // no live text: it must not depend on a font
    // The "Reader" label stays beside it (hidden on phones by CSS, still in the DOM).
    expect(text(host.querySelector("header")!)).toContain("Reader");
  });

  it("manages the document title through the router's head handling", async () => {
    await mount("#/");
    await vi.waitFor(() => expect(document.title).toContain("Eviota"), { timeout: 8000 });
  });

  it("resolves #/settings to the settings page", async () => {
    const { host } = await mount("#/settings");
    await vi.waitFor(() => expect(text(host)).toContain("Backup & restore"), { timeout: 8000 });
  });

  it("navigates between routes by changing the hash", async () => {
    const { router, host } = await mount("#/");
    await vi.waitFor(() => expect(text(host)).toContain("Every book you own"), { timeout: 8000 });
    await act(async () => {
      await router.navigate({ to: "/settings" });
    });
    expect(window.location.hash).toBe("#/settings");
    await vi.waitFor(() => expect(text(host)).toContain("Backup & restore"), { timeout: 8000 });
  });

  it("shows a not-found page for an unknown route, linking home with a hash URL", async () => {
    const { host } = await mount("#/definitely/not/a/route");
    await vi.waitFor(() => expect(text(host).toLowerCase()).toContain("not found"), {
      timeout: 8000,
    });
    const home = [...host.querySelectorAll("a")].find((a) =>
      /home|back|library/i.test(a.textContent ?? ""),
    );
    expect(home?.getAttribute("href")).toMatch(/^(#|\/#)\/?$/);
  });
});
