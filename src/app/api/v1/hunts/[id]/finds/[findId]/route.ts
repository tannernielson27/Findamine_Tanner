import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { parseFindFields } from "../../../find-fields";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findId: string }> }
) {
  try {
    const { id, findId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Verify hunt ownership
    const { data: hunt } = await supabase
      .from("hunts")
      .select("created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only edit finds in your own hunts");
    }

    const updates = parseFindFields(body);
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "No editable fields provided");
    }

    const { data: find, error } = await supabase
      .from("finds")
      .update(updates)
      .eq("id", findId)
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .select("*, locations(*), tasks(*), primers(*)")
      .maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!find) throw new ApiError(404, "Stop not found in this hunt");

    return Response.json({ find });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findId: string }> }
) {
  try {
    const { id, findId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const supabase = await createSupabaseServiceClient();

    // Verify hunt ownership
    const { data: hunt } = await supabase
      .from("hunts")
      .select("created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only delete finds in your own hunts");
    }

    const { data: removed, error } = await supabase
      .from("finds")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", findId)
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .select("id");

    if (error) throw new ApiError(500, error.message);
    if (!removed || removed.length === 0) throw new ApiError(404, "Stop not found in this hunt");

    return Response.json({ message: "Find deleted" });
  } catch (error) {
    return errorResponse(error);
  }
}
