import type { NextRequest } from "next/server";

/**
 * Which browser origins may call the API.
 *
 * The web app is same-origin with its API, and the iOS wrapper loads the
 * remote site, so it is same-origin too. The Capacitor/Ionic local origins are
 * listed for a wrapper that serves a local bundle instead.
 */
export const NATIVE_APP_ORIGINS = ["capacitor://localhost", "ionic://localhost", "https://localhost"] as const;

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Origins trusted for this request: its own origin, the configured site, and the native wrappers. */
export function trustedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>(NATIVE_APP_ORIGINS);
  origins.add(request.nextUrl.origin);
  for (const configured of [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    const origin = originOf(configured);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function isTrustedOrigin(request: NextRequest, origin: string): boolean {
  return trustedOrigins(request).has(origin);
}
