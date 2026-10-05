import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse } from "@/lib/utils/api-auth";
import { extractThreatFeatures, type ThreatFeatures } from "@/lib/ml/threat-features";
import { computePFI } from "@/lib/ml/feature-importance";
import { fetchGroupEvents, toFeatureEvents } from "../_lib/threat-events";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const supabase = await createSupabaseServiceClient();

    // Get labeled sessions
    const { data: labels } = await supabase
      .from("threat_classifications")
      .select("session_id, attack_type")
      .not("session_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!labels || labels.length === 0) {
      const { getWeightBasedImportance } = await import("@/lib/ml/feature-importance");
      return Response.json({ importance: getWeightBasedImportance(), labeled_count: 0 });
    }

    // Fetch features for each labeled session
    const sessions: { features: ThreatFeatures; actual_label: string }[] = [];
    for (const label of labels) {
      const events = await fetchGroupEvents(supabase, label.session_id, 1000);

      if (events.length > 0) {
        sessions.push({
          features: extractThreatFeatures(toFeatureEvents(events)),
          actual_label: label.attack_type,
        });
      }
    }

    // Labels whose events can no longer be found give PFI nothing to permute;
    // fall back to the configured weights rather than an empty chart.
    if (sessions.length === 0) {
      const { getWeightBasedImportance } = await import("@/lib/ml/feature-importance");
      return Response.json({ importance: getWeightBasedImportance(), labeled_count: 0 });
    }

    const importance = computePFI(sessions);
    return Response.json({ importance, labeled_count: sessions.length });
  } catch (error) {
    return errorResponse(error);
  }
}
