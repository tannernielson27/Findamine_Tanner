import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isTrustedOrigin } from "@/lib/utils/trusted-origins";
import { authenticatedUserId } from "@/lib/auth/claims";
import { authCookieOptions, isHttpsRequest, launchRedirect } from "@/lib/auth/session";

// Pages that pending_consent users CAN access
const CONSENT_ALLOWED_PATHS = [
  "/consent-pending",
  "/api/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  // Legal pages: parents and pending accounts must be able to read them.
  "/privacy",
  "/terms",
  "/account-suspended",
];

/** Matches BLOCKED_STATUSES in src/lib/utils/api-auth.ts. */
const SANCTIONED_STATUSES = ["suspended", "banned", "inactive"];

/**
 * Everything in the (app) route group except the public hunt catalogue
 * (/browse, which is linked from the landing page and listed in the sitemap).
 * Signed-out visitors to these are sent to /login?next=<where they were going>.
 * The (app) layout repeats the check for any route that is added to the group
 * without being listed here, so a missing entry fails closed, not open.
 */
const PROTECTED_PREFIXES = [
  "/admin",
  "/dashboard",
  "/debrief",
  "/leaderboard",
  "/play",
  "/profile",
  "/settings",
  "/surveys",
];

/**
 * Request header carrying the original path + query to server components
 * (layouts cannot read the URL themselves). Always overwritten here, so a
 * value sent by the client is never trusted.
 */
const REQUEST_PATH_HEADER = "x-findamine-path";

/**
 * CORS for API routes. The web app and the iOS wrapper (which loads the
 * remote site) are same-origin and need none; cross-origin access is granted
 * only to the trusted origins (the configured site and the Capacitor local
 * origins), never "*". Crons, the health check and native clients send no
 * Origin and are unaffected.
 */
function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && isTrustedOrigin(request, origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, x-client-type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CORS preflight for API routes
  if (pathname.startsWith("/api/") && request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  // The page being asked for, minus Next's internal RSC cache-busting param.
  const query = new URLSearchParams(request.nextUrl.search);
  query.delete("_rsc");
  const originalPath = query.size > 0 ? `${pathname}?${query.toString()}` : pathname;

  // Continue to the app with the (possibly refreshed) cookies and the path header.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_PATH_HEADER, originalPath);
    return NextResponse.next({ request: { headers } });
  };

  let supabaseResponse = forward();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Refreshed tokens are written back with a long Max-Age (persistent),
      // so iOS keeps the session when it kills the app's web view.
      cookieOptions: authCookieOptions(
        isHttpsRequest(request.headers.get("x-forwarded-proto"), request.nextUrl.protocol)
      ),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = forward();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Redirect while keeping any session cookies the refresh above just issued.
  const redirectTo = (path: string, next?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (next) url.searchParams.set("next", next);
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  // Refresh the session. getClaims() refreshes an expired access token (and
  // writes the new cookies through setAll above) and otherwise verifies the JWT
  // locally against the project's asymmetric (ES256) signing key, so the common
  // case costs no Auth round trip. Sanctioned/deleted accounts are still caught
  // by the users.status check below and the per-route profile lookups.
  const authUserId = await authenticatedUserId(supabase.auth);
  const authUser = authUserId ? { id: authUserId } : null;

  // Launch: `/` is the iOS app's start URL and the PWA's start_url. A
  // signed-in person goes straight into the app instead of the welcome
  // screen (whose "Sign in" button made a live session look signed out).
  const launchTo = launchRedirect(pathname, Boolean(authUser));
  if (launchTo) {
    return redirectTo(launchTo);
  }

  // Route guard: signed-out visitors never get an app shell. The page they
  // wanted is kept in ?next= so login can send them back to it.
  if (!authUser && PROTECTED_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
    return redirectTo("/login", originalPath);
  }

  // Someone who is already signed in has no use for the sign-up form. /login
  // decides where they belong (it also explains a session with no profile).
  if (authUser && isUnder(pathname, "/register")) {
    return redirectTo("/login", request.nextUrl.searchParams.get("next") ?? undefined);
  }

  // COPPA consent gate: block pending_consent users from app pages
  if (authUser) {
    const isAllowed = CONSENT_ALLOWED_PATHS.some((p) => pathname.startsWith(p));

    if (!isAllowed) {
      // Check user status — use a lightweight query via the anon key
      // (RLS will scope to the authenticated user's data)
      const { data: profile } = await supabase
        .from("users")
        .select("status")
        .eq("auth_id", authUser.id)
        .single();

      if (profile?.status === "pending_consent") {
        return redirectTo("/consent-pending");
      }
      // Sanctioned accounts get no app shell (the API already refuses them).
      if (profile && SANCTIONED_STATUSES.includes(profile.status)) {
        return redirectTo("/account-suspended");
      }
    }
  }

  // Append CORS headers to API responses
  if (pathname.startsWith("/api/")) {
    for (const [key, value] of Object.entries(corsHeaders(request))) {
      supabaseResponse.headers.set(key, value);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
