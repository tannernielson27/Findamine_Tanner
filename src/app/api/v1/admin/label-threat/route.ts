import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { writeAudit } from "../_lib/audit";

const VALID_TYPES = ["safe", "scanner", "scraper", "credential_stuffing", "injection", "ddos", "other"];

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const body = await request.json();
    const { session_id, ip_hash, attack_type, severity, notes } = body;

    if (!session_id && !ip_hash) throw new ApiError(400, "session_id or ip_hash required");
    if (!VALID_TYPES.includes(attack_type)) throw new ApiError(400, `Invalid attack_type. Must be: ${VALID_TYPES.join(", ")}`);

    const supabase = await createSupabaseServiceClient();

    // Check for existing label (for relabel tracking)
    let previousLabel: string | null = null;
    if (session_id) {
      const { data: existing } = await supabase
        .from("threat_classifications")
        .select("attack_type")
        .eq("session_id", session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      previousLabel = existing?.attack_type || null;
    }

    // Insert classification
    const { data: label, error: labelError } = await supabase
      .from("threat_classifications")
      .insert({
        session_id,
        ip_hash,
        attack_type,
        severity: severity || "low",
        notes,
        labeled_by: user.id,
      })
      .select("id")
      .single();
    if (labelError || !label) throw new ApiError(500, labelError?.message || "Label was not saved");

    // Track relabels
    if (previousLabel && previousLabel !== attack_type) {
      const { error: historyError } = await supabase.from("threat_label_history").insert({
        session_id,
        previous_label: previousLabel,
        new_label: attack_type,
        relabeled_by: user.id,
        reason: notes,
      });
      if (historyError) console.error("threat_label_history write failed:", historyError.message);
    }

    // Audit log
    await writeAudit(supabase, {
      user_id: user.id,
      action: "create",
      entity_type: "threat_classification",
      entity_id: label.id,
      new_values: {
        op: previousLabel ? "relabel_threat" : "label_threat",
        session_id: session_id || null,
        ip_hash: ip_hash || null,
        attack_type,
        severity: severity || "low",
        notes: notes || null,
      },
      old_values: previousLabel ? { attack_type: previousLabel } : null,
    });

    return Response.json({
      ok: true,
      relabeled: !!previousLabel && previousLabel !== attack_type,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
