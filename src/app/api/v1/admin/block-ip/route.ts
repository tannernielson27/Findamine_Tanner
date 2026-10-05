import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { writeAudit } from "../_lib/audit";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const { ip_hash, reason, expires_in_days } = await request.json();
    if (typeof ip_hash !== "string" || !ip_hash.trim()) throw new ApiError(400, "ip_hash required");
    const days = expires_in_days === undefined || expires_in_days === null ? null : Number(expires_in_days);
    if (days !== null && (!Number.isFinite(days) || days <= 0)) {
      throw new ApiError(400, "expires_in_days must be a positive number");
    }

    const supabase = await createSupabaseServiceClient();

    const expiresAt = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;

    // ip_hash is UNIQUE (migration 043): a plain insert fails for an IP that was
    // blocked before (even if since unblocked). Upsert re-activates it instead.
    const { data: blocked, error } = await supabase
      .from("blocked_ips")
      .upsert(
        {
          ip_hash: ip_hash.trim(),
          reason: reason || "Manual block by admin",
          blocked_by: user.id,
          expires_at: expiresAt,
          is_active: true,
        },
        { onConflict: "ip_hash" }
      )
      .select("id")
      .single();
    if (error || !blocked) throw new ApiError(500, error?.message || "Block was not saved");

    await writeAudit(supabase, {
      user_id: user.id,
      action: "create",
      entity_type: "blocked_ip",
      entity_id: blocked.id,
      new_values: { op: "block_ip", ip_hash: ip_hash.trim(), reason: reason || null, expires_in_days: days },
    });

    return Response.json({ ok: true, id: blocked.id });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("blocked_ips")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw new ApiError(500, error.message);

    return Response.json({ blocked_ips: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const { id } = await request.json();
    if (!id) throw new ApiError(400, "id required");

    const supabase = await createSupabaseServiceClient();
    const { data: unblocked, error } = await supabase
      .from("blocked_ips")
      .update({ is_active: false })
      .eq("id", id)
      .select("id, ip_hash")
      .maybeSingle();
    if (error) throw new ApiError(500, error.message);
    if (!unblocked) throw new ApiError(404, "Blocked IP not found");

    await writeAudit(supabase, {
      user_id: user.id,
      action: "update",
      entity_type: "blocked_ip",
      entity_id: unblocked.id,
      new_values: { op: "unblock_ip", ip_hash: unblocked.ip_hash, is_active: false },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
