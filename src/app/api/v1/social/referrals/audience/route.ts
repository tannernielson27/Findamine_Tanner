import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { trackEvent } from "@/lib/utils/track-event";
import { internalError } from "@/lib/utils/internal-error";
import { setCrewAudienceApproval } from "@/lib/social/crew-audience";

const ROUTE = "/api/v1/social/referrals/audience";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT { minion_id, approved }: the caller, as the recruiter, lets one member
 * of their own crew into their "My Crew" privacy audience, or takes them out
 * again. The caller is always the recruiter side of the link, so nobody can
 * approve themselves into someone else's audience. Points are unaffected.
 */
export async function PUT(request: NextRequest) {
  try {
    assertTrustedOrigin(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const minionId = body?.minion_id;
    const approved = body?.approved;
    if (typeof minionId !== "string" || !UUID_RE.test(minionId)) throw new ApiError(400, "minion_id required");
    if (typeof approved !== "boolean") throw new ApiError(400, "approved must be true or false");

    const supabase = await createSupabaseServiceClient();
    let found: boolean;
    try {
      found = await setCrewAudienceApproval(supabase, user.id, minionId, approved);
    } catch (err) {
      throw internalError(ROUTE, { message: err instanceof Error ? err.message : "update failed" });
    }
    if (!found) throw new ApiError(404, "That player isn't in your crew.");

    await trackEvent({
      userId: user.id,
      eventType: approved ? "crew_audience_approved" : "crew_audience_removed",
      payload: { minion_id: minionId },
    });
    return Response.json({ minion_id: minionId, audience_approved: approved });
  } catch (error) {
    return errorResponse(error);
  }
}
