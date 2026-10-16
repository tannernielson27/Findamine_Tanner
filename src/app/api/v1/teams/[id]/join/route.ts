import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import {
  JOINABLE_TEAM_STATUSES,
  PLAYABLE_HUNT_STATUSES,
  activeMemberCount,
  activeTeamIdsInHunt,
  addMember,
  loadAccessibleHunt,
  loadTeam,
  teamCapacity,
  teamModeOf,
} from "../../team-rules";

/** Join a team yourself. Only hunts where players choose their own team allow it. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);

    const supabase = await createSupabaseServiceClient();

    const team = await loadTeam(supabase, id);
    if (!team) throw new ApiError(404, "Team not found");

    const hunt = await loadAccessibleHunt(supabase, team.hunt_id, user);
    if (!hunt) throw new ApiError(404, "Team not found");
    if (teamModeOf(hunt.play_mode) !== "self_select") {
      throw new ApiError(403, "Teams for this hunt are assigned by your teacher. You can't join one yourself.");
    }
    if (!PLAYABLE_HUNT_STATUSES.includes(hunt.status)) {
      throw new ApiError(409, "This hunt isn't open for teams right now.");
    }
    if (!JOINABLE_TEAM_STATUSES.includes(team.status)) {
      throw new ApiError(409, "This team is no longer taking members.");
    }

    // Friendly answers for the common cases; addMember re-checks all of them
    // after the insert, which is what makes them hold under concurrent joins.
    const mine = await activeTeamIdsInHunt(supabase, user.id, team.hunt_id);
    if (mine.includes(team.id)) throw new ApiError(409, "You're already on this team.");
    if (mine.length > 0) {
      throw new ApiError(409, "You're already on a team for this hunt. Leave it first to switch.");
    }
    if ((await activeMemberCount(supabase, team.id)) >= teamCapacity(team)) {
      throw new ApiError(409, "This team is full.");
    }

    const member = await addMember(supabase, team, user.id, "member");

    return Response.json({ member: { ...member, team_id: team.id, role: "member" } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
