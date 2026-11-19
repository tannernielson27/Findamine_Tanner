import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { internalError } from "@/lib/utils/internal-error";
import { trackEvent } from "@/lib/utils/track-event";

const ROUTE = "/api/v1/social/follows/[userId]";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE: stop following [userId].
 * DELETE ?direction=follower: remove [userId] from the people following you.
 *
 * Either way the caller is one side of the row. Removing something that is
 * not there is not an error. Open to every role, so nobody is ever stuck with
 * a follow they can't undo.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    assertTrustedOrigin(request);
    const { userId: otherId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);
    if (!UUID_RE.test(otherId)) throw new ApiError(400, "user id must be a UUID");

    const direction = new URL(request.url).searchParams.get("direction") ?? "following";
    if (direction !== "following" && direction !== "follower") {
      throw new ApiError(400, "direction must be following or follower");
    }
    const removingFollower = direction === "follower";
    const followerId = removingFollower ? otherId : user.id;
    const followeeId = removingFollower ? user.id : otherId;

    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("player_follows")
      .delete()
      .eq("follower_id", followerId)
      .eq("followee_id", followeeId)
      .select("id");
    if (error) throw internalError(ROUTE, error);

    const removed = (data || []).length > 0;
    if (removed) {
      await trackEvent({
        userId: user.id,
        eventType: "follow_removed",
        payload: { follower_id: followerId, followee_id: followeeId, removed_by: removingFollower ? "followee" : "follower" },
      });
    }
    return Response.json({ removed });
  } catch (error) {
    return errorResponse(error);
  }
}
