import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";
import { stopForReviewer, type QueueFindRow } from "@/lib/hunts/reviewer-view";

const QUEUE_STATUSES = ["pending", "approved", "rejected"];

/**
 * Hunts waiting on (or past) publish review, for the admin moderation page.
 * Includes each live stop's player-visible content (clue, hints, challenge,
 * feedback, primer, place and its safety notes) so a reviewer reads the whole
 * hunt, and review_submitted_at, which the decision must echo back
 * (POST /hunts/{id}/review). Admins and researchers only.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const status = new URL(request.url).searchParams.get("status") || "pending";
    if (!QUEUE_STATUSES.includes(status)) {
      throw new ApiError(400, `Invalid status. Valid: ${QUEUE_STATUSES.join(", ")}`);
    }

    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("hunts")
      .select(
        "id, title, description, cover_image_url, theme, theme_narrative, target_audience, play_mode, grade_range_min, grade_range_max, status, review_status, review_reason, review_submitted_at, reviewed_at, created_by, creator:users!created_by(display_name, role), finds(sort_order, clue_text, clue_hints, deleted_at, tasks(title, description, content, feedback, challenge_type), primers(title, content), locations(name, description, address, safety_notes))"
      )
      .eq("review_status", status)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("review_submitted_at", { ascending: status === "pending", nullsFirst: false })
      .limit(100);

    if (error) {
      logger.error("hunt_review_queue.load_failed", { status, error: error.message });
      throw new ApiError(500, "Couldn't load the review queue. Please try again.");
    }

    const hunts = (data || []).map((hunt) => ({
      ...hunt,
      finds: ((hunt.finds || []) as unknown as QueueFindRow[])
        .filter((f) => !f.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(stopForReviewer),
    }));

    return Response.json({ hunts });
  } catch (error) {
    return errorResponse(error);
  }
}
