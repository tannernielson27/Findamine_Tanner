import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { requireRosterOwner } from "../ownership";

/** One roster with its members. Owning teacher (or admin) only. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "admin");

    const supabase = await createSupabaseServiceClient();
    await requireRosterOwner(supabase, id, user);

    // Same member fields as the roster list route — deliberately no email.
    const { data: roster, error } = await supabase
      .from("rosters")
      .select("*, roster_entries(*, users:student_id(id, display_name, avatar_url, role))")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !roster) throw new ApiError(404, "Roster not found");

    return Response.json({ roster });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Soft-delete a roster. Owning teacher (or admin) only. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "admin");

    const supabase = await createSupabaseServiceClient();
    await requireRosterOwner(supabase, id, user);

    // Retire the join code with the roster so the code can no longer enroll anyone.
    const { error } = await supabase
      .from("rosters")
      .update({ deleted_at: new Date().toISOString(), join_code: null })
      .eq("id", id);

    if (error) throw new ApiError(500, error.message);

    return Response.json({ message: "Roster deleted" });
  } catch (error) {
    return errorResponse(error);
  }
}
