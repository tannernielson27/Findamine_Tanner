import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { internalError } from "@/lib/utils/internal-error";
import { toEventRow } from "@/lib/telemetry/event-row";
import { getIsActiveParticipant } from "@/lib/services/participant-conditions";

// Batch insert behavioral events (L1): client telemetry (screen views, app
// state, client errors) from lib/telemetry/client-events.ts.
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

    const rows = events.map((e: unknown) => toEventRow(user.id, e));
    if (rows.some((r) => r === null)) {
      throw new ApiError(400, "each event needs a client event_type and a payload under 4 KB");
    }

    // Telemetry is study data: only active, consented participants are logged.
    // Anyone else (minors, staff, decliners, withdrawn) is accepted and dropped.
    const { data: me } = await supabase.from("users").select("metadata").eq("id", user.id).maybeSingle();
    const participant = await getIsActiveParticipant(
      user.id,
      (me?.metadata ?? null) as Record<string, unknown> | null,
      supabase
    ).catch(() => false);
    if (!participant) return Response.json({ inserted: 0 }, { status: 202 });

    const { error } = await supabase.from("behavioral_events").insert(rows);

    if (error) throw internalError("/api/v1/events/batch", error);

    return Response.json({ inserted: rows.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
