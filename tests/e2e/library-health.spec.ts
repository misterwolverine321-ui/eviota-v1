import { expect, test, type Page } from "@playwright/test";
import { waitForApp } from "./ready";

/**
 * Import checks, seen from the shelf: a file that is already there under another name is skipped
 * (the same bytes, not the same name), and a file that is empty or is not the kind its name says
 * is refused with a reason in the message.
 */

async function ready(page: Page) {
  await page.goto("/");
  await waitForApp(page);
}

const TEXT = "A short text that is the same file under two names.\n".repeat(4);

test("a file whose bytes are already on the shelf is skipped, under another name", async ({
  page,
}) => {
  await ready(page);
  await page.setInputFiles('input[type="file"]', {
    name: "first copy.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(TEXT),
  });
  await expect(page.getByRole("link", { name: /first copy/i })).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.setInputFiles('input[type="file"]', {
    name: "renamed copy.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(TEXT),
  });
  await expect(page.getByText("1 already on your shelf", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("link", { name: /renamed copy/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /first copy/i })).toHaveCount(1);
});

test("a file that is empty or not the kind its name says is refused, with the reason", async ({
  page,
}) => {
  await ready(page);
  await page.setInputFiles('input[type="file"]', [
    { name: "nothing here.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
    { name: "not really.pdf", mimeType: "application/pdf", buffer: Buffer.from("just words") },
  ]);
  await expect(
    page.getByText(
      "Couldn't read: nothing here.txt (is empty), not really.pdf (is not a PDF file)",
      {
        exact: true,
      },
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: /nothing here|not really/i })).toHaveCount(0);
});
