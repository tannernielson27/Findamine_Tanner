import { cache } from "react";
import { authenticatedUserId } from "@/lib/auth/claims";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Per-request signed-in viewer, deduplicated with React cache() so the (app)
 * layout and every page in the same render share one auth check and one
 * profile lookup.
 */

/** Columns of the `users` row that callers need (superset; pick what you use). */
const USER_COLUMNS =
  "id, auth_id, role, display_name, status, avatar_url, metadata, date_of_birth, profile_visibility";

export interface ViewerRow {
  id: string;
  auth_id: string;
  role: string;
  display_name: string | null;
  status: string;
  avatar_url: string | null;
  metadata: Record<string, unknown> | null;
  date_of_birth: string | null;
  profile_visibility: Record<string, unknown> | null;
  /** user_profiles.effective_band, or null when the user has no profile row. */
  effective_band: string | null;
}

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

function bandFromEmbed(embed: unknown): string | null {
  const row = Array.isArray(embed) ? embed[0] : embed;
  const band = (row as { effective_band?: string | null } | null | undefined)?.effective_band;
  return band ?? null;
}

/**
 * The live (not soft-deleted) `users` row for an auth id plus the stored age
 * band, in ONE round trip (users joined to user_profiles). If the join is ever
 * rejected, falls back to the two plain queries so access never breaks.
 */
export async function loadUserRowWithBand(
  db: ServiceClient,
  authId: string
): Promise<ViewerRow | null> {
  const joined = await db
    .from("users")
    .select(`${USER_COLUMNS}, user_profiles(effective_band)`)
    .eq("auth_id", authId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!joined.error) {
    if (!joined.data) return null;
    const { user_profiles, ...row } = joined.data as Record<string, unknown>;
    return { ...(row as unknown as Omit<ViewerRow, "effective_band">), effective_band: bandFromEmbed(user_profiles) };
  }

  const { data: row } = await db
    .from("users")
    .select(USER_COLUMNS)
    .eq("auth_id", authId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return null;
  const { data: profile } = await db
    .from("user_profiles")
    .select("effective_band")
    .eq("user_id", (row as { id: string }).id)
    .maybeSingle();
  return {
    ...(row as unknown as Omit<ViewerRow, "effective_band">),
    effective_band: profile?.effective_band ?? null,
  };
}

/** Authenticated auth user id for this request (see authenticatedUserId), deduped per request. */
export const getAuthId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient();
  return authenticatedUserId(supabase.auth);
});

/** The viewer's live users row (+ stored band), or null if signed out / no profile. */
export const getViewerRow = cache(async (): Promise<ViewerRow | null> => {
  const authId = await getAuthId();
  if (!authId) return null;
  const db = await createSupabaseServiceClient();
  return loadUserRowWithBand(db, authId);
});
