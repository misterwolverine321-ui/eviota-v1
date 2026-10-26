// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  grantLookupConsent,
  hasLookupConsent,
  LOOKUP_CONSENT_KEY,
  revokeLookupConsent,
} from "@/lib/lookup-consent";

/**
 * Define sends the selected word to Wikimedia. The reader is asked once; the answer is kept on this
 * device only, and Settings can take it back. Storage that fails means "not allowed", never "allowed".
 */

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("lookup consent", () => {
  it("is not given until the reader gives it", () => {
    expect(hasLookupConsent()).toBe(false);
  });

  it("is remembered once given, and can be taken back", () => {
    grantLookupConsent();
    expect(hasLookupConsent()).toBe(true);
    expect(localStorage.getItem(LOOKUP_CONSENT_KEY)).toBe("1");
    revokeLookupConsent();
    expect(hasLookupConsent()).toBe(false);
    expect(localStorage.getItem(LOOKUP_CONSENT_KEY)).toBeNull();
  });

  it("counts only the exact value it wrote", () => {
    for (const junk of ["0", "true", "yes", "", " 1"]) {
      localStorage.setItem(LOOKUP_CONSENT_KEY, junk);
      expect(hasLookupConsent(), JSON.stringify(junk)).toBe(false);
    }
  });

  it("reads as not allowed when storage cannot be read", () => {
    grantLookupConsent();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(hasLookupConsent()).toBe(false);
  });

  it("does not throw when storage cannot be written, and then stays not allowed", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => grantLookupConsent()).not.toThrow();
    expect(hasLookupConsent()).toBe(false);
  });

  it("does not throw when storage cannot be changed on withdrawal", () => {
    grantLookupConsent();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => revokeLookupConsent()).not.toThrow();
  });
});
