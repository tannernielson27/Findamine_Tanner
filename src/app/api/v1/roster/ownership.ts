import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";

type Supabase = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * Throw unless the roster exists and belongs to this teacher (admins may act
 * on any roster). Same rule as the join-code route.
 */
export async function requireRosterOwner(
  supabase: Supabase,
  rosterId: string,
  user: { id: string; role: string }
): Promise<void> {
  const { data: roster } = await supabase
    .from("rosters")
    .select("id, teacher_id")
    .eq("id", rosterId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!roster) throw new ApiError(404, "Roster not found");
  if (roster.teacher_id !== user.id && user.role !== "admin") {
    throw new ApiError(403, "Not your roster");
  }
}
