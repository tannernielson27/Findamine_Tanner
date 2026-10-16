import { NextRequest, after } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { authLimiter } from "@/lib/utils/rate-limit";
import { isValidTargetType, reportTargetFor, resolveReportTarget } from "@/lib/moderation/report-targets";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { blockUser } from "@/lib/moderation/blocks";
import { notifyModeratorsOfReport } from "@/lib/moderation/notify";

const REPORT_CATEGORIES = ["mean_hurtful", "inappropriate", "spam", "off_topic", "other"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres: CHECK violation / undefined column — migration 072 not applied yet. */
const PRE_072_CODES = new Set(["23514", "42703", "PGRST204"]);

/**
 * Report a problem: a player flags a chat message, kudos, wall post, shoutout,
 * user, hunt, review or find for moderator review (/admin/moderation).
 *
 * Body: { category, target_type, target_id, comment?, block? }
 *   block: true also blocks the author of the reported item.
 *
 * The reported item's author and text are snapshotted onto the report so a
 * moderator can act on it even after it changes. Reported chat messages and
 * kudos are hidden from the reporter straight away (see the chat/kudos GETs).
 */
export async function POST(request: NextRequest) {
  try {
    assertTrustedOrigin(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await authLimiter.check(request, user.id);

    const body = await request.json().catch(() => null);
    const { category, target_type, target_id, comment } = body ?? {};

    if (!REPORT_CATEGORIES.includes(category)) {
      throw new ApiError(400, `Invalid category. Valid: ${REPORT_CATEGORIES.join(", ")}`);
    }
    if (typeof target_type !== "string" || !target_type || typeof target_id !== "string" || !target_id) {
      throw new ApiError(400, "target_type and target_id required");
    }
    if (!isValidTargetType(target_type)) {
      throw new ApiError(400, "Invalid target_type");
    }
    // entity_id is a UUID column; a non-UUID would fail the insert with a 500.
    if (!UUID_RE.test(target_id)) {
      throw new ApiError(400, "target_id must be a UUID");
    }

    const supabase = await createSupabaseServiceClient();
    const target = reportTargetFor(target_type);
    const resolved = await resolveReportTarget(supabase, target, target_id);
    if (!resolved.found) throw new ApiError(404, "We couldn't find what you're reporting. It may already be gone.");
    if (resolved.reportedUserId === user.id) throw new ApiError(400, "You can't report your own content.");

    const note = typeof comment === "string" ? comment.trim() : "";
    const typeTag = target.stored === target_type ? "" : `[${target_type.slice(0, 40)}]`;
    const details = [typeTag, note].filter(Boolean).join(" ").slice(0, 1000) || null;

    const row = {
      reporter_id: user.id,
      entity_type: target.stored,
      entity_id: target_id,
      reason: category,
      details,
      status: "pending",
      reported_user_id: resolved.reportedUserId,
      content_snapshot: resolved.snapshot,
    };

    let { error } = await supabase.from("moderation_reports").insert(row);
    if (error && error.code && PRE_072_CODES.has(error.code)) {
      // Pre-072 schema: old entity_type CHECK, no snapshot columns. Keep the
      // report, folding the extra context into details.
      const legacyDetails =
        [
          target.legacy === target_type ? "" : `[${target_type.slice(0, 40)}]`,
          resolved.reportedUserId ? `author=${resolved.reportedUserId}` : "",
          resolved.snapshot ? `"${resolved.snapshot.slice(0, 500)}"` : "",
          note,
        ]
          .filter(Boolean)
          .join(" ")
          .slice(0, 1000) || null;
      ({ error } = await supabase.from("moderation_reports").insert({
        reporter_id: user.id,
        entity_type: target.legacy,
        entity_id: target_id,
        reason: category,
        details: legacyDetails,
        status: "pending",
      }));
    }
    if (error) {
      console.error("Failed to store moderation report:", error.message);
      throw new ApiError(500, "Could not save your report. Please try again.");
    }

    after(() => notifyModeratorsOfReport(supabase, { category, targetType: target_type }));

    let blocked = false;
    if (body?.block === true && resolved.reportedUserId) {
      await blockUser(supabase, user.id, resolved.reportedUserId);
      blocked = true;
    }

    return Response.json({
      reported: true,
      blocked,
      message: blocked
        ? "Thanks for reporting. We'll review it, and you won't see this player anymore."
        : "Thanks for reporting. A moderator will review this.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
