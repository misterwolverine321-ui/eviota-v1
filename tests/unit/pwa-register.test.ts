// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "@/lib/pwa";

/**
 * `registerServiceWorker()` is called from a React effect in the root route.
 * In a real Chromium run of the production build that effect always ran about
 * 50 ms AFTER the window `load` event, so a `load` listener added at that point
 * never fired and no worker was ever registered (no `sw.js` request, no cache).
 * These tests pin the contract: register straight away when the page has already
 * loaded, wait for `load` otherwise.
 */

function installFakeServiceWorker(existing: unknown[] = []) {
  const register = vi.fn().mockResolvedValue({});
  const getRegistrations = vi.fn().mockResolvedValue(existing);
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register, getRegistrations },
    configurable: true,
  });
  return { register, getRegistrations };
}

function setReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, "readyState", { value: state, configurable: true });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubEnv("PROD", true);
  history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (document as unknown as { readyState?: string }).readyState;
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  history.replaceState({}, "", "/");
});

describe("registerServiceWorker", () => {
  it("registers at once when the page has already finished loading", async () => {
    const { register } = installFakeServiceWorker();
    setReadyState("complete");
    registerServiceWorker();
    await flush();
    expect(register).toHaveBeenCalledTimes(1);
    expect(String(register.mock.calls[0]![0])).toMatch(/\/sw\.js$/);
  });

  it("waits for `load` while the page is still loading, then registers exactly once", async () => {
    const { register } = installFakeServiceWorker();
    setReadyState("loading");
    registerServiceWorker();
    await flush();
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    await flush();
    expect(register).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("load"));
    await flush();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside a production build (dev would serve stale chunks)", async () => {
    vi.stubEnv("PROD", false);
    const { register } = installFakeServiceWorker();
    setReadyState("complete");
    registerServiceWorker();
    await flush();
    expect(register).not.toHaveBeenCalled();
  });

  it("?sw=off unregisters Eviota's own worker only, and registers nothing", async () => {
    const ours = {
      active: { scriptURL: "http://localhost/sw.js" },
      unregister: vi.fn().mockResolvedValue(true),
    };
    const other = {
      active: { scriptURL: "http://localhost/other-worker.js" },
      unregister: vi.fn().mockResolvedValue(true),
    };
    const { register } = installFakeServiceWorker([ours, other]);
    history.replaceState({}, "", "/?sw=off");
    setReadyState("complete");
    registerServiceWorker();
    await flush();
    expect(register).not.toHaveBeenCalled();
    expect(ours.unregister).toHaveBeenCalledTimes(1);
    expect(other.unregister).not.toHaveBeenCalled();
  });

  it("does not throw when a worker cannot be registered", async () => {
    const { register } = installFakeServiceWorker();
    register.mockRejectedValueOnce(new Error("SecurityError"));
    setReadyState("complete");
    expect(() => registerServiceWorker()).not.toThrow();
    await flush();
    expect(register).toHaveBeenCalledTimes(1);
  });
});
