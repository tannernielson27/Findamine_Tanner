import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { authLimiter } from "@/lib/utils/rate-limit";

const REPORT_CATEGORIES = ["mean_hurtful", "inappropriate", "spam", "off_topic", "other"];

/**
 * moderation_reports.entity_type is CHECK-constrained (migration 004) to
 * message | wall_post | content | user | shoutout. Anything else a client
 * reports (the play page sends "find") is stored as "content", with the
 * original type kept in `details` so a reviewer can still see what it was.
 */
const ENTITY_TYPES = ["message", "wall_post", "content", "user", "shoutout"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Report a problem — user flags content or behavior for teacher review.
 */
export async function POST(request: NextRequest) {
  try {
    await authLimiter.check(request); // Strict limit to prevent spam
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const { category, target_type, target_id, comment } = body;

    if (!REPORT_CATEGORIES.includes(category)) {
      throw new ApiError(400, `Invalid category. Valid: ${REPORT_CATEGORIES.join(", ")}`);
    }
    if (typeof target_type !== "string" || !target_type || typeof target_id !== "string" || !target_id) {
      throw new ApiError(400, "target_type and target_id required");
    }
    // entity_id is a UUID column; a non-UUID would fail the insert with a 500.
    if (!UUID_RE.test(target_id)) {
      throw new ApiError(400, "target_id must be a UUID");
    }

    const entityType = ENTITY_TYPES.includes(target_type) ? target_type : "content";
    const note = typeof comment === "string" ? comment.trim() : "";
    const details =
      [entityType === target_type ? "" : `[${target_type.slice(0, 40)}]`, note]
        .filter(Boolean)
        .join(" ")
        .slice(0, 1000) || null;

    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase.from("moderation_reports").insert({
      reporter_id: user.id,
      entity_type: entityType,
      entity_id: target_id,
      reason: category,
      details,
      status: "pending",
    });
    if (error) {
      console.error("Failed to store moderation report:", error.message);
      throw new ApiError(500, "Could not save your report. Please try again.");
    }

    return Response.json({ reported: true, message: "Thank you for reporting. A teacher will review this." });
  } catch (error) {
    return errorResponse(error);
  }
}
