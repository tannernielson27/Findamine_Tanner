import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";
import { computeWeeklyProgress, streakLookbackStart } from "@/lib/gamification/weekly-stats";

/** Upper bound on completion rows read; far more than any player's three years of hunts. */
const MAX_ROWS = 2000;

/**
 * GET /api/v1/gamification/weekly → { data: WeeklyProgress }
 *
 * A completed hunt is a play_sessions row the complete route moved to
 * status 'completed' (it stamps completed_at). Weeks start Monday 00:00
 * America/Denver; see lib/gamification/weekly-stats.ts for the streak rule.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const now = new Date();
    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("play_sessions")
      .select("completed_at")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .gte("completed_at", streakLookbackStart(now))
      .order("completed_at", { ascending: false })
      .limit(MAX_ROWS);

    if (error) {
      logger.error("gamification.weekly.query_failed", { userId: user.id, error: error.message });
      throw new ApiError(500, "Couldn't load your weekly progress.");
    }

    const completedAt = ((data || []) as { completed_at: string | null }[]).map((r) => r.completed_at);
    return Response.json(
      { data: computeWeeklyProgress(completedAt, now) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
