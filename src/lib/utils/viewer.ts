/**
 * Viewer relationship resolution (Workstream A / Task A5).
 *
 * Determines a viewer's relationship to a target user so profile-field visibility
 * (see canViewField/visibleFields in privacy.ts) can be enforced at read paths.
 *
 *   self   → same user
 *   team   → share an active team (team_members)
 *   class  → share a roster/class (roster_entries)
 *   public → no shared team or class
 *
 * For targets whose audiences cover social ties (adults and staff), two ties
 * also count (lib/social/social-tiers.ts): being in a crew together puts the
 * viewer in the target's "team" audience, and being followed BY the target
 * puts the viewer in the target's "class" audience. `via` says which.
 *
 * One resolver serves the single and the bulk call, so they cannot disagree.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ViewerRelationship } from "@/lib/utils/privacy";
import { SOCIAL_TIER, type RelationshipVia } from "@/lib/social/follow-rules";
import { getSocialTies } from "@/lib/social/social-tiers";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export interface ResolvedRelationship {
  relationship: ViewerRelationship;
  /** How the viewer got there: a real team or class, a crew, or a follow. */
  via: RelationshipVia;
}

const CLOSENESS: Readonly<Record<ViewerRelationship, number>> = { public: 1, class: 2, team: 3, self: 4 };

/** Targets who share a class roster with the viewer. */
async function classmatesAmong(supabase: ServiceClient, viewerId: string, targets: string[]): Promise<string[]> {
  const { data: viewerRosters } = await supabase
    .from("roster_entries")
    .select("roster_id")
    .eq("student_id", viewerId);
  const rosterIds = (viewerRosters || []).map((r) => r.roster_id);
  if (rosterIds.length === 0) return [];
  const { data } = await supabase
    .from("roster_entries")
    .select("student_id")
    .in("roster_id", rosterIds)
    .in("student_id", targets);
  return (data || []).map((c) => c.student_id as string);
}

/** Targets who are on an active team with the viewer. */
async function teammatesAmong(supabase: ServiceClient, viewerId: string, targets: string[]): Promise<string[]> {
  const { data: viewerTeams } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", viewerId)
    .eq("status", "active");
  const teamIds = (viewerTeams || []).map((t) => t.team_id);
  if (teamIds.length === 0) return [];
  const { data } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("status", "active")
    .in("team_id", teamIds)
    .in("user_id", targets);
  return (data || []).map((t) => t.user_id as string);
}

/**
 * The viewer's relationship to each target, in a fixed number of queries (the
 * three lookups run side by side). The viewer's own id resolves to "self".
 */
async function resolveMany(viewerId: string, targetIds: readonly string[]): Promise<Map<string, ResolvedRelationship>> {
  const result = new Map<string, ResolvedRelationship>();
  const targets = [...new Set(targetIds)].filter((id) => id);
  if (targets.length === 0) return result;

  for (const id of targets) {
    result.set(id, id === viewerId ? { relationship: "self", via: "self" } : { relationship: "public", via: "public" });
  }
  const others = targets.filter((id) => id !== viewerId);
  if (others.length === 0) return result;

  const supabase = await createSupabaseServiceClient();
  const [classmates, teammates, ties] = await Promise.all([
    classmatesAmong(supabase, viewerId, others),
    teammatesAmong(supabase, viewerId, others),
    getSocialTies(supabase, viewerId, others),
  ]);

  // Only ever move the viewer closer. Applied weakest first, and a real class
  // or team is kept over a social tie that is no closer.
  const raise = (id: string, next: ResolvedRelationship) => {
    const current = result.get(id);
    if (!current || id === viewerId) return;
    if (CLOSENESS[next.relationship] > CLOSENESS[current.relationship]) result.set(id, next);
  };
  for (const id of classmates) raise(id, { relationship: "class", via: "class" });
  for (const id of teammates) raise(id, { relationship: "team", via: "team" });
  for (const [id, tie] of ties) raise(id, { relationship: SOCIAL_TIER[tie], via: tie });

  return result;
}

/** The relationship with one target, and what it rests on. */
export async function resolveViewerRelationship(
  viewerId: string,
  targetUserId: string
): Promise<ResolvedRelationship> {
  if (viewerId === targetUserId) return { relationship: "self", via: "self" };
  const resolved = await resolveMany(viewerId, [targetUserId]);
  return resolved.get(targetUserId) ?? { relationship: "public", via: "public" };
}

export async function getViewerRelationship(
  viewerId: string,
  targetUserId: string
): Promise<ViewerRelationship> {
  return (await resolveViewerRelationship(viewerId, targetUserId)).relationship;
}

/**
 * Bulk variant: resolve the viewer's relationship to many target users in a fixed
 * number of queries (not N). Returns a Map keyed by target user id. "self" is
 * included for the viewer's own id if present.
 */
export async function getViewerRelationships(
  viewerId: string,
  targetIds: string[]
): Promise<Map<string, ViewerRelationship>> {
  const resolved = await resolveMany(viewerId, targetIds);
  return new Map([...resolved].map(([id, r]) => [id, r.relationship]));
}
