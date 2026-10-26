import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";

/**
 * A format that is recognised and kept but not opened: CHM, whose decoder was removed in checkpoint
 * 15 because it was a port of GPL-2.0-or-later code. (DjVu used to be here too, from checkpoint 14,
 * and was opened again with `djvu-rs` in checkpoint 16: see `djvu.spec.ts`.) Such a file must still be
 * accepted onto the shelf and kept, opening it must say plainly that it is not rendered in the app
 * yet and offer the file back unchanged, nothing may ask the site for a removed bundle, and the
 * shelf's format strip must not advertise it. The bytes below are not a real document: nothing
 * decodes them, so the spec checks what the app does with the file, not how it looks.
 */

async function ready(page: Page) {
  await waitForApp(page);
}

const KEPT = [
  {
    label: "CHM",
    name: "old-help.chm",
    mimeType: "application/vnd.ms-htmlhelp",
    // "ITSF", version 3, header length 0x60: the start of a real CHM, and nothing after it.
    bytes: Buffer.from([0x49, 0x54, 0x53, 0x46, 0x03, 0, 0, 0, 0x60, 0, 0, 0, 0x01, 0, 0, 0]),
    removedBundle: /lzx|itsf|chm[-_.]?(reader|decoder)/i,
  },
] as const;

for (const kept of KEPT) {
  test(`a ${kept.label} file is kept on the shelf and opens a screen that says it is not rendered yet`, async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on("request", (request) => {
      if (kept.removedBundle.test(request.url())) asked.push(request.url());
    });

    await page.goto("/");
    await ready(page);
    await page.setInputFiles('input[type="file"]', {
      name: kept.name,
      mimeType: kept.mimeType,
      buffer: kept.bytes,
    });

    const card = page.locator('a[href*="#/read/"]').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expect(page).toHaveURL(/\/read\//);

    await expect(
      page.getByRole("heading", { name: `${kept.label} isn't rendered in-app yet` }),
    ).toBeVisible();
    await expect(page.getByText("Eviota recognizes this file and keeps it safely")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download file" })).toBeVisible();

    // Giving the file back returns the same bytes the reader added.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download file" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(kept.name);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(kept.bytes)).toBe(true);

    expect(asked, "nothing asked the site for a removed decoder").toEqual([]);
  });
}

test("the shelf's format strip lists DjVu, which opens, and not CHM, which does not", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const strip = page.locator("section", { hasText: "Supported formats" });
  await expect(strip).toBeVisible();
  await expect(strip.getByText("EPUB", { exact: true })).toBeVisible();
  await expect(strip.getByText("DJVU", { exact: true })).toBeVisible();
  await expect(strip.getByText("CHM", { exact: true })).toHaveCount(0);
});
