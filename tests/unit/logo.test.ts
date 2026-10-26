// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EviotaLogo, EviotaSymbol } from "@/components/brand/logo";
import { LOGO_VIEWBOX } from "@/components/brand/paths";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement }[] = [];
function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(el));
  mounted.push({ root, host });
  return host;
}
afterEach(() => {
  for (const { root, host } of mounted) {
    act(() => root.unmount());
    host.remove();
  }
  mounted = [];
});

describe("EviotaLogo", () => {
  it("is one labelled image of three outlined shapes with no live text", () => {
    const svg = mount(createElement(EviotaLogo)).querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Eviota");
    expect(svg.querySelectorAll("path")).toHaveLength(3);
    expect(svg.querySelector("text, tspan, image, script")).toBeNull();
  });

  it("cuts the N out of the page (even-odd) and lets the text colour drive page and letters", () => {
    const [page, fold, word] = Array.from(
      mount(createElement(EviotaLogo)).querySelectorAll("path"),
    );
    expect(page!.getAttribute("fill-rule")).toBe("evenodd");
    expect(page!.getAttribute("fill")).toBe("currentColor");
    expect(word!.getAttribute("fill")).toBe("currentColor");
    // The fold is the one red thing and follows the theme through the CSS variable.
    expect(fold!.getAttribute("style")).toContain("var(--signal-ink)");
    expect(fold!.getAttribute("fill")).toBeNull();
  });

  it("carries its aspect ratio as attributes so height-only sizing works in Safari", () => {
    const svg = mount(createElement(EviotaLogo, { className: "h-7 w-auto" })).querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${LOGO_VIEWBOX.width} ${LOGO_VIEWBOX.height}`);
    expect(Number(svg.getAttribute("width")) / Number(svg.getAttribute("height"))).toBeCloseTo(
      LOGO_VIEWBOX.width / LOGO_VIEWBOX.height,
      5,
    );
    expect(svg.getAttribute("class")).toBe("h-7 w-auto");
  });

  it("accepts a different accessible name", () => {
    const svg = mount(createElement(EviotaLogo, { title: "Eviota Reader home" })).querySelector(
      "svg",
    )!;
    expect(svg.getAttribute("aria-label")).toBe("Eviota Reader home");
  });
});

describe("EviotaSymbol", () => {
  it("is the page and fold only, on a square canvas", () => {
    const svg = mount(createElement(EviotaSymbol)).querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 320 320");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
  });
});
