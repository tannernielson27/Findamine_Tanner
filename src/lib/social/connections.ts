/**
 * Whether two players are connected closely enough to send each other kudos
 * or shoutouts: accepted friends, recruiter/recruit (minion_links), or sharing
 * an active team or a class roster.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getViewerRelationship } from "@/lib/utils/viewer";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export async function areConnected(supabase: ServiceClient, a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const pair = [a, b];

  const { data: friendship } = await supabase
    .from("friend_connections")
    .select("id")
    .in("requester_id", pair)
    .in("addressee_id", pair)
    .eq("status", "accepted")
    .limit(1);
  if (friendship && friendship.length > 0) return true;

  const { data: crew } = await supabase
    .from("minion_links")
    .select("id")
    .in("recruiter_id", pair)
    .in("minion_id", pair)
    .limit(1);
  if (crew && crew.length > 0) return true;

  const rel = await getViewerRelationship(a, b);
  return rel === "team" || rel === "class";
}
