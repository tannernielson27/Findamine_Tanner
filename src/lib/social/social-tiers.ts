/**
 * Social ties that place a viewer in someone's audiences (server side).
 *
 * For accounts whose audiences cover social ties (adults and staff, see
 * follow-rules.ts), two ties count next to real teams and class rosters:
 *
 *   crew    recruiter and recruit, either direction (minion_links)
 *             -> the viewer is in the owner's "team" audience
 *   follow  the profile's OWNER follows the viewer (player_follows)
 *             -> the viewer is in the owner's "class" audience
 *
 * Following someone gives the follower nothing: the owner decides who is in
 * their audience by choosing who they follow. Children's and teens' audiences
 * are untouched, whoever the viewer is.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/moderation/blocks";
import { usesSocialAudiences } from "@/lib/social/follow-rules";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export type SocialTie = "crew" | "follow";

interface QueryError {
  code?: string;
  message: string;
}

/** A failed read means "no tie" (the safe direction); only a missing table is expected. */
function logReadError(table: string, error: QueryError | null): void {
  if (error && !isMissingTable(error)) {
    console.error(`Failed to read ${table} for social audiences: ${error.message}`);
  }
}

/**
 * The strongest social tie between the viewer and each target, for targets
 * whose audiences cover social ties. Targets with no tie are absent.
 * A fixed number of queries, whatever the number of targets.
 */
export async function getSocialTies(
  supabase: ServiceClient,
  viewerId: string,
  targetIds: readonly string[]
): Promise<Map<string, SocialTie>> {
  const ties = new Map<string, SocialTie>();
  const targets = [...new Set(targetIds)].filter((id) => id && id !== viewerId);
  if (!viewerId || targets.length === 0) return ties;

  // Live accounts only: a deleted account's follows and crew links count for nothing.
  const { data: owners, error: ownersError } = await supabase
    .from("users")
    .select("id, role")
    .in("id", targets)
    .is("deleted_at", null);
  logReadError("users", ownersError);
  const eligible = (owners || [])
    .filter((u: { id: string; role: string | null }) => usesSocialAudiences(u.role))
    .map((u: { id: string }) => u.id);
  if (eligible.length === 0) return ties;

  const [followed, recruits, recruiters] = await Promise.all([
    // Owners who follow the viewer.
    supabase.from("player_follows").select("follower_id").eq("followee_id", viewerId).in("follower_id", eligible),
    // Owners the viewer recruited, and owners who recruited the viewer.
    supabase.from("minion_links").select("minion_id").eq("recruiter_id", viewerId).in("minion_id", eligible),
    supabase.from("minion_links").select("recruiter_id").eq("minion_id", viewerId).in("recruiter_id", eligible),
  ]);
  logReadError("player_follows", followed.error);
  logReadError("minion_links", recruits.error);
  logReadError("minion_links", recruiters.error);

  for (const row of followed.data || []) ties.set((row as { follower_id: string }).follower_id, "follow");
  // Crew is the closer tie, so it is written last and wins.
  for (const row of recruits.data || []) ties.set((row as { minion_id: string }).minion_id, "crew");
  for (const row of recruiters.data || []) ties.set((row as { recruiter_id: string }).recruiter_id, "crew");
  return ties;
}
