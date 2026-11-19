import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { internalError } from "@/lib/utils/internal-error";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";
import { trackEvent } from "@/lib/utils/track-event";
import { getBlockSets, hiddenUserIds, isBlockedBetween, isMissingTable } from "@/lib/moderation/blocks";
import {
  canUseFollows,
  FOLLOW_BLOCKED_MESSAGE,
  FOLLOW_SELF_MESSAGE,
  FOLLOW_UNAVAILABLE_MESSAGE,
  NEW_FOLLOWER_TYPE,
} from "@/lib/social/follow-rules";
import type { FollowPerson } from "@/lib/social/follows";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const ROUTE = "/api/v1/social/follows";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EmbeddedUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
  deleted_at?: string | null;
}

/** The most rows either list returns. */
const LIST_LIMIT = 500;

interface FollowRow {
  follower_id: string;
  followee_id: string;
  created_at: string;
  follower?: EmbeddedUser | null;
  followee?: EmbeddedUser | null;
}

const EMBED = "id, display_name, avatar_url, profile_visibility, deleted_at";

/** Is the other person on this row a live account the viewer has not blocked (or been blocked by)? */
function listable(person: EmbeddedUser | null | undefined, hidden: ReadonlySet<string>): boolean {
  return !!person?.id && !person.deleted_at && !hidden.has(person.id);
}

/**
 * GET: { available, following, followers } for the viewer. Names and avatars
 * are filtered by each person's own privacy settings, so a follower who hides
 * their name is listed without one.
 * GET ?user_id=<id>: { available, following, follows_you } for one person
 * (the profile page's button).
 *
 * `available` is false for accounts that can't use follows (children, teens).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const available = canUseFollows(user.role);
    const one = new URL(request.url).searchParams.get("user_id");
    if (one !== null && !UUID_RE.test(one)) throw new ApiError(400, "user_id must be a UUID");

    if (!available) {
      return Response.json(
        one ? { available, following: false, follows_you: false } : { available, following: [], followers: [] }
      );
    }

    const supabase = await createSupabaseServiceClient();

    if (one) {
      const { data, error } = await supabase
        .from("player_follows")
        .select("follower_id, followee_id")
        .in("follower_id", [user.id, one])
        .in("followee_id", [user.id, one]);
      if (error && !isMissingTable(error)) throw internalError(ROUTE, error);
      const rows = (data || []) as FollowRow[];
      return Response.json({
        available,
        following: rows.some((r) => r.follower_id === user.id && r.followee_id === one),
        follows_you: rows.some((r) => r.follower_id === one && r.followee_id === user.id),
      });
    }

    const [mine, theirs, blocks] = await Promise.all([
      supabase
        .from("player_follows")
        .select(`follower_id, followee_id, created_at, followee:users!followee_id(${EMBED})`)
        .eq("follower_id", user.id)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
      supabase
        .from("player_follows")
        .select(`follower_id, followee_id, created_at, follower:users!follower_id(${EMBED})`)
        .eq("followee_id", user.id)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
      getBlockSets(supabase, user.id),
    ]);
    for (const res of [mine, theirs]) {
      if (res.error && !isMissingTable(res.error)) throw internalError(ROUTE, res.error);
    }

    const hidden = hiddenUserIds(blocks);
    const followingRows = ((mine.data || []) as unknown as FollowRow[]).filter((r) => listable(r.followee, hidden));
    const followerRows = ((theirs.data || []) as unknown as FollowRow[]).filter((r) => listable(r.follower, hidden));

    const rels = await getViewerRelationships(user.id, [
      ...followingRows.map((r) => r.followee_id),
      ...followerRows.map((r) => r.follower_id),
    ]);
    const present = (id: string, person: EmbeddedUser | null | undefined, createdAt: string): FollowPerson => ({
      user_id: id,
      created_at: createdAt,
      ...filterProfileForViewer(person ?? {}, rels.get(id) ?? "public"),
    });

    const followingIds = new Set(followingRows.map((r) => r.followee_id));
    return Response.json({
      available,
      following: followingRows.map((r) => present(r.followee_id, r.followee, r.created_at)),
      followers: followerRows.map((r) => ({
        ...present(r.follower_id, r.follower, r.created_at),
        you_follow: followingIds.has(r.follower_id),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Tell the followed player, once per follower: following, unfollowing and
 * following again must not be a way to fill someone's notifications. The
 * follow stands even if this fails.
 */
async function notifyNewFollower(supabase: ServiceClient, followerId: string, followeeId: string): Promise<void> {
  try {
    const { data: earlier } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", followeeId)
      .eq("type", NEW_FOLLOWER_TYPE)
      .eq("entity_id", followerId)
      .limit(1);
    if (earlier && earlier.length > 0) return;

    const { data: follower } = await supabase
      .from("users")
      .select("id, display_name, avatar_url, profile_visibility")
      .eq("id", followerId)
      .maybeSingle();
    // The follower's name, as the followed player is allowed to see it.
    const rels = await getViewerRelationships(followeeId, [followerId]);
    const shown = filterProfileForViewer((follower ?? {}) as EmbeddedUser, rels.get(followerId) ?? "public");
    const { error } = await supabase.from("notifications").insert({
      user_id: followeeId,
      type: NEW_FOLLOWER_TYPE,
      title: `${shown.display_name || "A player"} started following you`,
      body: "See who follows you, and who you follow, on your crew page.",
      entity_type: "user",
      entity_id: followerId,
    });
    if (error) console.error(`Follow stored but the notification failed: ${error.message}`);
  } catch (err) {
    console.error(`Follow stored but the notification failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

/** POST { user_id }: follow someone. No approval step. Following twice is not an error. */
export async function POST(request: NextRequest) {
  try {
    assertTrustedOrigin(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);
    if (!canUseFollows(user.role)) throw new ApiError(403, FOLLOW_UNAVAILABLE_MESSAGE);

    const body = await request.json().catch(() => null);
    const targetId: unknown = body?.user_id;
    if (typeof targetId !== "string" || !UUID_RE.test(targetId)) throw new ApiError(400, "user_id required");
    if (targetId === user.id) throw new ApiError(400, FOLLOW_SELF_MESSAGE);

    const supabase = await createSupabaseServiceClient();
    const { data: target } = await supabase
      .from("users")
      .select("id, role, deleted_at")
      .eq("id", targetId)
      .maybeSingle();
    if (!target || target.deleted_at) throw new ApiError(404, "That player couldn't be found.");
    if (!canUseFollows(target.role)) throw new ApiError(403, FOLLOW_BLOCKED_MESSAGE);
    if (await isBlockedBetween(supabase, user.id, targetId)) throw new ApiError(403, FOLLOW_BLOCKED_MESSAGE);

    const { error } = await supabase
      .from("player_follows")
      .insert({ follower_id: user.id, followee_id: targetId });
    if (error) {
      // Already following (one row per pair): the state asked for is the state there is.
      if (error.code === "23505") return Response.json({ following: true, created: false });
      // The table arrives with migration 089.
      if (isMissingTable(error)) throw new ApiError(503, "Following isn't available yet. Please try again later.");
      throw internalError(ROUTE, error);
    }

    await notifyNewFollower(supabase, user.id, targetId);
    await trackEvent({ userId: user.id, eventType: "follow_added", payload: { followee_id: targetId } });
    return Response.json({ following: true, created: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
