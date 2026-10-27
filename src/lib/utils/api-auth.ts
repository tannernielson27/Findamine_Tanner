import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { authenticatedUserId } from "@/lib/auth/claims";
import { loadUserRowWithBand } from "@/lib/auth/viewer";
import type { AuthUser } from "@/lib/types/database";
import type { UserRole } from "@/lib/types/enums";

/** Account statuses that may not use the API at all. */
const BLOCKED_STATUSES = new Set(["suspended", "banned", "inactive"]);

/**
 * The authenticated caller: AuthUser plus their stored age band, so routes
 * need no second user_profiles query for it.
 */
export type ApiAuthUser = AuthUser & {
  /** user_profiles.effective_band, or null when the user has no profile row. */
  effective_band: string | null;
};

/**
 * The caller's profile, or null when the account is deleted, suspended, banned
 * or inactive. Routes use the service client, which bypasses RLS, so this is
 * where a sanctioned account actually loses access. pending_consent accounts
 * still resolve: src/proxy.ts keeps them on the consent pages.
 */
async function loadActiveProfile(
  serviceClient: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  authId: string
): Promise<ApiAuthUser | null> {
  const profile = await loadUserRowWithBand(serviceClient, authId);
  if (!profile || BLOCKED_STATUSES.has(profile.status)) return null;
  return {
    id: profile.id,
    auth_id: profile.auth_id,
    role: profile.role,
    display_name: profile.display_name,
    effective_band: profile.effective_band,
  } as ApiAuthUser;
}

/**
 * Extract the authenticated user from the request.
 * Supports both cookie-based auth (web) and Bearer token auth (mobile).
 */
export async function getAuthUser(
  request: NextRequest
): Promise<ApiAuthUser | null> {
  // Try Bearer token first (mobile app)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const serviceClient = await createSupabaseServiceClient();
    const authId = await authenticatedUserId(serviceClient.auth, token);
    if (!authId) return null;

    return loadActiveProfile(serviceClient, authId);
  }

  // Fall back to cookie-based auth (web)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // API routes don't need to set cookies
        },
      },
    }
  );

  const authId = await authenticatedUserId(supabase.auth);
  if (!authId) return null;

  const serviceClient = await createSupabaseServiceClient();
  return loadActiveProfile(serviceClient, authId);
}

/**
 * Throw if user is not authenticated or doesn't have one of the required roles.
 */
export function requireRole(
  user: AuthUser | null,
  ...roles: UserRole[]
): asserts user is AuthUser {
  if (!user) {
    throw new ApiError(401, "Not authenticated");
  }
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new ApiError(403, "Forbidden");
  }
}

/**
 * Sanitize user input for use in PostgREST filter strings (.ilike, .or).
 * Escapes characters that have special meaning in PostgREST filter syntax.
 */
export function sanitizeFilterInput(input: string): string {
  // Remove PostgREST operators and special chars that could manipulate filters
  return input
    .replace(/[\\%_(),.]/g, "\\$&") // escape SQL LIKE wildcards and PostgREST delimiters
    .replace(/[^\w\s\-'"]/g, "")    // strip anything else that isn't word chars, spaces, hyphens, quotes
    .slice(0, 200);                  // cap length to prevent abuse
}

/**
 * Block children from accessing a feature unless their privacy settings allow it.
 * Throws 403 if the user is a child. Use on social endpoints (friends, wall, kudos, etc.).
 */
export function blockChildren(
  user: AuthUser | null,
  feature?: string
): void {
  if (user && user.role === "child") {
    throw new ApiError(
      403,
      feature
        ? `This feature (${feature}) is not available for child accounts.`
        : "This feature is not available for child accounts."
    );
  }
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Standard JSON error response.
 */
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message },
      { status: error.statusCode }
    );
  }
  console.error("Unhandled error:", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
