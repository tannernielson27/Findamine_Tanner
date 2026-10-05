import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { fetchAllRows, fetchAllByIds } from "@/lib/utils/paginate";

interface EnrollmentRow {
  id: string;
  user_id: string;
  [column: string]: unknown;
}

interface AssignmentRow {
  id: string;
  user_id: string;
  dimension_id: string;
  level: string;
  [column: string]: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const { searchParams } = new URL(request.url);
    const mine = searchParams.get("mine");

    const supabase = await createSupabaseServiceClient();

    if (mine === "true") {
      if (!user) throw new ApiError(401, "Not authenticated");
      const { data } = await supabase
        .from("dimension_assignments")
        .select("*, treatment_dimensions(name, levels)")
        .eq("user_id", user.id);
      return Response.json({ assignments: data || [] });
    }

    requireRole(user, "admin", "researcher");

    const studyId = searchParams.get("study_id");
    if (!studyId) throw new ApiError(400, "study_id required");

    // study_enrollments has no foreign key to dimension_assignments (both hang
    // off users), so PostgREST cannot embed one in the other: the old embedded
    // select failed and this route always returned []. Read them separately
    // and join on user_id.
    const enrollments = await fetchAllRows<EnrollmentRow>((from, to) =>
      supabase
        .from("study_enrollments")
        .select("*, users(id, display_name, role)")
        .eq("study_id", studyId)
        .is("withdrawn_at", null)
        .order("id", { ascending: true })
        .range(from, to)
    );

    const { data: studyDims, error: dimsError } = await supabase
      .from("treatment_study_dimensions")
      .select("dimension_id")
      .eq("study_id", studyId);
    if (dimsError) throw new ApiError(500, dimsError.message);
    const dimensionIds = (studyDims || []).map((d) => d.dimension_id as string);

    const assignments =
      dimensionIds.length === 0
        ? []
        : await fetchAllByIds<AssignmentRow>(
            enrollments.map((e) => e.user_id),
            (ids, from, to) =>
              supabase
                .from("dimension_assignments")
                .select("*, treatment_dimensions(name)")
                .in("user_id", ids)
                .in("dimension_id", dimensionIds)
                .order("id", { ascending: true })
                .range(from, to)
          );

    const byUser = new Map<string, AssignmentRow[]>();
    for (const a of assignments) {
      byUser.set(a.user_id, [...(byUser.get(a.user_id) || []), a]);
    }

    const participants = enrollments.map((e) => ({
      ...e,
      dimension_assignments: byUser.get(e.user_id) || [],
    }));

    return Response.json({ participants });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Enroll user in study
    if (body.study_id && body.user_id) {
      const { data, error } = await supabase
        .from("study_enrollments")
        .insert({ study_id: body.study_id, user_id: body.user_id })
        .select()
        .single();

      if (error) throw new ApiError(500, error.message);

      // Atomically increment sample size
      await supabase.rpc("increment_sample_size", {
        p_study_id: body.study_id,
      });

      return Response.json({ enrollment: data }, { status: 201 });
    }

    // Assign dimension level
    if (body.dimension_id && body.user_id && body.level) {
      const { data, error } = await supabase
        .from("dimension_assignments")
        .upsert({
          user_id: body.user_id,
          dimension_id: body.dimension_id,
          level: body.level,
          assigned_by: user.id,
        }, { onConflict: "user_id,dimension_id" })
        .select()
        .single();

      if (error) throw new ApiError(500, error.message);
      return Response.json({ assignment: data }, { status: 201 });
    }

    throw new ApiError(400, "Provide study enrollment or dimension assignment data");
  } catch (error) {
    return errorResponse(error);
  }
}
