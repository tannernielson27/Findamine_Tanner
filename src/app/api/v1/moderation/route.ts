import { NextRequest, after } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { notifyModeratorsOfReport } from "@/lib/moderation/notify";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { MODERATOR_ROLES } from "@/lib/moderation/roles";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { logger } from "@/lib/utils/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DETAILS = 1000;

const STORED_ENTITY_TYPE: Record<string, string> = {
  team_message: "message",
  hunt: "content",
  review: "content",
};

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    // Reports carry snapshots of private chat and kudos: platform moderators only.
    requireRole(user, ...MODERATOR_ROLES);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";

    const supabase = await createSupabaseServiceClient();

    const query = (select: string) =>
      supabase.from("moderation_reports").select(select).eq("status", status).order("created_at");

    // reported_user_id arrives with migration 072; fall back to the old shape
    // if it hasn't been applied yet.
    let { data, error } = await query(
      "*, reporter:users!reporter_id(id, display_name), reported_user:users!reported_user_id(id, display_name, role)"
    );
    if (error) ({ data, error } = await query("*, reporter:users!reporter_id(id, display_name)"));

    if (error) {
      logger.error("moderation.list_failed", { error: error.message });
      throw new ApiError(500, "Couldn't load reports. Please try again.");
    }
    return Response.json({ reports: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertTrustedOrigin(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);

    const body = await request.json();
    if (!body.entity_type || !body.entity_id || !body.reason) {
      throw new ApiError(400, "entity_type, entity_id, and reason required");
    }

    const VALID_ENTITY_TYPES = ["wall_post", "team_message", "hunt", "user", "review"];
    const VALID_REASONS = ["inappropriate", "spam", "harassment", "cheating", "privacy_violation", "other"];
    if (!VALID_ENTITY_TYPES.includes(body.entity_type)) {
      throw new ApiError(400, `Invalid entity_type. Valid: ${VALID_ENTITY_TYPES.join(", ")}`);
    }
    if (!VALID_REASONS.includes(body.reason)) {
      throw new ApiError(400, `Invalid reason. Valid: ${VALID_REASONS.join(", ")}`);
    }
    if (typeof body.entity_id !== "string" || !UUID_RE.test(body.entity_id)) {
      throw new ApiError(400, "entity_id must be a UUID");
    }
    const note = typeof body.details === "string" ? body.details.trim().slice(0, MAX_DETAILS) : "";

    const supabase = await createSupabaseServiceClient();

    // The entity_type CHECK (migration 004) has no team_message/hunt/review;
    // store those under the nearest allowed value and keep the original in details.
    const stored = STORED_ENTITY_TYPE[body.entity_type as string] ?? body.entity_type;
    const details =
      [stored === body.entity_type ? "" : `[${body.entity_type}]`, note]
        .filter(Boolean)
        .join(" ") || null;

    const { data, error } = await supabase
      .from("moderation_reports")
      .insert({
        reporter_id: user.id,
        entity_type: stored,
        entity_id: body.entity_id,
        reason: body.reason,
        details,
      })
      .select()
      .single();

    if (error) {
      logger.error("moderation.report_failed", { error: error.message });
      throw new ApiError(500, "Could not save your report. Please try again.");
    }
    after(() =>
      notifyModeratorsOfReport(supabase, { category: body.reason, targetType: body.entity_type })
    );
    return Response.json({ report: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
