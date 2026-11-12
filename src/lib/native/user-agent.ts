/**
 * User-agent checks for "is this page open in the Findamine app or in a phone
 * browser?". The iOS and Android wrappers append "FindamineApp/<n>" to the web
 * view's user agent (capacitor.config.ts `appendUserAgent`).
 *
 * Used where an emailed link landed in Safari or Chrome instead of the app, so
 * the page can tell the person to go back to the app. No browser globals here:
 * the confirm route calls it with the request's user agent.
 */

const APP_USER_AGENT_PATTERN = /\bFindamineApp\/\d+/;
const PHONE_USER_AGENT_PATTERN = /\b(iPhone|iPad|iPod|Android)\b/;

export function isAppUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && APP_USER_AGENT_PATTERN.test(userAgent));
}

/**
 * True for a phone or tablet browser that is not the Findamine app. iPadOS
 * Safari reports itself as a Mac; pass `maxTouchPoints` (browser only) to
 * catch it, since desktop Macs report 0.
 */
export function isPhoneBrowserOutsideApp(userAgent: string | null | undefined, maxTouchPoints = 0): boolean {
  if (!userAgent || isAppUserAgent(userAgent)) return false;
  if (PHONE_USER_AGENT_PATTERN.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}
