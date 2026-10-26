// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group, IconButton, Segments, Stepper } from "@/components/reader/ui";
import { ReaderDrawer } from "@/components/reader/reader-drawer";
import { TagEditor } from "@/components/library/tag-editor";
import { BookCard } from "@/components/library/book-card";
import { useSettledValue } from "@/hooks/use-settled-value";
import type { BookRecord } from "@/lib/db";
import type { ReaderTheme } from "@/lib/reader-settings";

/**
 * The semantics the accessibility pass added, checked on the real components with react-dom in
 * jsdom: names, roles, states and the order focus moves in. jsdom has no accessibility tree, so
 * these read the attributes a browser builds it from; the Playwright spec `a11y.spec.ts` asks
 * Chromium what it made of them.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// BookCard links through TanStack Router, which needs a router; an anchor is enough here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params: _params,
    children,
    ...rest
  }: {
    to: string;
    params?: unknown;
    children?: React.ReactNode;
  } & Record<string, unknown>) => createElement("a", { href: `#${to}`, ...rest }, children),
}));

const theme: ReaderTheme = {
  id: "paper",
  label: "Paper",
  bg: "#fff",
  ink: "#111",
  sub: "#666",
  line: "#ccc",
};

let mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, host } of mounted) {
    act(() => root.unmount());
    host.remove();
  }
  mounted = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  mounted.push({ root, host });
  return { host, root };
}

const press = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
const click = (el: Element) => act(() => (el as HTMLElement).click());

describe("Group", () => {
  it("is a group named by a level-3 heading that carries the label", () => {
    const { host } = mount(
      createElement(
        "div",
        null,
        createElement(Group, { label: "Typeface" }, createElement("button", null, "serif")),
        createElement(Group, { label: "Alignment" }, createElement("button", null, "serif")),
      ),
    );
    const groups = [...host.querySelectorAll('[role="group"]')];
    expect(groups).toHaveLength(2);
    const names = groups.map((g) => {
      const heading = host.querySelector(`#${CSS.escape(g.getAttribute("aria-labelledby")!)}`);
      expect(heading?.tagName).toBe("H3");
      return heading!.textContent;
    });
    expect(names).toEqual(["Typeface", "Alignment"]);
    // Two groups, two ids: a shared id would name both after the first.
    expect(new Set(groups.map((g) => g.getAttribute("aria-labelledby"))).size).toBe(2);
  });
});

describe("Stepper", () => {
  const render = (onReset?: () => void) => {
    const calls: string[] = [];
    const { host } = mount(
      createElement(Stepper, {
        label: "Text size",
        value: "110%",
        onDec: () => calls.push("dec"),
        onInc: () => calls.push("inc"),
        onReset,
        theme,
      }),
    );
    return { host, calls };
  };

  it("names its buttons after what they change and speaks the value in a status region", () => {
    const { host, calls } = render(() => {});
    const labels = [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Decrease Text size", "110%, reset Text size", "Increase Text size"]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Text size 110%");
    click(host.querySelector('[aria-label="Decrease Text size"]')!);
    click(host.querySelector('[aria-label="Increase Text size"]')!);
    expect(calls).toEqual(["dec", "inc"]);
  });

  it("does not offer a button for a value that cannot be reset", () => {
    const { host } = render(undefined);
    expect(host.querySelectorAll("button")).toHaveLength(2);
    const value = [...host.querySelectorAll("span")].find((s) => s.textContent === "110%");
    expect(value?.getAttribute("aria-hidden")).toBe("true");
  });

  it("changes the status text when the value changes", () => {
    const { host, root } = mount(
      createElement(Stepper, { label: "Zoom", value: "100%", onDec() {}, onInc() {}, theme }),
    );
    act(() =>
      root.render(
        createElement(Stepper, { label: "Zoom", value: "125%", onDec() {}, onInc() {}, theme }),
      ),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Zoom 125%");
  });
});

describe("Segments and IconButton", () => {
  it("segments say which one is on and keep their names when it changes", () => {
    const seen: string[] = [];
    const { host, root } = mount(
      createElement(Segments<string>, {
        options: ["serif", "sans"],
        value: "serif",
        onChange: (v: string) => seen.push(v),
        theme,
      }),
    );
    const state = () =>
      [...host.querySelectorAll("button")].map(
        (b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`,
      );
    expect(state()).toEqual(["serif:true", "sans:false"]);
    click(host.querySelectorAll("button")[1]!);
    expect(seen).toEqual(["sans"]);
    act(() =>
      root.render(
        createElement(Segments<string>, {
          options: ["serif", "sans"],
          value: "sans",
          onChange() {},
          theme,
        }),
      ),
    );
    expect(state()).toEqual(["serif:false", "sans:true"]);
  });

  it("an icon button takes its name from its label and says when it is on", () => {
    const { host } = mount(
      createElement(
        IconButton,
        { label: "Search", onClick() {}, active: true },
        createElement("svg"),
      ),
    );
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Search");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("useSettledValue", () => {
  function Probe({ value }: { value: string }) {
    return createElement("p", null, useSettledValue(value, 1000));
  }

  it("holds the old value through a burst of changes and takes the last one once it is quiet", () => {
    vi.useFakeTimers();
    const { host, root } = mount(createElement(Probe, { value: "0%" }));
    const next = (value: string) => act(() => root.render(createElement(Probe, { value })));
    next("10%");
    act(() => vi.advanceTimersByTime(600));
    next("40%");
    act(() => vi.advanceTimersByTime(600));
    next("90%");
    act(() => vi.advanceTimersByTime(999));
    expect(host.textContent).toBe("0%");
    act(() => vi.advanceTimersByTime(1));
    expect(host.textContent).toBe("90%");
  });
});

describe("the reader drawer", () => {
  const TABS = ["toc", "notes", "search", "display"] as const;

  function drawer(tab: (typeof TABS)[number], extra: Record<string, unknown> = {}) {
    stubMatchMedia();
    const props = {
      tab,
      tabs: [...TABS],
      onTab: vi.fn(),
      onClose: vi.fn(),
      caps: { toc: [{ label: "Chapter One", href: "ch1" }], annotations: false },
      settings: {},
      theme,
      update: vi.fn(),
      currentPage: 1,
      onNavigate: vi.fn(),
      onGoToPage: vi.fn(),
      annotations: [],
      onJumpAnnotation: vi.fn(),
      onUpdateAnnotation: vi.fn(),
      onDeleteAnnotation: vi.fn(),
      onSearch: vi.fn(),
      onClearSearch: vi.fn(),
      onJumpHit: vi.fn(),
      matchCase: false,
      wholeWord: false,
      ...extra,
    };
    const mountedDrawer = mount(createElement(ReaderDrawer, props as never));
    return { ...mountedDrawer, props };
  }

  function stubMatchMedia() {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
  }

  const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];

  it("is a modal dialog named by the heading of the panel it shows", () => {
    const { host } = drawer("toc");
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = host.querySelector(`#${CSS.escape(dialog.getAttribute("aria-labelledby")!)}`)!;
    expect(title.tagName).toBe("H2");
    expect(title.textContent).toBe("Contents");
  });

  it("is a tab list whose tabs are named, say which is selected and control the panel", () => {
    const { host } = drawer("search");
    const list = host.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Reader panels");
    expect(tabs(host).map((t) => t.getAttribute("aria-label"))).toEqual([
      "Contents",
      "Notes",
      "Search",
      "Display",
    ]);
    expect(tabs(host).map((t) => t.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    const panel = host.querySelector('[role="tabpanel"]')!;
    const selected = tabs(host)[2]!;
    expect(panel.getAttribute("aria-labelledby")).toBe(selected.id);
    for (const t of tabs(host)) expect(t.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("puts only the selected tab in the tab order", () => {
    const { host } = drawer("notes");
    expect(tabs(host).map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it("moves focus along the tabs with the arrow keys, Home and End, and selects nothing", () => {
    const { host, props } = drawer("notes");
    const [toc, notes, search, display] = tabs(host) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    act(() => notes.focus());
    press(notes, "ArrowRight");
    expect(document.activeElement).toBe(search);
    press(search, "End");
    expect(document.activeElement).toBe(display);
    press(display, "ArrowRight"); // wraps
    expect(document.activeElement).toBe(toc);
    press(toc, "ArrowLeft"); // wraps back
    expect(document.activeElement).toBe(display);
    press(display, "Home");
    expect(document.activeElement).toBe(toc);
    // Following focus, the roving stop moves with it; the selection has not.
    expect(tabs(host).map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(tabs(host).map((t) => t.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(props.onTab).not.toHaveBeenCalled();
  });

  it("ignores other keys and a click selects", () => {
    const { host, props } = drawer("notes");
    const [, notes, search] = tabs(host) as [HTMLElement, HTMLElement, HTMLElement];
    act(() => notes.focus());
    press(notes, "a");
    expect(document.activeElement).toBe(notes);
    click(search);
    expect(props.onTab).toHaveBeenCalledWith("search");
  });

  it("takes focus on open and gives it back to whatever opened it on close", () => {
    stubMatchMedia();
    // The drawer skips elements with no layout box; jsdom has no layout, so give everything one.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return (this as HTMLElement).parentNode;
      },
    });
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { root } = drawer("toc");
    expect(document.activeElement).toBe(tabs(document.body)[0]);
    act(() => root.unmount());
    mounted = mounted.filter((m) => m.root !== root);
    expect(document.activeElement).toBe(opener);
    opener.remove();
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetParent", original);
  });
});

describe("TagEditor", () => {
  const field = (host: HTMLElement) => host.querySelector("input")!;
  const typeInto = (input: HTMLInputElement, value: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  /** Re-renders with the new tags, as the shelf does once it has saved them. */
  function Harness({ initial, onChange }: { initial: string[]; onChange: (t: string[]) => void }) {
    return createElement(TagEditor, { tags: initial, bookTitle: "Moby Dick", onChange });
  }

  it("names every control after the book, so a shelf of books does not repeat itself", () => {
    const { host } = mount(createElement(Harness, { initial: ["sea"], onChange() {} }));
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      "Tags for Moby Dick",
    );
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove tag sea from Moby Dick",
      "Add tag to Moby Dick",
    ]);
    click(host.querySelector('[aria-label="Add tag to Moby Dick"]')!);
    expect(field(host).getAttribute("aria-label")).toBe("New tag for Moby Dick");
  });

  it("Enter saves the tag, is not left to activate the button it hands focus to, and refocuses it", () => {
    const saved: string[][] = [];
    const { host, root } = mount(
      createElement(Harness, { initial: [], onChange: (t) => saved.push(t) }),
    );
    click(host.querySelector('[aria-label="Add tag to Moby Dick"]')!);
    const input = field(host);
    typeInto(input, "classic");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(enter);
    });
    expect(saved).toEqual([["classic"]]);
    // A keydown that is not cancelled goes on to a keypress, which "presses" the newly focused
    // button and opens the field again.
    expect(enter.defaultPrevented).toBe(true);
    expect(host.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Add tag to Moby Dick"]'));
    act(() => root.render(createElement(Harness, { initial: ["classic"], onChange() {} })));
    expect(host.querySelector("input")).toBeNull();
  });

  it("Escape keeps nothing and refocuses the button", () => {
    const saved: string[][] = [];
    const { host } = mount(createElement(Harness, { initial: [], onChange: (t) => saved.push(t) }));
    click(host.querySelector('[aria-label="Add tag to Moby Dick"]')!);
    typeInto(field(host), "never");
    press(field(host), "Escape");
    expect(saved).toEqual([]);
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Add tag to Moby Dick"]'));
  });

  it("clicking away saves but does not pull focus back from wherever the reader went", () => {
    const saved: string[][] = [];
    const { host } = mount(createElement(Harness, { initial: [], onChange: (t) => saved.push(t) }));
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    click(host.querySelector('[aria-label="Add tag to Moby Dick"]')!);
    typeInto(field(host), "kept");
    act(() => elsewhere.focus());
    expect(saved).toEqual([["kept"]]);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

describe("BookCard", () => {
  const book = {
    id: "b1",
    title: "Moby Dick",
    author: "Herman Melville",
    format: "epub",
    fileName: "moby.epub",
    size: 2048,
    addedAt: 0,
    hasCover: false,
    progress: { fraction: 0.4 },
    tags: [],
  } as unknown as BookRecord;

  const render = (onDelete: (id: string) => void = () => {}) =>
    mount(createElement(BookCard, { book, onDelete, index: 0, onTagsChange() {} }));

  it("meets a screen reader and the Tab key once: the cover link is hidden and out of the tab order", () => {
    const { host } = render();
    const links = [...host.querySelectorAll("a")];
    expect(links).toHaveLength(2);
    const [cover, title] = links as [HTMLAnchorElement, HTMLAnchorElement];
    expect(cover.getAttribute("aria-hidden")).toBe("true");
    expect(cover.tabIndex).toBe(-1);
    expect(title.getAttribute("aria-hidden")).toBeNull();
    expect(title.textContent).toContain("Moby Dick");
  });

  it("says what is read in words as well as digits", () => {
    const { host } = render();
    expect(host.textContent).toContain("40% read");
  });

  it("asks twice before removing, names the book each time, and says it in a status region", () => {
    const removed: string[] = [];
    const { host } = render((id) => removed.push(id));
    const status = () => host.querySelector('[role="status"]')!.textContent;
    expect(status()).toBe("");
    const first = host.querySelector('[aria-label="Remove Moby Dick"]')!;
    click(first);
    expect(removed).toEqual([]);
    expect(status()).toBe("Press the button again to remove Moby Dick. This is not undone.");
    click(host.querySelector('[aria-label="Confirm removal of Moby Dick"]')!);
    expect(removed).toEqual(["b1"]);
  });
});
