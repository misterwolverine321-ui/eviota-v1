// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVOKE_DELAY_MS, useObjectUrl } from "@/hooks/use-object-url";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const made: { url: string; blob: Blob }[] = [];
const revoked: string[] = [];
let root: Root;
let host: HTMLElement;
let seen: (string | null)[] = [];

function Probe({ blob }: { blob: Blob | null }) {
  const url = useObjectUrl(blob);
  seen.push(url);
  return null;
}

/** A blob whose bytes can be read back, like the ones this app stores. */
const blobOf = (text: string) =>
  ({
    type: "image/jpeg",
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as unknown as Blob;

beforeEach(() => {
  made.length = 0;
  revoked.length = 0;
  seen = [];
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:test/${made.length + 1}`;
    made.push({ url, blob });
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => void revoked.push(url)) as typeof URL.revokeObjectURL;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("useObjectUrl (cover images)", () => {
  it("serves an in-memory copy, not the blob handle that came out of IndexedDB", async () => {
    const original = blobOf("jpeg bytes");
    act(() => root.render(createElement(Probe, { blob: original })));
    await flush();
    expect(made).toHaveLength(1);
    expect(made[0]!.blob).not.toBe(original);
    expect(made[0]!.blob).toBeInstanceOf(Blob);
    expect(await made[0]!.blob.text()).toBe("jpeg bytes");
    expect(made[0]!.blob.type).toBe("image/jpeg");
    expect(seen.at(-1)).toBe(made[0]!.url);
  });

  it("does not revoke a replaced URL at once: an image mid-load keeps its source", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => root.render(createElement(Probe, { blob: blobOf("one") })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    const first = made[0]!.url;
    // A progress update re-reads the book, so the component gets a new Blob object.
    act(() => root.render(createElement(Probe, { blob: blobOf("one") })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(made).toHaveLength(2);
    expect(revoked).not.toContain(first); // the old behaviour revoked here, synchronously
    await act(async () => void (await vi.advanceTimersByTimeAsync(REVOKE_DELAY_MS + 50)));
    expect(revoked).toContain(first);
    expect(revoked).not.toContain(made[1]!.url);
  });

  it("releases the URL after unmount, and never creates one for an unmounted component", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => root.render(createElement(Probe, { blob: blobOf("x") })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    const url = made[0]!.url;
    act(() => root.render(createElement(Probe, { blob: null })));
    await act(async () => void (await vi.advanceTimersByTimeAsync(REVOKE_DELAY_MS + 50)));
    expect(revoked).toContain(url);
    expect(seen.at(-1)).toBeNull();
  });

  it("gives null for no blob", async () => {
    act(() => root.render(createElement(Probe, { blob: null })));
    await flush();
    expect(made).toHaveLength(0);
    expect(seen.every((u) => u === null)).toBe(true);
  });
});
