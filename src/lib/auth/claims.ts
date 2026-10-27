import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The authenticated auth user id for a request, or null.
 *
 * Wraps auth.getClaims(): the project signs JWTs with an asymmetric key
 * (ES256), so a valid token is verified locally against the cached JWKS with
 * no Auth round trip (it falls back to a network check for symmetric keys).
 * With no `jwt` argument the client's session is used, and an expired access
 * token is refreshed first. getClaims() throws a plain Error for an expired or
 * malformed token passed in directly; that is "not signed in", never a 500.
 *
 * Only role "authenticated" counts: the anon key is a valid JWT too.
 */
export async function authenticatedUserId(
  auth: SupabaseClient["auth"],
  jwt?: string
): Promise<string | null> {
  try {
    const { data } = await auth.getClaims(jwt);
    const claims = data?.claims;
    return claims?.sub && claims.role === "authenticated" ? claims.sub : null;
  } catch {
    return null;
  }
}
