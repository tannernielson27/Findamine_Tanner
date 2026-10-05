import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

/** Outcomes a reviewer can set; matches the moderation_reports.status CHECK (migration 004). */
const REVIEW_STATUSES = ["reviewed", "actioned", "dismissed"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin");

    const body = await request.json();
    const status = body.status || "reviewed";
    if (!REVIEW_STATUSES.includes(status)) {
      throw new ApiError(400, `Invalid status. Valid: ${REVIEW_STATUSES.join(", ")}`);
    }

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("moderation_reports")
      .update({
        status,
        reviewed_by: user.id,
        action_taken: body.action_taken || null,
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, "Report not found");
    return Response.json({ report: data });
  } catch (error) {
    return errorResponse(error);
  }
}
