import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const [{ data: allBadges }, { data: earned }] = await Promise.all([
      supabase
        .from("badge_types")
        .select("id, code, name, description, icon_url, category, criteria")
        .order("category", { ascending: true }),
      supabase.from("user_badges").select("badge_type_id, earned_at").eq("user_id", user.id),
    ]);

    const earnedIds = new Set((earned || []).map((e) => e.badge_type_id));
    const earnedMap = new Map((earned || []).map((e) => [e.badge_type_id, e.earned_at]));

    const badges = (allBadges || []).map((badge) => ({
      ...badge,
      earned: earnedIds.has(badge.id),
      earned_at: earnedMap.get(badge.id) || null,
      // Progress calculation would need per-badge logic; simplified here
      progress: earnedIds.has(badge.id) ? 100 : 0,
    }));

    return Response.json({
      badges,
      total: badges.length,
      earned_count: earnedIds.size,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
