import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import {
  AI_PHOTO_NOTICE_VERSION,
  getPhotoCheckChoice,
  isEligibleRole,
  isLandmarkCheckEnabled,
} from "@/lib/services/landmark-check";

const ROUTE = "/api/v1/account/ai-photo-check";

/**
 * The player's opt-in for the AI landmark check (privacy rule R1).
 * `ask` is true only when the feature is on, the player is eligible (R2) and
 * hasn't answered yet. With the feature off the table is never touched, so
 * this route is safe before migration 081 is applied.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    if (!isLandmarkCheckEnabled() || !isEligibleRole(user.role)) {
      return Response.json({ ask: false, allowed: null, notice_version: AI_PHOTO_NOTICE_VERSION });
    }
    const supabase = await createSupabaseServiceClient();
    const allowed = await getPhotoCheckChoice(supabase, user.auth_id);
    return Response.json({ ask: allowed === null, allowed, notice_version: AI_PHOTO_NOTICE_VERSION });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    if (!isLandmarkCheckEnabled() || !isEligibleRole(user.role)) {
      throw new ApiError(400, "Photo checks aren't available for this account");
    }
    const body = await request.json().catch(() => null);
    if (typeof body?.allowed !== "boolean") throw new ApiError(400, "allowed must be true or false");

    const supabase = await createSupabaseServiceClient();
    const { error } = await supabase.from("ai_photo_check_choices").upsert(
      {
        auth_id: user.auth_id,
        allowed: body.allowed,
        notice_version: AI_PHOTO_NOTICE_VERSION,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "auth_id" }
    );
    if (error) throw internalError(ROUTE, error);
    return Response.json({ ask: false, allowed: body.allowed, notice_version: AI_PHOTO_NOTICE_VERSION });
  } catch (error) {
    return errorResponse(error);
  }
}
