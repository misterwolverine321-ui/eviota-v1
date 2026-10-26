// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchTab } from "@/components/reader/drawer/search-tab";
import type { ReaderTheme, SearchHit, SearchRun } from "@/lib/reader-settings";

/**
 * Found while checking that a click on a search result leaves its mark on the page (checkpoint 21).
 * reader-shell hands the search tab fresh `onSearch` / `onClearSearch` arrow functions on every
 * render, and it renders whenever the reading position moves or the search index finishes building.
 * The tab's debounced search depended on those functions, so each render ran the search again:
 * the hit list was emptied and refilled, the active result lost its `aria-current`, and
 * `onClearSearch` removed the mark the jump had just left. These tests keep the search from running
 * again for any reason but a changed query or match option.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { line: "#ccc", sub: "#666" } as unknown as ReaderTheme;

const hit: SearchHit = {
  id: "p1-0",
  excerpt: { pre: "a ", match: "harbor", post: " b" },
  label: "One",
  target: { kind: "page", page: 1, offset: 2 },
};

describe("SearchTab", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  /** Props as reader-shell passes them: new function objects each time it renders. */
  function render(
    onSearch: (query: string, run: SearchRun) => Promise<void>,
    onClearSearch: () => void,
    options: {
      matchCase?: boolean;
      onJumpHit?: (hit: SearchHit) => void;
      takeDeepHit?: () => { page: number; at: number } | null;
    } = {},
  ) {
    act(() => {
      root.render(
        createElement(SearchTab, {
          theme,
          onSearch: (query, run) => onSearch(query, run),
          onClearSearch: () => onClearSearch(),
          onJumpHit: (h) => options.onJumpHit?.(h),
          takeDeepHit: options.takeDeepHit,
          matchCase: options.matchCase ?? false,
          wholeWord: false,
          onMatchOptions: () => {},
          initialQuery: "harbor",
        }),
      );
    });
  }

  const settle = async (ms = 400) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  const answer = (spy: ReturnType<typeof vi.fn>) =>
    spy.mockImplementation(async (_q: string, run: SearchRun) => {
      run.onProgress(1);
      run.onHits([hit]);
    });

  it("does not search again when the shell renders with new callback functions", async () => {
    const onSearch = vi.fn();
    const onClear = vi.fn();
    answer(onSearch);
    render(onSearch, onClear);
    await settle();
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("harbor");

    // The reading position moved (or the index finished): the shell renders again.
    for (let i = 0; i < 3; i++) {
      render(onSearch, onClear);
      await settle(1000);
    }
    expect(onSearch).toHaveBeenCalledTimes(1);
    // The mark a jump left on the page is not cleared by a search nobody asked for.
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("harbor");
  });

  it("searches again when a match option changes, with the latest callbacks", async () => {
    const first = vi.fn();
    const firstClear = vi.fn();
    answer(first);
    render(first, firstClear);
    await settle();

    const second = vi.fn();
    const secondClear = vi.fn();
    answer(second);
    render(second, secondClear, { matchCase: true });
    await settle();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![1].options).toEqual({ matchCase: true, wholeWord: false });
    expect(secondClear).toHaveBeenCalledTimes(1);
  });

  describe("a book opened from a shelf hit", () => {
    const hitAt = (page: number, offset: number, id: string): SearchHit => ({
      id,
      excerpt: { pre: "", match: "harbor", post: "" },
      target: { kind: "page", page, offset },
    });
    const manyHits = (spy: ReturnType<typeof vi.fn>) =>
      spy.mockImplementation(async (_q: string, run: SearchRun) => {
        run.onProgress(1);
        run.onHits([hitAt(1, 10, "a"), hitAt(2, 300, "b"), hitAt(2, 900, "c")]);
      });

    it("selects the result at the place the shelf listed and takes the reader to it, once", async () => {
      const onSearch = vi.fn();
      manyHits(onSearch);
      const onJump = vi.fn();
      let wanted: { page: number; at: number } | null = { page: 2, at: 900 };
      const take = vi.fn(() => {
        const w = wanted;
        wanted = null;
        return w;
      });
      render(onSearch, vi.fn(), { onJumpHit: onJump, takeDeepHit: take });
      await settle();
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump.mock.calls[0]![0].id).toBe("c");
      expect(host.textContent).toContain("3/3");
      // The shell renders again: nothing is selected a second time.
      render(onSearch, vi.fn(), { onJumpHit: onJump, takeDeepHit: take });
      await settle(1000);
      expect(onJump).toHaveBeenCalledTimes(1);
    });

    it("leaves the list alone when no result is at that place", async () => {
      const onSearch = vi.fn();
      manyHits(onSearch);
      const onJump = vi.fn();
      render(onSearch, vi.fn(), {
        onJumpHit: onJump,
        takeDeepHit: () => ({ page: 2, at: 901 }),
      });
      await settle();
      expect(onJump).not.toHaveBeenCalled();
      expect(host.textContent).toContain("0/3");
    });

    it("does nothing for a book that was not opened from a hit", async () => {
      const onSearch = vi.fn();
      manyHits(onSearch);
      const onJump = vi.fn();
      render(onSearch, vi.fn(), { onJumpHit: onJump, takeDeepHit: () => null });
      await settle();
      expect(onJump).not.toHaveBeenCalled();
    });
  });
});
