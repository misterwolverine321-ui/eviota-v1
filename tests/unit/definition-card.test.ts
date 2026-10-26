// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DefinitionCard } from "@/components/reader/layers/definition-card";
import { LOOKUP_CONSENT_KEY, hasLookupConsent } from "@/lib/lookup-consent";
import type { LookupResult } from "@/lib/lookup";
import { getTheme } from "@/lib/reader-settings";
import { getPendingLink, resolveExternalLink } from "@/lib/safe-report";

/**
 * The card is where a selected word leaves the device for Wikimedia. jsdom, not a browser: this
 * proves WHEN the lookup is allowed to start, not how the card looks.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lookup = vi.hoisted(() => ({ lookupTerm: vi.fn() }));
vi.mock("@/lib/lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lookup")>()),
  lookupTerm: lookup.lookupTerm,
}));

const hit = (over: Partial<LookupResult> = {}): LookupResult => ({
  term: "quixotic",
  source: "wiktionary",
  senses: [{ partOfSpeech: "adjective", definitions: ["Foolishly impractical."] }],
  url: "https://en.wiktionary.org/wiki/quixotic",
  ...over,
});

let mounted: { root: Root; host: HTMLElement }[] = [];
const onDismiss = vi.fn();

async function show(term = "quixotic") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(DefinitionCard, {
        request: { term, rect: { x: 100, y: 200, width: 40, height: 16 } },
        lang: "en",
        theme: getTheme("paper"),
        onDismiss,
      }),
    );
  });
  mounted.push({ root, host });
  return host;
}

const byText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(text),
  );

beforeAll(() => {
  class Observer {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Observer;
});

beforeEach(() => {
  lookup.lookupTerm.mockReset().mockResolvedValue(hit());
  onDismiss.mockReset();
  localStorage.clear();
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

describe("Define asks before it sends a word anywhere", () => {
  it("shows what will be sent, to whom, and starts no lookup", async () => {
    await show("quixotic");
    expect(lookup.lookupTerm).not.toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).toContain("quixotic");
    expect(text).toContain("Wiktionary");
    expect(text).toContain("Wikipedia");
    expect(byText("Look it up")).toBeDefined();
    expect(byText("Cancel")).toBeDefined();
    // The card is not already showing a result or a loading state.
    expect(text).not.toContain("Searching dictionary");
  });

  it("the very first render already says nothing was sent (no frame claiming a lookup)", () => {
    // Server rendering shows the first render only: effects never run.
    const html = renderToString(
      createElement(DefinitionCard, {
        request: { term: "quixotic", rect: { x: 0, y: 0, width: 1, height: 1 } },
        lang: "en",
        theme: getTheme("paper"),
        onDismiss,
      }),
    );
    expect(html).toContain("Nothing sent yet");
    // The status label would read exactly "Looking up"; the notice only begins with those words.
    expect(html).not.toMatch(/>Looking up</);
    expect(html).not.toContain("Searching dictionary");
    expect(lookup.lookupTerm).not.toHaveBeenCalled();
  });

  it("'Cancel' closes the card and no lookup ever starts", async () => {
    await show();
    await act(async () => byText("Cancel")!.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(lookup.lookupTerm).not.toHaveBeenCalled();
    expect(hasLookupConsent()).toBe(false);
  });

  it("'Look it up' starts exactly one lookup for that word and remembers the answer", async () => {
    await show("quixotic");
    await act(async () => byText("Look it up")!.click());
    expect(lookup.lookupTerm).toHaveBeenCalledTimes(1);
    expect(lookup.lookupTerm.mock.calls[0]![0]).toBe("quixotic");
    expect(localStorage.getItem(LOOKUP_CONSENT_KEY)).toBe("1");
    expect(document.body.textContent).toContain("Foolishly impractical.");
    expect(document.body.textContent).not.toContain("Look it up");
  });

  it("once allowed, the next word goes straight through without asking", async () => {
    localStorage.setItem(LOOKUP_CONSENT_KEY, "1");
    await show("ephemeral");
    expect(lookup.lookupTerm).toHaveBeenCalledTimes(1);
    expect(lookup.lookupTerm.mock.calls[0]![0]).toBe("ephemeral");
    expect(byText("Look it up")).toBeUndefined();
  });

  it("when the answer cannot be remembered, this card still works but the next one asks again", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await show();
    await act(async () => byText("Look it up")!.click());
    expect(lookup.lookupTerm).toHaveBeenCalledTimes(1);
    expect(hasLookupConsent()).toBe(false);
  });
});

describe("the Read more link", () => {
  it("is offered for a Wikimedia page and goes through the confirmation, not straight out", async () => {
    localStorage.setItem(LOOKUP_CONSENT_KEY, "1");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await show();
    const link = document.querySelector<HTMLAnchorElement>("a[href^='https://en.wiktionary.org']")!;
    expect(link).not.toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => void link.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(getPendingLink()).toMatchObject({
      url: "https://en.wiktionary.org/wiki/quixotic",
      by: "app",
    });
  });

  it("a middle click is held for the same confirmation", async () => {
    localStorage.setItem(LOOKUP_CONSENT_KEY, "1");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await show();
    const link = document.querySelector<HTMLAnchorElement>("a[href^='https://en.wiktionary.org']")!;
    const aux = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    await act(async () => void link.dispatchEvent(aux));
    expect(aux.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(getPendingLink()?.by).toBe("app");
  });

  it("is not offered when the address is not a Wikimedia page", async () => {
    localStorage.setItem(LOOKUP_CONSENT_KEY, "1");
    lookup.lookupTerm.mockResolvedValue(hit({ url: "javascript:alert(1)" }));
    await show();
    expect(document.body.textContent).toContain("Foolishly impractical.");
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
    expect(document.body.textContent).not.toContain("Read more");
  });
});
