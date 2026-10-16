import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { assignParticipant } from "@/lib/services/randomization";
import { canJoinResearch } from "@/lib/utils/research-eligibility";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json();
    const { study_id, user_id } = body;

    if (!study_id || !user_id) {
      throw new ApiError(400, "study_id and user_id required");
    }

    const supabase = await createSupabaseServiceClient();

    // The study is adults-only: staff cannot randomize a minor (or a colleague)
    // by hand either. Same rule as the consent route and auto-enrollment.
    const { data: target } = await supabase
      .from("users")
      .select("role, date_of_birth")
      .eq("id", user_id)
      .maybeSingle();
    if (!target) throw new ApiError(404, "User not found");
    if (!canJoinResearch(target)) {
      throw new ApiError(403, "This user is not eligible for the study (adults 18 or older, with a date of birth on file)");
    }

    // Get study dimensions
    const { data: studyDims } = await supabase
      .from("treatment_study_dimensions")
      .select("dimension_id")
      .eq("study_id", study_id);

    if (!studyDims || studyDims.length === 0) {
      throw new ApiError(400, "Study has no dimensions configured");
    }

    const result = await assignParticipant(user_id, {
      studyId: study_id,
      dimensionIds: studyDims.map((d) => d.dimension_id),
      stratifyBy: body.stratify_by || ["age_band"],
      blockSize: body.block_size || 6,
    });

    // Enroll user in study if not already
    await supabase
      .from("study_enrollments")
      .upsert({ study_id, user_id }, { onConflict: "study_id,user_id" });

    // Update study sample size
    const { count } = await supabase
      .from("study_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("study_id", study_id)
      .is("withdrawn_at", null);

    await supabase
      .from("treatment_studies")
      .update({ current_sample_size: count || 0 })
      .eq("id", study_id);

    return Response.json({ assignment: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
