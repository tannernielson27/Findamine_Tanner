import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { requireRosterOwner } from "../../ownership";

/**
 * Add a student to a roster, by `student_id` or by the `email` they signed up
 * with. Owning teacher (or admin) only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "admin");

    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!body.student_id && !email) throw new ApiError(400, "student_id or email required");

    const supabase = await createSupabaseServiceClient();
    await requireRosterOwner(supabase, id, user);

    let studentId: string | null = typeof body.student_id === "string" ? body.student_id : null;

    if (!studentId) {
      // Accounts store the address lowercased; fall back to the exact text typed.
      const candidates = Array.from(new Set([email.toLowerCase(), email]));
      const { data: matches } = await supabase
        .from("users")
        .select("id")
        .in("email", candidates)
        .is("deleted_at", null)
        .limit(1);

      studentId = (matches?.[0]?.id as string | undefined) ?? null;
      if (!studentId) {
        throw new ApiError(
          404,
          "No account uses that email yet. Ask the student to sign up first, or share the class code so they can join themselves."
        );
      }
    }

    const { data, error } = await supabase
      .from("roster_entries")
      .insert({ roster_id: id, student_id: studentId })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") throw new ApiError(409, "Student already in roster");
      if (error.code === "23503") throw new ApiError(404, "Student not found");
      throw new ApiError(500, error.message);
    }

    return Response.json({ entry: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Remove a student from a roster (`?student_id=`). Owning teacher (or admin) only. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "admin");

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("student_id");
    if (!studentId) throw new ApiError(400, "student_id query param required");

    const supabase = await createSupabaseServiceClient();
    await requireRosterOwner(supabase, id, user);

    const { data: removed, error } = await supabase
      .from("roster_entries")
      .delete()
      .eq("roster_id", id)
      .eq("student_id", studentId)
      .select("id");

    if (error) throw new ApiError(500, error.message);
    if (!removed || removed.length === 0) throw new ApiError(404, "That student is not in this roster");

    return Response.json({ message: "Removed from roster" });
  } catch (error) {
    return errorResponse(error);
  }
}
