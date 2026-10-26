import { describe, expect, it } from "vitest";
import { waitForIndexBuild } from "@/lib/search-wait";

/** A promise that is settled from outside, and the order things happened in. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every promise that can settle without a timer do so. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("waitForIndexBuild", () => {
  it("returns at once when no build was started", async () => {
    await expect(
      waitForIndexBuild(() => null, new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it("waits for the build, and returns after it finishes", async () => {
    const build = deferred();
    const seen: string[] = [];
    const waiting = waitForIndexBuild(() => build.promise, new AbortController().signal).then(() =>
      seen.push("returned"),
    );
    await flush();
    expect(seen).toEqual([]);
    build.resolve();
    await waiting;
    expect(seen).toEqual(["returned"]);
  });

  it("does not throw when the build fails", async () => {
    const build = deferred();
    const waiting = waitForIndexBuild(() => build.promise, new AbortController().signal);
    build.reject(new Error("could not read the book"));
    await expect(waiting).resolves.toBeUndefined();
  });

  it("stops waiting when the search is cancelled, with the build still running", async () => {
    const build = deferred();
    const controller = new AbortController();
    const seen: string[] = [];
    const waiting = waitForIndexBuild(() => build.promise, controller.signal).then(() =>
      seen.push("returned"),
    );
    await flush();
    expect(seen).toEqual([]);
    controller.abort();
    await waiting;
    expect(seen).toEqual(["returned"]);
  });

  it("returns at once for a search that was cancelled before it began", async () => {
    const build = deferred();
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForIndexBuild(() => build.promise, controller.signal),
    ).resolves.toBeUndefined();
  });

  it("also waits for the build that replaced the one it was waiting for", async () => {
    // The reader declared new capabilities (text recognition switched on): the first build was
    // given up and a second one started in its place.
    const first = deferred();
    const second = deferred();
    let current = first.promise;
    const seen: string[] = [];
    const waiting = waitForIndexBuild(() => current, new AbortController().signal).then(() =>
      seen.push("returned"),
    );
    await flush();
    current = second.promise;
    first.resolve();
    await flush();
    expect(seen).toEqual([]);
    second.resolve();
    await waiting;
    expect(seen).toEqual(["returned"]);
  });

  it("does not wait for ever on builds that keep being replaced", async () => {
    const builds = [deferred(), deferred(), deferred(), deferred()];
    let at = 0;
    const waiting = waitForIndexBuild(() => builds[at]!.promise, new AbortController().signal, 3);
    for (let i = 0; i < 3; i++) {
      await flush();
      at++;
      builds[i]!.resolve();
    }
    await expect(waiting).resolves.toBeUndefined();
  });
});
