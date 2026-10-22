import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";
import { stopForReviewer, type QueueFindRow } from "@/lib/hunts/reviewer-view";

const QUEUE_STATUSES = ["pending", "approved", "rejected"];
/** Postgres undefined_column. */
const UNDEFINED_COLUMN = "42703";
const QUEUE_COLUMNS_BEFORE_COVER = "id, title, description, ";
const QUEUE_COLUMNS_AFTER_COVER =
  "theme, theme_narrative, target_audience, play_mode, grade_range_min, grade_range_max, status, review_status, review_reason, review_submitted_at, reviewed_at, created_by, creator:users!created_by(display_name, role), finds(sort_order, clue_text, clue_hints, deleted_at, tasks(title, description, content, feedback, challenge_type), primers(title, content), locations(name, description, address, safety_notes))";

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
    const run = (columns: string) =>
      supabase
        .from("hunts")
        .select(columns)
        .eq("review_status", status)
        .neq("status", "draft")
        .is("deleted_at", null)
        .order("review_submitted_at", { ascending: status === "pending", nullsFirst: false })
        .limit(100);

    let { data, error } = await run(`${QUEUE_COLUMNS_BEFORE_COVER}cover_image_url, ${QUEUE_COLUMNS_AFTER_COVER}`);
    // hunts.cover_image_url arrives with migration 079; until it is applied,
    // retry once without it so reviewers still get their queue.
    if (error?.code === UNDEFINED_COLUMN) {
      logger.warn("hunt_review_queue.cover_column_missing", { status });
      ({ data, error } = await run(`${QUEUE_COLUMNS_BEFORE_COVER}${QUEUE_COLUMNS_AFTER_COVER}`));
    }

    if (error) {
      logger.error("hunt_review_queue.load_failed", { status, error: error.message });
      throw new ApiError(500, "Couldn't load the review queue. Please try again.");
    }

    const rows = (data || []) as unknown as Array<Record<string, unknown> & { finds?: unknown }>;
    const hunts = rows.map((hunt) => ({
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
