import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { activeMemberCount, loadHunt, loadTeam, teamModeOf } from "../../team-rules";

/**
 * Leave a team you joined. Teacher-formed teams cannot be left by the player.
 * The last member leaving disbands the team; a leaving captain hands the role
 * to the longest-standing remaining member.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await socialLimiter.check(request);
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const team = await loadTeam(supabase, id);
    if (!team) throw new ApiError(404, "Team not found");

    const hunt = await loadHunt(supabase, team.hunt_id);
    if (hunt && teamModeOf(hunt.play_mode) === "assigned") {
      throw new ApiError(403, "Your teacher set the teams for this hunt. Ask them if you need to change teams.");
    }

    // A game in progress that is scored for this team keeps the player on it.
    const { data: sessions } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", team.hunt_id)
      .eq("user_id", user.id)
      .eq("team_id", team.id)
      .eq("status", "active")
      .limit(1);
    if (sessions && sessions.length > 0) {
      throw new ApiError(409, "You're in the middle of this hunt with this team. Finish it before leaving.");
    }

    const { data: left, error } = await supabase
      .from("team_members")
      .update({ status: "left" })
      .eq("team_id", id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .select("id, role");

    if (error) throw new ApiError(500, "Could not leave the team. Please try again.");
    if (!left || left.length === 0) throw new ApiError(404, "You're not on this team.");

    const { data: remaining } = await supabase
      .from("team_members")
      .select("id, role, joined_at")
      .eq("team_id", id)
      .eq("status", "active")
      .order("joined_at");
    const others = remaining || [];

    let disbanded = false;
    if (others.length === 0) {
      await supabase.from("teams").update({ status: "disbanded" }).eq("id", id);
      disbanded = true;
      // Someone may have joined in the same instant: keep their team alive.
      if ((await activeMemberCount(supabase, id)) > 0) {
        await supabase.from("teams").update({ status: team.status }).eq("id", id);
        disbanded = false;
      }
    } else if (
      left.some((m) => m.role === "captain") &&
      !others.some((m) => m.role === "captain")
    ) {
      await supabase.from("team_members").update({ role: "captain" }).eq("id", others[0].id);
    }

    return Response.json({ message: "Left team", disbanded });
  } catch (error) {
    return errorResponse(error);
  }
}
