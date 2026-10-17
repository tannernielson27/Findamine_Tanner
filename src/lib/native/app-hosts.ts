/**
 * Hosts that serve the Findamine web app. The iOS wrapper's web view may only
 * navigate to these (capacitor.config.ts `server.allowNavigation`); any other
 * top-level navigation is handed to Safari by Capacitor.
 *
 * findamine-tanner.vercel.app is today's production host; findamine.app (and
 * www) is where it moves. Listing both now means a Vercel redirect between
 * them keeps working in builds already on people's phones.
 *
 * Imported by capacitor.config.ts with a relative path, so keep this file free
 * of "@/" imports and browser globals.
 */
export const APP_HOSTS = ["findamine-tanner.vercel.app", "findamine.app", "www.findamine.app"] as const;

/** True for a host the app's own pages live on (case-insensitive, no port). */
export function isAppHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return (APP_HOSTS as readonly string[]).includes(normalized);
}

/**
 * The in-app path for a link that should open inside the app (an https URL on
 * one of APP_HOSTS), or null for anything else. Used for universal links and
 * for "open URL" events, so a hostile URL can never be loaded in the web view.
 */
export function inAppPath(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  if (!isAppHost(parsed.hostname)) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
