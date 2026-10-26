import { describe, expect, it } from "vitest";
import { isIosDevice, shouldShowIosInstall } from "@/lib/ios-install";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const base = { maxTouchPoints: 5, standalone: false, dismissed: false };

describe("isIosDevice", () => {
  it("detects iPhone in any browser", () => {
    expect(isIosDevice(IPHONE, 5)).toBe(true);
    expect(isIosDevice(CHROME_IOS, 5)).toBe(true);
  });
  it("detects iPadOS reporting as Macintosh with touch", () =>
    expect(isIosDevice(MAC, 5)).toBe(true));
  it("ignores desktop Mac and Android", () => {
    expect(isIosDevice(MAC, 0)).toBe(false);
    expect(isIosDevice(ANDROID, 5)).toBe(false);
  });
});

describe("shouldShowIosInstall", () => {
  it("shows on iOS when not installed or dismissed", () =>
    expect(shouldShowIosInstall({ ...base, ua: IPHONE })).toBe(true));
  it("hides when standalone", () =>
    expect(shouldShowIosInstall({ ...base, ua: IPHONE, standalone: true })).toBe(false));
  it("hides when dismissed", () =>
    expect(shouldShowIosInstall({ ...base, ua: IPHONE, dismissed: true })).toBe(false));
});
