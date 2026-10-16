import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { internalError } from "@/lib/utils/internal-error";

// Batch insert behavioral events (L1)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await generalLimiter.check(request, user.id);

    const body = await request.json();
    const events = body.events;

    if (!Array.isArray(events) || events.length === 0) {
      throw new ApiError(400, "events array required");
    }
    if (events.length > 50) {
      throw new ApiError(400, "Max 50 events per batch");
    }

    const supabase = await createSupabaseServiceClient();

    const rows = events.map((e: Record<string, unknown>) => ({
      user_id: user.id,
      session_id: e.session_id || null,
      event_type: e.event_type,
      event_name: e.event_name || null,
      payload: e.payload || {},
      platform: e.platform || null,
      app_version: e.app_version || null,
    }));

    const { error } = await supabase.from("behavioral_events").insert(rows);

    if (error) throw internalError("/api/v1/events/batch", error);

    return Response.json({ inserted: rows.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
