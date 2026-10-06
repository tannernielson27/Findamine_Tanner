import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import {
  filterProfileForViewer,
  type ViewerRelationship,
  type VisibilityOverrides,
} from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";
import {
  PLAYABLE_HUNT_STATUSES,
  DEFAULT_TEAM_SIZE,
  activeTeamIdsInHunt,
  addMember,
  canManageHunt,
  liveTeams,
  loadHunt,
  parseTeamName,
  teamCapacity,
  teamModeOf,
  type ServiceClient,
  type TeamRow,
} from "./team-rules";

interface MemberRow {
  team_id: string;
  user_id: string;
  role: string;
  joined_at?: string;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
  profile_visibility_overrides?: VisibilityOverrides | null;
}

/**
 * Teams with their ACTIVE members. Each member's name and avatar go through
 * filterProfileForViewer for this viewer, so a hidden field arrives as null
 * and visibility settings never leave the server.
 */
async function withMembers(
  supabase: ServiceClient,
  teams: TeamRow[],
  viewerId: string,
  relationFor: (memberIds: string[]) => Promise<(id: string) => ViewerRelationship>
) {
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) return [];

  const { data: memberData, error } = await supabase
    .from("team_members")
    .select("team_id, user_id, role, joined_at")
    .eq("status", "active")
    .in("team_id", teamIds)
    .order("joined_at");
  if (error) throw new ApiError(500, "Could not load team members");
  const members = (memberData || []) as MemberRow[];

  const memberIds = [...new Set(members.map((m) => m.user_id))];
  const profiles = new Map<string, ProfileRow>();
  if (memberIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, display_name, avatar_url, profile_visibility, profile_visibility_overrides")
      .in("id", memberIds);
    for (const u of (users || []) as ProfileRow[]) profiles.set(u.id, u);
  }
  const relFor = await relationFor(memberIds);

  return teams.map((team) => {
    const teamMembers = members
      .filter((m) => m.team_id === team.id)
      .map((m) => {
        const profile = profiles.get(m.user_id);
        const shown = profile
          ? filterProfileForViewer(profile, relFor(m.user_id), {
              viewerId,
              overrides: profile.profile_visibility_overrides,
            })
          : { display_name: null, avatar_url: null };
        return { user_id: m.user_id, role: m.role, users: { id: m.user_id, ...shown } };
      });
    const maxSize = teamCapacity(team);
    return {
      ...team,
      max_size: maxSize,
      member_count: teamMembers.length,
      is_full: teamMembers.length >= maxSize,
      team_members: teamMembers,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const huntId = searchParams.get("hunt_id");
    const mine = searchParams.get("mine");

    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    if (mine === "true") {
      const { data: memberships } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("user_id", user.id)
        .eq("status", "active");
      const myTeamIds = (memberships || []).map((m) => m.team_id as string);
      if (myTeamIds.length === 0) return Response.json({ teams: [] });

      const { data: teamData } = await supabase
        .from("teams")
        .select("id, hunt_id, name, status, max_size, created_at")
        .in("id", myTeamIds)
        .neq("status", "disbanded")
        .order("created_at");
      const teamRows = (teamData || []) as TeamRow[];

      const huntIds = [...new Set(teamRows.map((t) => t.hunt_id))];
      const { data: huntData } = huntIds.length
        ? await supabase.from("hunts").select("id, title, status, play_mode, deleted_at").in("id", huntIds)
        : { data: [] };
      const hunts = new Map(
        ((huntData || []) as Array<{ id: string; title: string | null; status: string; play_mode: string; deleted_at: string | null }>)
          .filter((h) => !h.deleted_at)
          .map((h) => [h.id, h])
      );

      // The viewer's own teams: every other member is a teammate.
      const teams = await withMembers(supabase, teamRows, user.id, async () => (id) =>
        id === user.id ? "self" : "team"
      );

      return Response.json({
        teams: teams.map((t) => {
          const hunt = hunts.get(t.hunt_id);
          return {
            ...t,
            hunt: hunt
              ? {
                  id: hunt.id,
                  title: hunt.title,
                  playable: PLAYABLE_HUNT_STATUSES.includes(hunt.status),
                  team_mode: teamModeOf(hunt.play_mode),
                }
              : null,
          };
        }),
      });
    }

    if (huntId) {
      const hunt = await loadHunt(supabase, huntId);
      if (!hunt) throw new ApiError(404, "Hunt not found");

      const canManage = canManageHunt(user, hunt);
      const teamMode = teamModeOf(hunt.play_mode);
      const allTeams = await liveTeams(supabase, huntId);
      const myTeamIds = await activeTeamIdsInHunt(supabase, user.id, huntId);
      const myTeamId = myTeamIds[0] ?? null;

      // Players pick from every team only when the hunt lets them choose. On
      // teacher-formed hunts a player sees just the team they were put on.
      const visible =
        teamMode === "self_select" || canManage
          ? allTeams
          : allTeams.filter((t) => t.id === myTeamId);

      const teams = await withMembers(supabase, visible, user.id, async (memberIds) => {
        const rels = await getViewerRelationships(user.id, memberIds);
        return (id) => (id === user.id ? "self" : rels.get(id) ?? "public");
      });

      return Response.json({
        teams,
        hunt: {
          id: hunt.id,
          team_mode: teamMode,
          playable: PLAYABLE_HUNT_STATUSES.includes(hunt.status),
          max_team_size: hunt.max_team_size ?? DEFAULT_TEAM_SIZE,
        },
        viewer: { id: user.id, team_id: myTeamId, can_manage: canManage },
      });
    }

    throw new ApiError(400, "Provide hunt_id or mine=true");
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Create a team.
 * - Self-select hunts: any signed-in player; they become its captain (so they
 *   must not already be on a team for the hunt).
 * - Any other hunt: only whoever manages the hunt, and they are not added to it.
 */
export async function POST(request: NextRequest) {
  try {
    await socialLimiter.check(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json().catch(() => null);
    const huntId = body && typeof body.hunt_id === "string" ? body.hunt_id : "";
    if (!huntId) throw new ApiError(400, "hunt_id is required");
    const name = parseTeamName(body.name);

    const supabase = await createSupabaseServiceClient();

    const hunt = await loadHunt(supabase, huntId);
    if (!hunt) throw new ApiError(404, "Hunt not found");

    const selfSelect = teamModeOf(hunt.play_mode) === "self_select";
    const canManage = canManageHunt(user, hunt);
    if (!selfSelect && !canManage) {
      throw new ApiError(403, "Teams for this hunt are set up by whoever runs it.");
    }
    if (selfSelect && !PLAYABLE_HUNT_STATUSES.includes(hunt.status)) {
      throw new ApiError(409, "This hunt isn't open for teams right now.");
    }

    const existing = await liveTeams(supabase, huntId);
    if (existing.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new ApiError(409, "There's already a team with that name. Pick another.");
    }
    const teamLimitMessage = "This hunt already has the most teams it allows. Join one instead.";
    if (hunt.max_teams && existing.length >= hunt.max_teams) {
      throw new ApiError(409, teamLimitMessage);
    }
    if (selfSelect && (await activeTeamIdsInHunt(supabase, user.id, huntId)).length > 0) {
      throw new ApiError(409, "You're already on a team for this hunt. Leave it first to start a new one.");
    }

    // Players get the hunt's team size; only a manager may choose another.
    const huntSize = hunt.max_team_size && hunt.max_team_size > 0 ? hunt.max_team_size : DEFAULT_TEAM_SIZE;
    const requested = Number.parseInt(String(body.max_size), 10);
    const maxSize = canManage && Number.isFinite(requested) ? Math.max(1, Math.min(20, requested)) : huntSize;

    const { data: team, error } = await supabase
      .from("teams")
      .insert({
        hunt_id: huntId,
        name,
        status: "forming",
        max_size: maxSize,
        formation_method: selfSelect ? "self_select" : "manual",
      })
      .select("id, hunt_id, name, status, max_size")
      .single();

    if (error || !team) throw new ApiError(500, "Could not create the team. Please try again.");
    const created = team as TeamRow;

    const removeTeam = () => supabase.from("teams").delete().eq("id", created.id);

    // Another team may have been created at the same moment.
    if (hunt.max_teams && (await liveTeams(supabase, huntId)).length > hunt.max_teams) {
      await removeTeam();
      throw new ApiError(409, teamLimitMessage);
    }

    if (selfSelect) {
      try {
        await addMember(supabase, created, user.id, "captain");
      } catch (err) {
        // Never leave a team behind that its creator is not on.
        await removeTeam();
        throw err;
      }
    }

    return Response.json({ team: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
