// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PagesTab, type PageOpsApi } from "@/components/reader/drawer/pages-tab";
import type { ReaderTheme } from "@/lib/reader-settings";

/**
 * Found by the Playwright spec "rotate rewrites the page and keeps the rail
 * intact": page 1's thumbnail stayed a grey placeholder while
 * pages 2-4 rendered. reader-shell passes a *new* `renderThumbnail` function on
 * every render, so the rail's render effect re-ran while page 1 was still being
 * drawn. The old run was cancelled, its result thrown away, and page 1 was
 * already marked "queued", so nothing ever drew it again.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { line: "#ccc" } as unknown as ReaderTheme;

type Entry = { target: Element; isIntersecting: boolean };
let observers: { cb: (e: Entry[]) => void; seen: Element[] }[] = [];

beforeEach(() => {
  observers = [];
  class FakeObserver {
    constructor(public cb: (e: Entry[]) => void) {
      observers.push({ cb, seen: [] });
    }
    observe(el: Element) {
      observers[observers.length - 1]!.seen.push(el);
    }
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("PagesTab thumbnail rail", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const show = (
    renderThumbnail: (p: number, w: number) => Promise<string | null>,
    pageOps?: PageOpsApi,
  ) =>
    act(() => {
      root.render(
        createElement(PagesTab, {
          pageCount: 3,
          currentPage: 1,
          onGoToPage: () => {},
          theme,
          renderThumbnail,
          pageOps,
        }),
      );
    });

  const intersect = async (...pages: number[]) => {
    const obs = observers[observers.length - 1]!;
    await act(async () => {
      obs.cb(
        pages.map((p) => ({
          target: host.querySelector(`[data-thumb="${p}"]`)!,
          isIntersecting: true,
        })),
      );
    });
  };

  const imgs = () => [...host.querySelectorAll("img")].map((i) => i.getAttribute("alt"));

  it("draws every page even when the parent re-renders with a new function mid-render", async () => {
    const first = deferred<string | null>();
    const calls: number[] = [];
    const make = () => (page: number) => {
      calls.push(page);
      return page === 1 ? first.promise : Promise.resolve(`data:image/jpeg;base64,p${page}`);
    };

    show(make());
    await intersect(1);
    expect(calls).toEqual([1]); // page 1 is now being drawn

    show(make()); // a progress tick re-renders the reader: same props, new function identity
    await intersect(2, 3);

    first.resolve("data:image/jpeg;base64,p1");
    await act(async () => {
      await first.promise;
    });

    expect(imgs()).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("does not draw a page twice just because the parent re-rendered", async () => {
    const calls: number[] = [];
    const make = () => (page: number) => {
      calls.push(page);
      return Promise.resolve(`data:image/jpeg;base64,p${page}`);
    };
    show(make());
    await intersect(1, 2, 3);
    show(make());
    show(make());
    await act(async () => {});
    expect(calls.sort()).toEqual([1, 2, 3]);
    expect(imgs()).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("retries a page whose render returned null (no document yet)", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      show(async (page) => (page === 1 && n++ === 0 ? null : `data:image/jpeg;base64,p${page}`));
      await intersect(1);
      expect(imgs()).toEqual([]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(imgs()).toEqual(["Page 1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws away a thumbnail drawn from the file as it was before a page op", async () => {
    const old = deferred<string | null>();
    let call = 0;
    const render = (page: number) =>
      page === 1 && call++ === 0 ? old.promise : Promise.resolve("data:image/jpeg;base64,NEW");
    const ops = (busy: boolean) => ({ busy }) as unknown as PageOpsApi;

    show(render, ops(false));
    await intersect(1);
    show(render, ops(true)); // rotate started: the file is being rewritten
    old.resolve("data:image/jpeg;base64,OLD");
    await act(async () => {
      await old.promise;
    });

    const src = host.querySelector("img")?.getAttribute("src");
    expect(src).toBe("data:image/jpeg;base64,NEW");
  });
});
