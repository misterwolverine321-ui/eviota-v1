import { expect, test } from "@playwright/test";
import { waitForApp } from "./ready";
import { makeTocEpub } from "./fixtures";

/**
 * The book is drawn in an iframe, and the app's own `@font-face` rules do not reach into it.
 * `src/lib/book-fonts.ts` copies the bundled Lora and Inter faces into the book's stylesheet, so a
 * book set in Lora looks the same on a device without Lora. This checks that the Lora face is
 * loaded inside the book's own document. (The sandbox has Lora installed system-wide, so a rendered
 * screenshot cannot show the difference; the loaded face can.)
 */
test("a book is set in the bundled Lora, loaded inside the book", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', [makeTocEpub()]);
  const link = page.getByRole("link", { name: /contents probe/i });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await expect(page).toHaveURL(/\/read\//);

  const loraLoadedInBook = async () => {
    for (const frame of page.frames()) {
      const loaded = await frame
        .evaluate(() =>
          [...document.fonts].some(
            (face) => face.family.includes("Lora") && face.status === "loaded",
          ),
        )
        .catch(() => false);
      if (loaded) return true;
    }
    return false;
  };
  await expect.poll(loraLoadedInBook, { timeout: 30_000 }).toBe(true);
});
