import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { sumLedger } from "@/lib/utils/points";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const [streak, tier, points, badges, goals, hunts] = await Promise.all([
      supabase.from("streaks").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_tiers").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("points_ledger").select("amount").eq("user_id", user.id),
      supabase.from("user_badges").select("*, badge_types(*)").eq("user_id", user.id),
      supabase.from("session_goals").select("*").eq("user_id", user.id).eq("achieved", true),
      supabase
        .from("play_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "completed"),
    ]);

    return Response.json({
      streak: streak.data || { current_streak: 0, longest_streak: 0 },
      tier: tier.data || { tier: 1, total_points: 0 },
      // The one "total points" figure: the points_ledger sum, the same source
      // the peer profile uses (users/[id]/profile). The leaderboard ranks by
      // hunt score instead (finished hunts only) and labels it as such.
      total_points: sumLedger(points.data || []),
      hunts_completed: hunts.count ?? 0,
      badges_earned: (badges.data || []).length,
      badges: badges.data || [],
      goals_achieved: (goals.data || []).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
