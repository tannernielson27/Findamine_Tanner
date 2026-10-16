import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { assertCleanText } from "@/lib/moderation/guard";
import { getBlockSets, hiddenUserIds, withoutAuthors } from "@/lib/moderation/blocks";
import { isActiveMember, loadHunt, loadTeam } from "@/app/api/v1/teams/team-rules";
import { isReviewer } from "@/lib/hunts/review";
import { logger } from "@/lib/utils/logger";

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * Who may read a team's wall: its current members, whoever runs the hunt the
 * team belongs to (the overseeing teacher), and admins/researchers.
 */
async function canReadWall(supabase: Db, teamId: string, user: { id: string; role: string }): Promise<boolean> {
  if (isReviewer(user.role)) return true;
  if (await isActiveMember(supabase, teamId, user.id)) return true;
  const team = await loadTeam(supabase, teamId);
  if (!team) return false;
  const hunt = await loadHunt(supabase, team.hunt_id);
  return !!hunt && hunt.created_by === user.id;
}

/**
 * Anonymous posts carry no author for anyone but the author and staff: the
 * user_id and the author embed are removed here, not just hidden in the UI.
 */
function anonymize<R extends Record<string, unknown>>(post: R, viewer: { id: string; role: string }): R {
  if (post.is_anonymous !== true || post.user_id === viewer.id || isReviewer(viewer.role)) return post;
  return { ...post, user_id: null, users: null };
}

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("team_id");
    if (!teamId) throw new ApiError(400, "team_id required");

    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();
    if (!(await canReadWall(supabase, teamId, user))) {
      throw new ApiError(403, "Only this team's members can see its wall.");
    }

    const { data } = await supabase
      .from("wall_posts")
      .select("*, users(id, display_name, avatar_url, profile_visibility)")
      .eq("team_id", teamId)
      .neq("moderation_status", "removed")
      .order("created_at", { ascending: false })
      .limit(50);

    // Wall is team-scoped: authors are teammates, so the viewer relationship is
    // "team" (or "self"). Honors fields set to "nobody". Anonymous posts lose
    // their author entirely (see anonymize), after block filtering used it.
    const hidden = hiddenUserIds(await getBlockSets(supabase, user.id));
    const posts = withoutAuthors(data || [], (r) => r.user_id as string, hidden).map((r) => {
      const author = r.users as EmbeddedUser | null;
      if (!author?.id) return anonymize(r, user);
      const rel = author.id === user.id ? "self" : "team";
      return anonymize({ ...r, users: { id: author.id, ...filterProfileForViewer(author, rel) } }, user);
    });

    return Response.json({ posts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);
    blockChildren(user, "wall posts");

    const body = await request.json();
    if (!body.team_id || !body.content) {
      throw new ApiError(400, "team_id and content required");
    }
    if (typeof body.content !== "string" || body.content.length > 2000) {
      throw new ApiError(400, "Content must be a string of 2000 characters or fewer");
    }
    assertCleanText(body.content, { role: user.role, label: "That post" });

    const supabase = await createSupabaseServiceClient();

    // Verify user is a current member of this team
    if (!(await isActiveMember(supabase, String(body.team_id), user.id))) {
      throw new ApiError(403, "You must be a member of this team to post");
    }

    const { data, error } = await supabase
      .from("wall_posts")
      .insert({
        team_id: body.team_id,
        user_id: user.id,
        post_type: body.post_type || "general",
        content: body.content.slice(0, 2000),
        is_anonymous: body.is_anonymous || false,
      })
      .select()
      .single();

    if (error) {
      logger.error("wall.post_failed", { error: error.message });
      throw new ApiError(500, "Your post didn't save. Please try again.");
    }

    return Response.json({ post: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
