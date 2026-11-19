/**
 * Who in a recruiter's crew is in their "My Crew" privacy audience (server side).
 *
 * Joining a crew takes only an invite code, so it opens nothing by itself:
 * the recruiter approves each member (minion_links.audience_approved_at,
 * migration 091). Points are not affected either way. The read side is in
 * social-tiers.ts.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";
import { CREW_JOINED_TYPE, usesSocialAudiences } from "@/lib/social/follow-rules";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * Approve (or stop approving) one crew member. Only ever touches the link
 * where `recruiterId` is the recruiter. Returns false when there is no such
 * link; throws on a database error.
 */
export async function setCrewAudienceApproval(
  supabase: ServiceClient,
  recruiterId: string,
  minionId: string,
  approved: boolean
): Promise<boolean> {
  const { data, error } = await supabase
    .from("minion_links")
    .update({ audience_approved_at: approved ? new Date().toISOString() : null })
    .eq("recruiter_id", recruiterId)
    .eq("minion_id", minionId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

/**
 * Tell a recruiter that someone joined their crew, so they can decide whether
 * to approve them. Only for recruiters whose audiences cover crews (adults and
 * staff). Never throws: joining stands whether or not this is delivered.
 */
export async function notifyCrewJoined(supabase: ServiceClient, recruiterId: string, minionId: string): Promise<void> {
  try {
    const { data: people } = await supabase
      .from("users")
      .select("id, role, display_name, avatar_url, profile_visibility")
      .in("id", [recruiterId, minionId]);
    const recruiter = (people || []).find((p) => p.id === recruiterId);
    const member = (people || []).find((p) => p.id === minionId);
    if (!recruiter || !usesSocialAudiences(recruiter.role as string | null)) return;

    // The member's name, as the recruiter is allowed to see it.
    const rels = await getViewerRelationships(recruiterId, [minionId]);
    const shown = filterProfileForViewer(member ?? {}, rels.get(minionId) ?? "public");
    const { error } = await supabase.from("notifications").insert({
      user_id: recruiterId,
      type: CREW_JOINED_TYPE,
      title: `${shown.display_name || "A player"} joined your crew`,
      body: "Choose on your crew page whether they see what you share with My Crew.",
      entity_type: "user",
      entity_id: minionId,
    });
    if (error) console.error(`Crew join stored but the notification failed: ${error.message}`);
  } catch (err) {
    console.error(`Crew join stored but the notification failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}
