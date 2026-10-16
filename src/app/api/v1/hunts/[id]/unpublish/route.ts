import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { publishLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { logger } from "@/lib/utils/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertTrustedOrigin(request);
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");
    await publishLimiter.check(request, user.id);

    const supabase = await createSupabaseServiceClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from("hunts")
      .select("created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!existing) throw new ApiError(404, "Hunt not found");
    if (existing.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only unpublish your own hunts");
    }

    const { data: hunt, error } = await supabase
      .from("hunts")
      // Back to a draft leaves the review queue too; publishing again resubmits it.
      .update({
        status: "draft",
        is_public: false,
        review_status: "not_submitted",
        review_submitted_at: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      logger.error("hunt.unpublish.update_failed", { huntId: id, error: error.message });
      throw new ApiError(500, "Couldn't unpublish this hunt. Please try again.");
    }

    return Response.json({ hunt });
  } catch (error) {
    return errorResponse(error);
  }
}
