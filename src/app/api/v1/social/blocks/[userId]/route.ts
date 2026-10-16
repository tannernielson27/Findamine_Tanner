import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE: unblock. Only the blocker's own row is touched; a friendship is not restored. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    assertTrustedOrigin(request);
    const { userId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);
    if (!UUID_RE.test(userId)) throw new ApiError(400, "userId must be a UUID");

    const supabase = await createSupabaseServiceClient();
    const { error } = await supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id", user.id)
      .eq("blocked_id", userId);
    if (error) throw new ApiError(500, "Couldn't unblock right now. Please try again.");

    return Response.json({ blocked: false });
  } catch (error) {
    return errorResponse(error);
  }
}
