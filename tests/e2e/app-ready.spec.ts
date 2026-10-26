import { expect, test } from "@playwright/test";
import { waitForApp } from "./ready";

/**
 * The page tells the tests it is live with `data-app-ready` on <html> (set by the root route), not
 * with the benchmark harness the specs used to wait for. The harness is developer tooling and is
 * loaded only for an address that asks for it (checkpoint 22, audit 5.3).
 */
test.describe("the ready marker and the benchmark harness", () => {
  test("an ordinary visit is marked ready and does not carry the benchmark", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    await page.goto("/");
    await waitForApp(page);
    expect(await page.evaluate(() => document.documentElement.dataset["appReady"])).toBe("1");
    expect(
      await page.evaluate(() => (window as unknown as { __eviotaBench?: unknown }).__eviotaBench),
    ).toBeUndefined();
    // The harness's own chunk is not even fetched.
    expect(requests.filter((p) => /\/assets\/bench-/.test(p))).toEqual([]);
  });

  test("the address /?bench loads it", async ({ page }) => {
    await page.goto("/?bench");
    await waitForApp(page);
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __eviotaBench?: { run?: unknown } }).__eviotaBench?.run ===
        "function",
      undefined,
      { timeout: 15_000 },
    );
  });
});
