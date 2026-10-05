import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { trackEvent } from "@/lib/utils/track-event";
import { evaluateBadges, updateStreak } from "@/lib/services/gamification";
import { logger } from "@/lib/utils/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data: updated, error } = await supabase
      .from("play_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .select("*, find_completions(*)");

    if (error) throw new ApiError(500, error.message);

    const session = updated?.[0];

    if (!session) {
      // No active session: a repeat call (double tap, reload) after the hunt
      // was already finished. Return the finished session instead of failing.
      const { data: finished } = await supabase
        .from("play_sessions")
        .select("*, find_completions(*)")
        .eq("hunt_id", huntId)
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1);

      if (!finished?.[0]) throw new ApiError(404, "No active play session");
      return Response.json({ session: finished[0], already_completed: true, badges_earned: [] });
    }

    trackEvent({ userId: user.id, eventType: "play_complete", payload: { hunt_id: huntId } });

    // Badges and the daily streak. These must never fail the completion.
    let badgesEarned: string[] = [];
    try {
      const streak = await updateStreak(user.id);
      const huntBadges = await evaluateBadges(user.id, "hunt_complete");
      badgesEarned = [...streak.badgesEarned, ...huntBadges];
    } catch (gamificationError) {
      logger.error("play.complete.gamification_error", {
        userId: user.id,
        huntId,
        error: gamificationError instanceof Error ? gamificationError.message : String(gamificationError),
      });
    }

    return Response.json({ session, badges_earned: badgesEarned });
  } catch (error) {
    return errorResponse(error);
  }
}
