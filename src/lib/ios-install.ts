/** Pure detection for the iPhone/iPad "Add to Home Screen" hint. */
export const IOS_INSTALL_DISMISS_KEY = "nawiri-ios-install-dismissed";

export function isIosDevice(ua: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS reports a desktop Mac user agent, but has touch points.
  return ua.includes("Macintosh") && maxTouchPoints > 1;
}

export function shouldShowIosInstall(env: {
  ua: string;
  maxTouchPoints: number;
  standalone: boolean;
  dismissed: boolean;
}): boolean {
  return isIosDevice(env.ua, env.maxTouchPoints) && !env.standalone && !env.dismissed;
}
