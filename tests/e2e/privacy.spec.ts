import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeHostileEpub } from "./hostile";

/**
 * What the app contacts on its own. Opening the shelf, a book and Settings must not reach any
 * address but the app's own: the interface fonts used to come from Google on every visit, which
 * told Google that this browser opened Eviota. (The two lookups the reader can start, Define and
 * an external link, are covered by their own specs and both wait for a click.)
 */

async function ready(page: Page) {
  await waitForApp(page);
}

const FAMILIES = [
  "Inter Variable",
  "Inter Tight Variable",
  "JetBrains Mono Variable",
  "Lora Variable",
];

test("the shelf, a book and Settings reach no address but the app's own", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const outside: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin) return;
    if (["blob:", "data:", "about:"].includes(url.protocol)) return;
    outside.push(request.url());
  });

  await page.goto("/");
  await ready(page);
  await page.setInputFiles('input[type="file"]', makeHostileEpub());
  await page
    .getByRole("link", { name: /hostile epub/i })
    .first()
    .click();
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          const text = await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "");
          if (/Chapter One/.test(text)) return true;
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.goto("/#/settings");
  await expect(page.getByText("Backup & restore")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);

  expect(outside).toEqual([]);
});

test("the interface fonts are the app's own files", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const fontFiles: string[] = [];
  page.on("response", (response) => {
    if (/\.woff2?$/i.test(new URL(response.url()).pathname)) fontFiles.push(response.url());
  });

  await page.goto("/#/settings");
  await ready(page);
  await expect(page.getByText("Backup & restore")).toBeVisible({ timeout: 30_000 });

  const faces = () =>
    page.evaluate(() =>
      [...document.fonts].map((face) => ({
        family: face.family.replace(/["']/g, ""),
        style: face.style,
        status: face.status,
      })),
    );

  // All four families are declared in their upright style, and the serif also in italic, so a
  // book or a preview set in them finds the right face.
  const declared = await faces();
  for (const family of FAMILIES) {
    expect(
      declared.some((f) => f.family === family && f.style === "normal"),
      `${family} normal`,
    ).toBe(true);
  }
  expect(
    declared.some((f) => f.family === "Lora Variable" && f.style === "italic"),
    "Lora Variable italic",
  ).toBe(true);

  // The ones this page uses have actually loaded.
  for (const family of ["Inter Variable", "Inter Tight Variable", "JetBrains Mono Variable"]) {
    await expect
      .poll(async () => (await faces()).some((f) => f.family === family && f.status === "loaded"), {
        message: `${family} loaded`,
        timeout: 15_000,
      })
      .toBe(true);
  }

  expect(fontFiles.length).toBeGreaterThan(0);
  for (const url of fontFiles) expect(new URL(url).origin, url).toBe(origin);
});
