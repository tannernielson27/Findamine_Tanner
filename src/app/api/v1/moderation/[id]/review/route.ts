import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { MODERATOR_ROLES } from "@/lib/moderation/roles";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { logger } from "@/lib/utils/logger";

/** Outcomes a reviewer can set; matches the moderation_reports.status CHECK (migration 004). */
const REVIEW_STATUSES = ["reviewed", "actioned", "dismissed"];

/**
 * Tables "remove content" can take down. All are soft-removed
 * (moderation_status = 'removed'; kudos/shoutouts gain the column in migration
 * 072), so the record stays for appeals and audit while every read path hides it.
 */
const REMOVABLE: Record<string, string> = {
  message: "team_messages",
  wall_post: "wall_posts",
  kudos: "kudos",
  shoutout: "shoutouts",
};

/**
 * Resolve a report (platform moderators only). A moderator can't act on a
 * report they filed or one about themselves. Body:
 *   { status: "reviewed" | "actioned" | "dismissed", action_taken?, remove_content? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertTrustedOrigin(request);
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, ...MODERATOR_ROLES);

    const body = (await request.json().catch(() => null)) ?? {};
    const status = body.status || "reviewed";
    if (!REVIEW_STATUSES.includes(status)) {
      throw new ApiError(400, `Invalid status. Valid: ${REVIEW_STATUSES.join(", ")}`);
    }

    const supabase = await createSupabaseServiceClient();

    const { data: report, error: readError } = await supabase
      .from("moderation_reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (readError) {
      logger.error("moderation.review.read_failed", { reportId: id, error: readError.message });
      throw new ApiError(500, "Couldn't load that report. Please try again.");
    }
    if (!report) throw new ApiError(404, "Report not found");
    if (report.reporter_id === user.id || report.reported_user_id === user.id || (report.entity_type === "user" && report.entity_id === user.id)) {
      throw new ApiError(403, "Another moderator needs to review this report.");
    }

    // "Remove & resolve": take the reported content down before closing the report.
    let actionTaken: string | null = typeof body.action_taken === "string" ? body.action_taken.slice(0, 500) : null;
    if (body.remove_content === true) {
      if (status !== "actioned") throw new ApiError(400, "Removing content resolves the report as actioned.");
      const table = REMOVABLE[report.entity_type as string];
      if (!table) throw new ApiError(400, "This kind of report can't be removed from here.");
      const { error: removeError } = await supabase
        .from(table)
        .update({ moderation_status: "removed" })
        .eq("id", report.entity_id);
      if (removeError) {
        logger.error("moderation.review.remove_failed", { reportId: id, table, error: removeError.message });
        throw new ApiError(500, "Couldn't remove the content. Please try again.");
      }
      actionTaken = actionTaken ?? "content_removed";
    }

    const { data, error } = await supabase
      .from("moderation_reports")
      .update({
        status,
        reviewed_by: user.id,
        action_taken: actionTaken,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      logger.error("moderation.review.update_failed", { reportId: id, error: error.message });
      throw new ApiError(500, "Couldn't save the decision. Please try again.");
    }
    if (!data) throw new ApiError(404, "Report not found");
    return Response.json({ report: data });
  } catch (error) {
    return errorResponse(error);
  }
}
