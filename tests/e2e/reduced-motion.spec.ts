import { expect, test, type Frame, type Page } from "@playwright/test";
import { ANCHOR_DOC, MOVING_EPUB, makeAnchorHtml, makeLongTxt, makeMovingEpub } from "./fixtures";
import { waitForApp } from "./ready";

/**
 * A person who asked their system for less motion gets jumps instead of glides and no transitions
 * Every test runs with the setting on ("reduce") and, as a control that
 * the test can see motion at all, with it off ("no-preference").
 *
 * These run in Chromium with the preference emulated (`page.emulateMedia`). A real system setting
 * on macOS, iOS, Windows or Android has not been tried.
 */

type Setting = "reduce" | "no-preference";
const SETTINGS: Setting[] = ["reduce", "no-preference"];

/** Records the `behavior` of every scroll the page (and every frame in it) starts. */
async function recordScrolls(page: Page) {
  await page.addInitScript(() => {
    const seen: { call: string; behavior: string | undefined }[] = [];
    (window as unknown as { __scrolls: typeof seen }).__scrolls = seen;
    const wrap = (proto: object, name: string) => {
      const original = (proto as Record<string, (...a: unknown[]) => unknown>)[name];
      if (typeof original !== "function") return;
      (proto as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
        const first = args[0] as { behavior?: string } | undefined;
        seen.push({
          call: name,
          behavior: first && typeof first === "object" ? first.behavior : undefined,
        });
        return original.apply(this, args);
      };
    };
    for (const name of ["scrollBy", "scrollTo", "scrollIntoView"]) {
      wrap(Element.prototype, name);
      // A window's own methods live on the window itself (it is a [Global] object), not on
      // Window.prototype, and the HTML reader calls them on the book's iframe window.
      wrap(window, name);
    }
  });
}

const scrollsIn = (frame: Frame | Page) =>
  frame.evaluate(
    () =>
      (window as unknown as { __scrolls: { call: string; behavior?: string }[] }).__scrolls ?? [],
  );

/** The frame that holds a book's text. */
async function bookFrame(page: Page, text: string): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const has = await frame
        .evaluate((t) => document.body?.textContent?.includes(t) ?? false, text)
        .catch(() => false);
      if (has) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`no frame shows "${text}"`);
}

async function openBook(page: Page, file: string, name: RegExp) {
  await page.goto("/");
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', file);
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(/\/read\//);
}

test.describe("the interface", () => {
  for (const setting of SETTINGS) {
    test(`transitions and animations under ${setting}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: setting });
      await page.goto("/");
      await waitForApp(page);

      // The real page: elements whose computed transition is longer than a millisecond.
      const transitioning = await page.evaluate(() => {
        const ms = (v: string) =>
          Math.max(
            ...v.split(",").map((x) => parseFloat(x) * (x.trim().endsWith("ms") ? 1 : 1000)),
          );
        return [...document.querySelectorAll("*")].filter(
          (el) => ms(getComputedStyle(el).transitionDuration) > 1,
        ).length;
      });
      if (setting === "reduce") expect(transitioning).toBe(0);
      else
        expect(transitioning, "the control must see transitions on the shelf").toBeGreaterThan(0);

      // The rule itself, on elements that ask for long motion in their own style attribute.
      const probe = await page.evaluate(() => {
        const make = (cls: string, style: string) => {
          const el = document.createElement("div");
          el.className = cls;
          el.style.cssText = style;
          document.body.append(el);
          const s = getComputedStyle(el);
          const out = {
            animationDuration: s.animationDuration,
            animationIterationCount: s.animationIterationCount,
            transitionDuration: s.transitionDuration,
            scrollBehavior: s.scrollBehavior,
          };
          el.remove();
          return out;
        };
        return {
          custom: make(
            "",
            "animation: none 2s infinite; transition: opacity 2s; scroll-behavior: smooth",
          ),
          spinner: make("animate-spin", ""),
        };
      });
      if (setting === "reduce") {
        expect(probe.custom).toEqual({
          animationDuration: "1e-05s",
          animationIterationCount: "1",
          transitionDuration: "1e-05s",
          scrollBehavior: "auto",
        });
        // The loading spinner is kept: it is the sign that work is going on.
        expect(probe.spinner.animationDuration).toBe("1s");
        expect(probe.spinner.animationIterationCount).toBe("infinite");
      } else {
        expect(probe.custom).toEqual({
          animationDuration: "2s",
          animationIterationCount: "infinite",
          transitionDuration: "2s",
          scrollBehavior: "smooth",
        });
        expect(probe.spinner.animationDuration).toBe("1s");
      }
    });
  }
});

test.describe("a scroll the app starts itself", () => {
  for (const setting of SETTINGS) {
    test(`following a link inside an HTML book, under ${setting}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: setting });
      await recordScrolls(page);
      await openBook(page, makeAnchorHtml(), /anchor probe/i);
      const frame = await bookFrame(page, ANCHOR_DOC.link);

      await frame.getByRole("link", { name: ANCHOR_DOC.link }).click();

      const scrolls = (await scrollsIn(frame)).filter((s) => s.call === "scrollIntoView");
      expect(scrolls.length, "the link scrolls through scrollIntoView").toBeGreaterThan(0);
      const wanted = setting === "reduce" ? "auto" : "smooth";
      expect(scrolls.at(-1)?.behavior).toBe(wanted);

      if (setting === "reduce") {
        // And the person is there at once: the target heading is at the top, with no glide to wait for.
        const top = await frame.evaluate(
          () => document.getElementById("end")!.getBoundingClientRect().top,
        );
        expect(Math.abs(top)).toBeLessThan(40);
      }
    });

    test(`the Next page button in an HTML book, under ${setting}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: setting });
      await recordScrolls(page);
      await openBook(page, makeAnchorHtml(), /anchor probe/i);
      const frame = await bookFrame(page, ANCHOR_DOC.link);
      await page.getByRole("button", { name: "Next page" }).click();
      await expect
        .poll(async () => (await scrollsIn(frame)).filter((s) => s.call === "scrollBy").length)
        .toBeGreaterThan(0);
      const last = (await scrollsIn(frame)).filter((s) => s.call === "scrollBy").at(-1);
      expect(last?.behavior).toBe(setting === "reduce" ? "auto" : "smooth");
    });

    test(`the Next page button in a text file, under ${setting}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: setting });
      await recordScrolls(page);
      await openBook(page, makeLongTxt(), /long document/i);
      await expect(page.getByRole("button", { name: "Next page" })).toBeVisible();
      await page.getByRole("button", { name: "Next page" }).click();
      await expect
        .poll(async () => (await scrollsIn(page)).filter((s) => s.call === "scrollBy").length)
        .toBeGreaterThan(0);
      const last = (await scrollsIn(page)).filter((s) => s.call === "scrollBy").at(-1);
      expect(last?.behavior).toBe(setting === "reduce" ? "auto" : "smooth");
    });
  }

  for (const setting of SETTINGS) {
    test(`a book's own animation and transition, in HTML and in an EPUB, under ${setting}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: setting });
      const wanted = setting === "reduce" ? "1e-05s" : "3s";
      const heading = (frame: Frame) =>
        frame.evaluate(() => {
          const s = getComputedStyle(document.querySelector("h1")!);
          return { animation: s.animationDuration, transition: s.transitionDuration };
        });

      await openBook(page, makeAnchorHtml(), /anchor probe/i);
      expect(await heading(await bookFrame(page, ANCHOR_DOC.link)), "HTML").toEqual({
        animation: wanted,
        transition: wanted,
      });

      await openBook(page, makeMovingEpub(), /moving probe/i);
      expect(await heading(await bookFrame(page, MOVING_EPUB.text)), "EPUB").toEqual({
        animation: wanted,
        transition: wanted,
      });
    });
  }

  test("an HTML book's own stylesheet does not glide under reduce, and does without it", async ({
    page,
  }) => {
    for (const setting of SETTINGS) {
      await page.emulateMedia({ reducedMotion: setting });
      await openBook(page, makeAnchorHtml(), /anchor probe/i);
      const frame = await bookFrame(page, ANCHOR_DOC.link);
      const behavior = await frame.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      );
      expect(behavior, setting).toBe(setting === "reduce" ? "auto" : "smooth");
    }
  });
});
