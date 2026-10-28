import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";
import { CBZ_PAGES, makeSampleCbz } from "./fixtures";

/**
 * Comic surface: tap navigation, fit modes, manga (RTL) tap inversion
 * and spread splitting. The fixture is generated in-process so no binary
 * archive lives in the repo.
 */

const surface = (page: Page) => page.locator("[data-comic-fit]");
const pageInput = (page: Page) => page.getByLabel("Go to page");

async function importCbz(page: Page) {
  const file = makeSampleCbz();
  await page.goto("/");
  await waitForApp(page);
  await page.setInputFiles('input[type="file"]', file);
  const card = page.getByRole("link", { name: /eviota\s*comic/i }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/\/read\//);
  // The first panel only appears once libarchive has extracted the archive.
  await expect(surface(page).locator("img").first()).toBeVisible({ timeout: 60_000 });
}

/** Click a fraction across the reading surface (0 = far left, 1 = far right). */
async function tapAt(page: Page, fraction: number) {
  const box = await surface(page).boundingBox();
  if (!box) throw new Error("comic surface has no box");
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

async function openDisplayTab(page: Page) {
  await page.keyboard.press("d");
  const panel = page.getByRole("dialog", { name: "Display" });
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole("banner").getByRole("button", { name: "Display" }).click();
  }
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

test.describe("comic reader", () => {
  test("opens a CBZ and shows the first page", async ({ page }) => {
    await importCbz(page);
    await expect(surface(page).getByRole("img")).toHaveCount(1);
    await expect(pageInput(page)).toHaveValue("1");
    await expect(page.getByLabel("Page position")).toHaveAttribute("max", String(CBZ_PAGES));
  });

  test("tapping right advances and tapping left goes back", async ({ page }) => {
    await importCbz(page);
    await tapAt(page, 0.85);
    await expect(pageInput(page)).toHaveValue("2");
    await tapAt(page, 0.85);
    await expect(pageInput(page)).toHaveValue("3");
    await tapAt(page, 0.15);
    await expect(pageInput(page)).toHaveValue("2");
  });

  test("changing the fit mode resizes the rendered panel", async ({ page }) => {
    await importCbz(page);
    const img = surface(page).getByRole("img").first();
    const panel = await openDisplayTab(page);
    await panel.getByRole("button", { name: "height", exact: true }).click();
    await expect(surface(page)).toHaveAttribute("data-comic-fit", "height");
    const tall = await img.evaluate((el) => el.getBoundingClientRect().height);

    await panel.getByRole("button", { name: "width", exact: true }).click();
    await expect(surface(page)).toHaveAttribute("data-comic-fit", "width");
    await expect
      .poll(async () => img.evaluate((el) => el.getBoundingClientRect().height))
      .not.toBeCloseTo(tall, 0);
  });

  test("manga mode inverts the tap zones", async ({ page }) => {
    await importCbz(page);
    const panel = await openDisplayTab(page);
    await panel.getByRole("button", { name: "Manga RTL" }).click();
    await expect(surface(page)).toHaveAttribute("data-comic-manga", "true");
    await page.keyboard.press("Escape");

    // Left half now advances, right half goes back.
    await tapAt(page, 0.15);
    await expect(pageInput(page)).toHaveValue("2");
    await tapAt(page, 0.85);
    await expect(pageInput(page)).toHaveValue("1");
  });

  test("splitting wide pages adds a panel", async ({ page }) => {
    await importCbz(page);
    const panel = await openDisplayTab(page);
    await panel.getByRole("button", { name: "Split wide pages" }).click();
    // The fixture holds exactly one wide double-page scan.
    await expect(page.getByLabel("Page position")).toHaveAttribute("max", String(CBZ_PAGES + 1), {
      timeout: 60_000,
    });
  });

  test("two-finger pinch zooms in and back out without turning the page", async ({ page }) => {
    await importCbz(page);
    const box = await surface(page).boundingBox();
    if (!box) throw new Error("comic surface has no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Synthetic touch pointers: two fingers land 80px apart and spread to
    // 400px, then squeeze back. The hook owns the gesture (touch-action:none).
    const pinch = (from: number, to: number) =>
      page.evaluate(
        ({ cx, cy, from, to }) => {
          const el = document.querySelector("[data-comic-fit]")!;
          const fire = (type: string, id: number, x: number) =>
            el.dispatchEvent(
              new PointerEvent(type, {
                pointerId: id,
                pointerType: "touch",
                clientX: x,
                clientY: cy,
                bubbles: true,
                isPrimary: id === 1,
              }),
            );
          fire("pointerdown", 1, cx - from / 2);
          fire("pointerdown", 2, cx + from / 2);
          const steps = 12;
          for (let i = 1; i <= steps; i++) {
            const d = from + ((to - from) * i) / steps;
            fire("pointermove", 1, cx - d / 2);
            fire("pointermove", 2, cx + d / 2);
          }
          fire("pointerup", 1, cx - to / 2);
          fire("pointerup", 2, cx + to / 2);
        },
        { cx, cy, from, to },
      );

    await pinch(80, 400);
    await expect.poll(() => surface(page).getAttribute("data-comic-zoom")).not.toBe("1.00");
    // The pinch's trailing pointer-ups must not have turned the page.
    await expect(pageInput(page)).toHaveValue("1");

    await pinch(400, 80);
    await expect.poll(() => surface(page).getAttribute("data-comic-zoom")).toBe("1.00");
  });
});
