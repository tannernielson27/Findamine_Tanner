import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { extractThreatFeatures } from "@/lib/ml/threat-features";
import { scoreThreat, computeShapContributions } from "@/lib/ml/threat-scorer";
import { fetchGroupEvents, toFeatureEvents } from "../_lib/threat-events";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const sessionId = new URL(request.url).searchParams.get("session_id");
    if (!sessionId) throw new ApiError(400, "session_id required");

    const supabase = await createSupabaseServiceClient();

    // session_id is the key threat-sessions returned for this group.
    const events = await fetchGroupEvents(supabase, sessionId, 5000);

    const features = extractThreatFeatures(toFeatureEvents(events));
    const { score, classification } = scoreThreat(features);
    const contributions = computeShapContributions(features);

    return Response.json({
      session_id: sessionId,
      event_count: events.length,
      score,
      classification,
      features,
      contributions,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
