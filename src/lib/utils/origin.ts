import type { NextRequest } from "next/server";
import { ApiError } from "./api-auth";
import { isTrustedOrigin } from "./trusted-origins";

export { NATIVE_APP_ORIGINS, isTrustedOrigin, trustedOrigins } from "./trusted-origins";

/**
 * CSRF defence for state-changing routes that accept the session cookie.
 *
 * - Bearer-token requests pass: a browser never attaches one cross-site on its
 *   own, so they can't be forged, and the cookie is not used when one is sent.
 * - No Origin header passes: browsers send Origin on every cross-origin
 *   request and on same-origin POST/PUT/PATCH/DELETE, so its absence means a
 *   non-browser client (which has no victim's cookie to ride on).
 * - Otherwise the Origin must be one of trustedOrigins(), else 403.
 *
 * SameSite=Lax session cookies already block most cross-site writes; this
 * covers the rest (same-site subdomains, older browsers, top-level POSTs).
 */
export function assertTrustedOrigin(request: NextRequest): void {
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return;
  const origin = request.headers.get("origin");
  if (origin === null) return;
  if (!isTrustedOrigin(request, origin)) {
    throw new ApiError(403, "This request came from a site that isn't allowed to make it.");
  }
}
