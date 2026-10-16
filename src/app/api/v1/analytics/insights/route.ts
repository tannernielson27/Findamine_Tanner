import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";

/**
 * Cross-hunt insights for hunt creators.
 * Returns aggregated, anonymized metrics across all published hunts.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");
    await generalLimiter.check(request, user.id);

    const supabase = await createSupabaseServiceClient();

    // All aggregation via PostgreSQL RPC functions (scales to millions)
    const [huntInsights, challengeTypes, totalCount] = await Promise.all([
      supabase.rpc("get_hunt_insights", { p_limit: 10 }),
      supabase.rpc("get_challenge_type_effectiveness"),
      supabase.from("play_sessions").select("id", { count: "exact", head: true }).eq("status", "completed"),
    ]);

    const insights = huntInsights.data || [];

    // Top by score and top by plays are from the same RPC, just sorted differently
    const topByScore = [...insights].sort((a, b) => (b.avg_score || 0) - (a.avg_score || 0)).slice(0, 10);
    const topByPlays = [...insights].sort((a, b) => (b.plays || 0) - (a.plays || 0)).slice(0, 10);

    // Audience insights from hunt insights
    const audienceMap = new Map<string, { plays: number; totalScore: number; count: number }>();
    for (const h of insights) {
      const aud = h.target_audience || "all";
      if (!audienceMap.has(aud)) audienceMap.set(aud, { plays: 0, totalScore: 0, count: 0 });
      const a = audienceMap.get(aud)!;
      a.plays += Number(h.plays) || 0;
      a.totalScore += (Number(h.avg_score) || 0) * (Number(h.plays) || 0);
      a.count += Number(h.plays) || 0;
    }

    const audienceInsights = Array.from(audienceMap.entries())
      .filter(([, a]) => a.count >= 3)
      .map(([audience, a]) => ({
        audience,
        total_plays: a.plays,
        avg_score: a.count > 0 ? Math.round(a.totalScore / a.count) : 0,
      }));

    return Response.json({
      top_by_score: topByScore.map((h) => ({
        hunt_id: h.hunt_id, title: h.title, audience: h.target_audience,
        plays: Number(h.plays), avg_score: Number(h.avg_score),
      })),
      top_by_plays: topByPlays.map((h) => ({
        hunt_id: h.hunt_id, title: h.title, audience: h.target_audience,
        plays: Number(h.plays), avg_score: Number(h.avg_score),
      })),
      challenge_type_insights: (challengeTypes.data || []).map((ct: { challenge_type: string; avg_score: number; sample_size: number }) => ({
        challenge_type: ct.challenge_type,
        avg_score: Number(ct.avg_score),
        sample_size: Number(ct.sample_size),
      })),
      audience_insights: audienceInsights,
      total_hunts_with_data: insights.length,
      total_completions: totalCount.count || 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export const maxDuration = 60;
