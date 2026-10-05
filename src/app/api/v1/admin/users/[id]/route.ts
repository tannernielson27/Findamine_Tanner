import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("users")
      .select("id, display_name, email, role, status, avatar_url, created_at, metadata, profile_visibility")
      .eq("id", id)
      .single();

    if (error || !data) throw new ApiError(404, "User not found");

    // age_band is a user_profiles column (effective_band); selecting it from
    // `users` failed this whole query, so the route 404'd on every user.
    const { data: bandRow } = await supabase
      .from("user_profiles")
      .select("effective_band")
      .eq("user_id", id)
      .maybeSingle();

    return Response.json({ user: { ...data, age_band: bandRow?.effective_band ?? null } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    const validRoles = ["child", "teen", "adult", "parent", "teacher", "hunt_creator", "admin", "researcher"];
    const validStatuses = ["active", "inactive", "suspended", "banned", "pending_consent"];

    const updates: Record<string, unknown> = {};
    if (body.role !== undefined) {
      if (!validRoles.includes(body.role)) throw new ApiError(400, "Invalid role");
      updates.role = body.role;
    }
    if (body.status !== undefined) {
      if (!validStatuses.includes(body.status)) throw new ApiError(400, "Invalid status");
      updates.status = body.status;
    }

    if (Object.keys(updates).length === 0) throw new ApiError(400, "Provide role or status");

    // An admin who demotes or deactivates themselves locks themselves out of
    // this page with no way back; another admin has to make that change.
    if (id === user.id) {
      if (updates.role !== undefined && updates.role !== "admin") {
        throw new ApiError(400, "You can't change your own admin role. Ask another admin.");
      }
      if (updates.status !== undefined && updates.status !== "active") {
        throw new ApiError(400, "You can't deactivate your own account. Ask another admin.");
      }
    }

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id, display_name, email, role, status, avatar_url, created_at")
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, "User not found");
    return Response.json({ user: data });
  } catch (error) {
    return errorResponse(error);
  }
}
