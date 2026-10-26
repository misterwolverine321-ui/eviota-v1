/**
 * Whether the reader has agreed that Define may send a selected word to Wikimedia.
 *
 * Define is the one place the reader can start a request that carries something about what they
 * are reading, so it asks first. The answer is kept on this device (localStorage, never sent), and
 * Settings can take it back. If storage fails, the answer cannot be kept and reads as "not allowed":
 * the reader is asked again rather than assumed to have agreed.
 */

export const LOOKUP_CONSENT_KEY = "nawiri-lookup-consent";

export function hasLookupConsent(): boolean {
  try {
    return localStorage.getItem(LOOKUP_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function grantLookupConsent(): void {
  try {
    localStorage.setItem(LOOKUP_CONSENT_KEY, "1");
  } catch {
    /* private mode or blocked storage: the answer simply is not kept */
  }
}

export function revokeLookupConsent(): void {
  try {
    localStorage.removeItem(LOOKUP_CONSENT_KEY);
  } catch {
    /* nothing to do */
  }
}
