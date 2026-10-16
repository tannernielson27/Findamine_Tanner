import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { filterProfileForViewer, type ViewerRelationship } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";
import { canManageHunt, isActiveMember, loadHunt, loadTeam, parseTeamName } from "../team-rules";
import { internalError } from "@/lib/utils/internal-error";

interface TeamMemberRow {
  user_id: string;
  status?: string;
  users?: { id: string; display_name: string | null; avatar_url: string | null; role?: string; profile_visibility?: Record<string, string> } | null;
  [k: string]: unknown;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("teams")
      .select("*, team_members(*, users(id, display_name, avatar_url, role, profile_visibility))")
      .eq("id", id)
      .single();

    if (error || !data) throw new ApiError(404, "Team not found");

    // Admins/researchers can view any team; others must be a member or
    // the creator of the hunt this team belongs to
    const isStaff = ["admin", "researcher"].includes(user.role);
    if (!isStaff) {
      // Someone who left (or was removed) is no longer a member.
      const isMember = data.team_members?.some(
        (m: { user_id: string; status?: string }) => m.user_id === user.id && m.status === "active"
      );
      if (!isMember) {
        // Check if user owns the hunt
        const { data: hunt } = await supabase
          .from("hunts")
          .select("created_by")
          .eq("id", data.hunt_id)
          .single();
        if (!hunt || hunt.created_by !== user.id) {
          throw new ApiError(403, "Not authorized to view this team");
        }
      }

      // Enforce each member's display_name/avatar visibility for this viewer
      // (a teammate who set them to "nobody" must stay hidden). Staff see raw.
      const members = ((data.team_members || []) as TeamMemberRow[]).filter(
        (m) => m.status === "active"
      );
      const rels = await getViewerRelationships(user.id, members.map((m) => m.user_id));
      data.team_members = members.map((m) => {
        const u = m.users;
        if (!u?.id) return m;
        const rel: ViewerRelationship = u.id === user.id ? "self" : rels.get(u.id) ?? "public";
        return { ...m, users: { id: u.id, role: u.role, ...filterProfileForViewer(u, rel) } };
      });
    }

    return Response.json({ team: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    const team = await loadTeam(supabase, id);
    if (!team) throw new ApiError(404, "Team not found");

    // Whoever runs the hunt may change anything. The team's current captain
    // may only rename it: status and size decide who can join, and any member
    // (even one who had left) used to be able to change them.
    const hunt = await loadHunt(supabase, team.hunt_id);
    const canManage = hunt ? canManageHunt(user, hunt) : ["admin", "researcher"].includes(user.role);
    if (!canManage) {
      if (!(await isActiveMember(supabase, id, user.id, "captain"))) {
        throw new ApiError(403, "Not authorized to update this team");
      }
      if (body.status !== undefined || body.max_size !== undefined) {
        throw new ApiError(403, "Only whoever runs the hunt can change a team's status or size");
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = parseTeamName(body.name, user.role);
    if (body.status !== undefined) {
      const validStatuses = ["forming", "ready", "active", "completed", "disbanded"];
      if (!validStatuses.includes(body.status)) throw new ApiError(400, "Invalid status");
      updates.status = body.status;
    }
    if (body.max_size !== undefined) updates.max_size = Math.max(2, Math.min(20, parseInt(body.max_size) || 6));
    if (Object.keys(updates).length === 0) throw new ApiError(400, "Nothing to update");

    const { data, error } = await supabase
      .from("teams")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw internalError("/api/v1/teams/[id]", error);

    return Response.json({ team: data });
  } catch (error) {
    return errorResponse(error);
  }
}
