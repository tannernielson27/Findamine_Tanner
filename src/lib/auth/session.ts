/**
 * Session persistence and launch routing, shared by the Supabase clients
 * (src/lib/supabase/*), the proxy (src/proxy.ts) and the root page.
 * Pure: no Next or Supabase imports, so it is safe on the client, the server
 * and in tests.
 */

/** Where a signed-in visitor to the launch URL belongs. */
export const SIGNED_IN_HOME = "/dashboard";

/**
 * 400 days: the longest lifetime browsers honour (RFC 6265bis) and the
 * @supabase/ssr default. A cookie without Max-Age/Expires is a session cookie,
 * which iOS drops whenever it kills the app's web view, so the auth cookies
 * must always carry one. The real session length is governed by Supabase's
 * refresh-token expiry, not by this number.
 */
export const AUTH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export interface AuthCookieOptions {
  path: "/";
  sameSite: "lax";
  secure: boolean;
  maxAge: number;
}

/**
 * Options for the Supabase auth cookies. Not httpOnly: the browser client
 * reads and refreshes the session from document.cookie. `secure` only on
 * https, so local http development still works.
 */
export function authCookieOptions(isHttps: boolean): AuthCookieOptions {
  return { path: "/", sameSite: "lax", secure: isHttps, maxAge: AUTH_COOKIE_MAX_AGE_SECONDS };
}

/**
 * Was this request made over https? Behind Vercel's edge the app sees plain
 * http, so the first `x-forwarded-proto` entry wins over the URL's protocol.
 */
export function isHttpsRequest(forwardedProto: string | null | undefined, urlProtocol?: string | null): boolean {
  const proto = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  return urlProtocol === "https:";
}

/**
 * The launch decision for `/` (the iOS app's start URL and the PWA's
 * start_url): a signed-in visitor goes straight into the app; anyone else
 * stays on the welcome screen (null). Other paths are never redirected here.
 */
export function launchRedirect(pathname: string, signedIn: boolean): string | null {
  return pathname === "/" && signedIn ? SIGNED_IN_HOME : null;
}
