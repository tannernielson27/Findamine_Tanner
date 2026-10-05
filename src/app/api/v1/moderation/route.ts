import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";

const STORED_ENTITY_TYPE: Record<string, string> = {
  team_message: "message",
  hunt: "content",
  review: "content",
};

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin");

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("moderation_reports")
      .select("*, reporter:users!reporter_id(id, display_name)")
      .eq("status", status)
      .order("created_at");

    if (error) throw new ApiError(500, error.message);
    return Response.json({ reports: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await socialLimiter.check(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

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

    const supabase = await createSupabaseServiceClient();

    // The entity_type CHECK (migration 004) has no team_message/hunt/review;
    // store those under the nearest allowed value and keep the original in details.
    const stored = STORED_ENTITY_TYPE[body.entity_type as string] ?? body.entity_type;
    const details =
      [stored === body.entity_type ? "" : `[${body.entity_type}]`, body.details || ""]
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

    if (error) throw new ApiError(500, error.message);
    return Response.json({ report: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
