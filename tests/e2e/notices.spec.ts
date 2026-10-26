import { expect, test } from "@playwright/test";

/**
 * Most of the licences Eviota's parts come under ask that their notice travel with the software.
 * The file is part of the built site (scripts/verify-static.mjs) and Settings links to it, so the
 * person using the app can find it.
 */

test("Settings links to the third-party notices, and the link opens the file in a new tab", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("/#/settings");
  await expect(page.getByText("Open-source notices")).toBeVisible({ timeout: 30_000 });
  const link = page.getByRole("link", { name: "Read the notices" });
  const href = await link.getAttribute("href");
  expect(href).toBe(`${baseURL}/THIRD_PARTY_NOTICES.txt`);

  const [tab] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe(href);
  const text = await tab.locator("body").innerText();
  expect(text).toContain("EVIOTA - THIRD-PARTY NOTICES");
  // The parts the licences ask us to hand on are in it: the font licence, the shadcn/ui licence
  // and the OpenSSL fallback. DjVu.js and its GPL text are gone.
  expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
  expect(text).toContain("Copyright (c) 2023 shadcn");
  expect(text).toContain("OPENSSL FALLBACK NOTICE");
  expect(text).not.toContain("GNU GENERAL PUBLIC LICENSE");
  expect(await tab.evaluate(() => window.opener)).toBeNull();
});
