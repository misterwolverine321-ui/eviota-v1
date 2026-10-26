// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalLinkGuard, SafeReadingButton } from "@/components/reader/safe-reading";
import {
  emptyReport,
  removedRows,
  showSafeReadingButton,
  type BlockedReport,
} from "@/lib/safe-document";
import {
  getPendingLink,
  getSafeReport,
  guardAuxClick,
  recordSafeReport,
  requestExternalLink,
  resetSafeReport,
  resolveExternalLink,
} from "@/lib/safe-report";

/**
 * jsdom, not a browser: this proves the panel's content and the guard's
 * decisions, not layout, focus rings or touch behaviour.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = (patch: Partial<BlockedReport>): BlockedReport => ({ ...emptyReport(), ...patch });

let mounted: { root: Root; host: HTMLElement }[] = [];

function mount(component: Parameters<typeof createElement>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(component)));
  mounted.push({ root, host });
  return host;
}

beforeAll(() => {
  class Observer {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Observer;
});

beforeEach(() => {
  resetSafeReport();
  resolveExternalLink(false);
});

afterEach(() => {
  for (const { root, host } of mounted) {
    act(() => root.unmount());
    host.remove();
  }
  mounted = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const button = () =>
  document.querySelector<HTMLButtonElement>("button[aria-label^='Safe reading']")!;
const byText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(text),
  );

describe("the report store", () => {
  it("replaces a section's earlier record instead of adding to it", () => {
    recordSafeReport("ch1.xhtml", report({ scripts: 2 }));
    recordSafeReport("ch1.xhtml", report({ scripts: 2 })); // section reloaded after paging back
    recordSafeReport("ch2.xhtml", report({ scripts: 1 }));
    expect(getSafeReport().scripts).toBe(3);
  });

  it("merges remote references by URL across sections and clears on reset", () => {
    recordSafeReport("a", report({ remote: [{ kind: "image", url: "https://t/p.gif" }] }));
    recordSafeReport("b", report({ remote: [{ kind: "image", url: "https://t/p.gif" }] }));
    expect(getSafeReport().remote).toHaveLength(1);
    resetSafeReport();
    expect(getSafeReport().remote).toHaveLength(0);
  });

  it("removedRows lists only what was actually removed", () => {
    expect(removedRows(emptyReport())).toEqual([]);
    expect(removedRows(report({ scripts: 3, other: 1 })).map((r) => r.count)).toEqual([3, 1]);
  });
});

describe("SafeReadingButton", () => {
  it("shows no badge and says so when nothing was blocked", () => {
    mount(SafeReadingButton);
    expect(button().getAttribute("aria-label")).toBe("Safe reading");
    expect(button().textContent).toBe("");
  });

  it("shows a count that follows the store as sections load", () => {
    mount(SafeReadingButton);
    act(() => recordSafeReport("ch1", report({ scripts: 2, handlers: 1 })));
    expect(button().getAttribute("aria-label")).toBe("Safe reading: 3 blocked in this book");
    expect(button().textContent).toBe("3");
    act(() =>
      recordSafeReport("ch2", report({ remote: [{ kind: "image", url: "https://t/p.gif" }] })),
    );
    expect(button().textContent).toBe("4");
  });

  it("opens a panel that names what was removed, the addresses, and the links", () => {
    mount(SafeReadingButton);
    act(() =>
      recordSafeReport(
        "ch1",
        report({
          scripts: 2,
          remote: [{ kind: "image", url: "https://tracker.example/pixel.gif" }],
          links: ["https://example.org/read-more"],
        }),
      ),
    );
    act(() => button().click());
    const text = document.body.textContent ?? "";
    expect(text).toContain("Removed from this book");
    expect(text).toContain("Scripts");
    expect(text).toContain("https://tracker.example/pixel.gif");
    expect(text).toContain("Nothing was requested");
    expect(text).toContain("https://example.org/read-more");
  });

  it("says plainly when nothing needed removing", () => {
    mount(SafeReadingButton);
    act(() => button().click());
    expect(document.body.textContent).toContain("Nothing so far");
  });

  it("caps a long address list and says how many were left out", () => {
    mount(SafeReadingButton);
    const many = Array.from({ length: 20 }, (_, i) => ({
      kind: "image" as const,
      url: `https://t.example/${i}.gif`,
    }));
    act(() => recordSafeReport("ch1", report({ remote: many })));
    act(() => button().click());
    expect(document.body.textContent).toContain("Remote content not loaded (20)");
    expect(document.body.textContent).toContain("and 8 more");
    expect(document.body.textContent).not.toContain("https://t.example/19.gif");
  });
});

describe("external links wait for the reader", () => {
  it("says who is asking: a link the app itself offers is not 'this book'", () => {
    mount(ExternalLinkGuard);
    act(() => void requestExternalLink("https://example.org/page"));
    expect(document.body.textContent).toContain("This book wants to open a page on example.org");
    act(() => byText("Stay here")!.click());

    act(() => void requestExternalLink("https://en.wikipedia.org/wiki/X", "app"));
    expect(getPendingLink()?.by).toBe("app");
    expect(document.body.textContent).toContain("Eviota wants to open a page on en.wikipedia.org");
    expect(document.body.textContent).not.toContain("This book wants");
    act(() => byText("Stay here")!.click());
  });

  it("opens nothing until confirmed, and 'Stay here' drops the request", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mount(ExternalLinkGuard);
    expect(document.body.textContent).not.toContain("Open this link?");

    act(() => void requestExternalLink("https://example.org/page?x=1"));
    expect(document.body.textContent).toContain("Open this link?");
    expect(document.body.textContent).toContain("example.org");
    expect(open).not.toHaveBeenCalled();

    act(() => byText("Stay here")!.click());
    expect(open).not.toHaveBeenCalled();
    expect(getPendingLink()).toBeNull();
    expect(document.body.textContent).not.toContain("Open this link?");
  });

  it("'Open link' opens exactly that URL, detached from this window", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mount(ExternalLinkGuard);
    act(() => void requestExternalLink("https://example.org/page?x=1"));
    act(() => byText("Open link")!.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      "https://example.org/page?x=1",
      "_blank",
      "noopener,noreferrer",
    );
    expect(getPendingLink()).toBeNull();
  });

  it("refuses links that must never leave, without showing a dialog", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mount(ExternalLinkGuard);
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "",
    ]) {
      let accepted = true;
      act(() => {
        accepted = requestExternalLink(href);
      });
      expect(accepted, href).toBe(false);
    }
    expect(document.body.textContent).not.toContain("Open this link?");
    expect(open).not.toHaveBeenCalled();
  });

  it("describes a mailto link as another app, not a website", () => {
    mount(ExternalLinkGuard);
    act(() => void requestExternalLink("mailto:someone@example.org"));
    expect(document.body.textContent).toContain("in another app");
    expect(document.body.textContent).not.toContain("see your visit");
  });
});

describe("when the shield appears in the reader's top bar", () => {
  it("only for a markup book where something was actually removed", () => {
    const clean = emptyReport();
    const dirty = { ...emptyReport(), scripts: 1 };
    expect(showSafeReadingButton("foliate", clean)).toBe(false); // a clean book: nothing to say
    expect(showSafeReadingButton("foliate", dirty)).toBe(true);
    expect(showSafeReadingButton("html", dirty)).toBe(true);
    expect(
      showSafeReadingButton("foliate", {
        ...emptyReport(),
        remote: [{ kind: "image", url: "https://t/p.gif" }],
      }),
    ).toBe(true);
  });

  it("never for engines with no markup to clean, or when the engine is not known yet", () => {
    const dirty = { ...emptyReport(), scripts: 3 };
    for (const kind of ["pdf", "comic", "text", "djvu", "chm", "unknown", ""]) {
      expect(showSafeReadingButton(kind, dirty), kind).toBe(false);
    }
    expect(showSafeReadingButton(undefined, dirty)).toBe(false);
  });

  it("links alone do not raise it (they have their own confirmation)", () => {
    expect(
      showSafeReadingButton("foliate", { ...emptyReport(), links: ["https://example.org"] }),
    ).toBe(false);
  });
});

describe("a middle click on a link in a book", () => {
  /**
   * A middle click raises `auxclick`, never `click`, and the browser's default
   * for it on a link is to open the address in a new tab. A guard that listens
   * for `click` alone is bypassed (found in desktop Chromium, checkpoint 10).
   */
  const link = (href: string) => {
    document.body.innerHTML = `<p><a href="${href}"><b id="inner">text</b></a></p><p id="plain">no link</p>`;
    document.addEventListener("auxclick", guardAuxClick);
    return document.getElementById("inner")!;
  };
  const press = (target: Element, button: number) => {
    const event = new MouseEvent("auxclick", { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  afterEach(() => document.removeEventListener("auxclick", guardAuxClick));

  it("is cancelled and asks first, even when the click lands on markup inside the link", () => {
    const event = press(link("https://example.org/a"), 1);
    expect(event.defaultPrevented).toBe(true);
    expect(getPendingLink()).toEqual({
      url: "https://example.org/a",
      host: "example.org",
      by: "book",
    });
  });

  it("is cancelled for a link that may not leave, and nothing is asked", () => {
    for (const href of ["javascript:alert(1)", "#section", "chapter2.xhtml", "ftp://h/x"]) {
      resolveExternalLink(false);
      const event = press(link(href), 1);
      expect(event.defaultPrevented, href).toBe(true);
      expect(getPendingLink(), href).toBeNull();
    }
  });

  it("leaves the other buttons alone (the right button belongs to the context menu)", () => {
    for (const button of [0, 2, 3, 4]) {
      const event = press(link("https://example.org/a"), button);
      expect(event.defaultPrevented, `button ${button}`).toBe(false);
      expect(getPendingLink(), `button ${button}`).toBeNull();
    }
  });

  it("ignores a middle click that is not on a link", () => {
    link("https://example.org/a");
    const event = press(document.getElementById("plain")!, 1);
    expect(event.defaultPrevented).toBe(false);
    expect(getPendingLink()).toBeNull();
  });
});
