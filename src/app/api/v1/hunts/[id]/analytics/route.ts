import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";

const MIN_PLAYS_FOR_PUBLIC = 5;

interface StopAnalytics {
  find_id: string;
  /** 1-based position in the hunt's current stop order. */
  stop_number: number;
  name: string | null;
  /** null when no completed session has reached this stop yet. */
  avg_score: number | null;
  avg_hints: number | null;
  completion_count: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await generalLimiter.check(request);
    const { id } = await params;

    // Validate UUID format
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new ApiError(400, "Invalid hunt ID");
    }

    const user = await getAuthUser(request);
    const supabase = await createSupabaseServiceClient();

    // Get hunt info
    const { data: hunt } = await supabase
      .from("hunts")
      .select("id, title, created_by, status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found");

    const isOwner = user && (hunt.created_by === user.id || ["admin", "researcher"].includes(user.role));

    // Get all completed play sessions for this hunt
    const { data: sessions } = await supabase
      .from("play_sessions")
      .select("id, total_score, status, started_at, completed_at")
      .eq("hunt_id", id)
      .eq("status", "completed");

    const totalPlays = sessions?.length || 0;

    // Privacy: only show analytics if enough plays or user is owner
    if (totalPlays < MIN_PLAYS_FOR_PUBLIC && !isOwner) {
      return Response.json({
        hunt_id: id,
        total_plays: totalPlays,
        analytics_available: false,
        message: `Analytics available after ${MIN_PLAYS_FOR_PUBLIC} completions (currently ${totalPlays})`,
      });
    }

    // Calculate hunt-level metrics
    const scores = (sessions || []).map((s) => s.total_score || 0);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const durations = (sessions || [])
      .filter((s) => s.started_at && s.completed_at)
      .map((s) => (new Date(s.completed_at!).getTime() - new Date(s.started_at!).getTime()) / 60000);
    const avgDurationMin = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    // Get all sessions (including incomplete) to calculate completion rate
    const { count: allSessions } = await supabase
      .from("play_sessions")
      .select("id", { count: "exact", head: true })
      .eq("hunt_id", id);

    const completionRate = allSessions ? Math.round((totalPlays / allSessions) * 100) : 0;

    // Get stop-level analytics. Stops are listed in hunt order (one entry per
    // live stop, played or not) so "Stop N" here is the same stop N the
    // creator sees in the editor and players see in the hunt.
    const { data: finds } = await supabase
      .from("finds")
      .select("id, sort_order, locations(name)")
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    const sessionIds = (sessions || []).map((s) => s.id);
    const findMap = new Map<string, { scores: number[]; hints: number[]; completed: number }>();

    if (sessionIds.length > 0) {
      const { data: completions } = await supabase
        .from("find_completions")
        .select("find_id, score, hints_used, clue_hints_used, challenge_hints_used, completed_at")
        .in("play_session_id", sessionIds);

      // Aggregate per find
      for (const c of completions || []) {
        if (!findMap.has(c.find_id)) findMap.set(c.find_id, { scores: [], hints: [], completed: 0 });
        const entry = findMap.get(c.find_id)!;
        entry.scores.push(c.score || 0);
        entry.hints.push((c.hints_used || 0) + (c.clue_hints_used || 0) + (c.challenge_hints_used || 0));
        if (c.completed_at) entry.completed++;
      }
    }

    const stopAnalytics: StopAnalytics[] = (finds || []).map((find, index) => {
      const played = findMap.get(find.id);
      const location = find.locations as { name?: string } | { name?: string }[] | null;
      const name = (Array.isArray(location) ? location[0]?.name : location?.name) || null;
      return {
        find_id: find.id,
        stop_number: index + 1,
        // Stop names give away where the stops are; only the creator sees them.
        name: isOwner ? name : null,
        avg_score: played ? Math.round(played.scores.reduce((a, b) => a + b, 0) / played.scores.length) : null,
        avg_hints: played ? Math.round((played.hints.reduce((a, b) => a + b, 0) / played.hints.length) * 10) / 10 : null,
        completion_count: played ? played.completed : 0,
      };
    });

    // Find hardest and easiest stops (among stops someone has actually played)
    const sortedStops = stopAnalytics
      .filter((s): s is StopAnalytics & { avg_score: number } => s.avg_score !== null)
      .sort((a, b) => a.avg_score - b.avg_score);
    const hardestStop = sortedStops[0] || null;
    const easiestStop = sortedStops[sortedStops.length - 1] || null;

    return Response.json({
      hunt_id: id,
      analytics_available: true,
      total_plays: totalPlays,
      avg_score: avgScore,
      completion_rate: completionRate,
      avg_duration_min: avgDurationMin,
      hardest_stop: hardestStop,
      easiest_stop: easiestStop,
      stops: stopAnalytics,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export const maxDuration = 60;
