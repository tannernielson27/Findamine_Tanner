import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { extractThreatFeatures } from "@/lib/ml/threat-features";
import { scoreThreat } from "@/lib/ml/threat-scorer";
import {
  THREAT_EVENT_COLUMNS,
  groupThreatEvents,
  groupIpHash,
  groupUserAgent,
  toFeatureEvents,
  type ThreatEventRow,
} from "../_lib/threat-events";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const supabase = await createSupabaseServiceClient();

    // Most recent behavioral events, grouped by session below.
    const { data, error } = await supabase
      .from("behavioral_events")
      .select(THREAT_EVENT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new ApiError(500, error.message);

    const events = (data || []) as ThreatEventRow[];
    const { groups, ungrouped } = groupThreatEvents(events);

    // Score each group. ip_hash / user_agent are null unless bot-guard or a
    // failed login recorded them — they are not collected on ordinary events.
    const scored = [];
    for (const [key, sessionEvents] of groups) {
      const features = extractThreatFeatures(toFeatureEvents(sessionEvents));
      const result = scoreThreat(features);
      scored.push({
        session_id: key,
        ip_hash: groupIpHash(sessionEvents),
        user_agent: groupUserAgent(sessionEvents),
        event_count: sessionEvents.length,
        first_seen: sessionEvents[sessionEvents.length - 1]?.created_at,
        last_seen: sessionEvents[0]?.created_at,
        threat_score: result.score,
        classification: result.classification,
        top_contributors: result.top_contributors,
        features,
      });
    }

    // Sort by threat score descending, return top 50
    scored.sort((a, b) => b.threat_score - a.threat_score);

    return Response.json({
      sessions: scored.slice(0, 50),
      events_scanned: events.length,
      events_without_session: ungrouped,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
