import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import {
  buildQuestionRows,
  SurveyValidationError,
  type IncomingQuestion,
} from "@/lib/utils/survey-authoring";

/**
 * Manage a survey's questions in the normalized `survey_questions` table.
 *
 * `[id]` is the SURVEY id (matching the admin GET/PUT on /surveys/[id]). This is
 * the single source of truth for question content: the participant take-page and
 * the scoring engine both read `survey_questions`, so authoring here (rather than
 * the legacy `surveys.questions` JSONB) is what makes an authored survey actually
 * render and score. Admin/researcher only.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: surveyId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("survey_questions")
      .select(
        "id, item_code, question_text, question_type, options, scale_config, reverse_coded, subscale, sort_order, required"
      )
      .eq("survey_id", surveyId)
      .order("sort_order");

    if (error) throw new ApiError(500, error.message);
    return Response.json({ questions: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Replace the full question set for a survey (the editor saves the whole form).
 * Validates every item, inserts the new set, and only then deletes the old rows,
 * so a failed insert leaves the stored questions untouched. `sort_order` is
 * assigned from array position, so the editor controls order.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: surveyId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json();
    const incoming: IncomingQuestion[] = Array.isArray(body.questions) ? body.questions : [];
    const rows = toRowsOr400(surveyId, incoming);

    const supabase = await createSupabaseServiceClient();

    // Verify the survey exists before mutating.
    const { data: survey } = await supabase
      .from("surveys")
      .select("id")
      .eq("id", surveyId)
      .maybeSingle();
    if (!survey) throw new ApiError(404, "Survey not found");

    const { data: existing, error: readError } = await supabase
      .from("survey_questions")
      .select("id")
      .eq("survey_id", surveyId);
    if (readError) throw new ApiError(500, readError.message);
    const oldIds = (existing || []).map((q) => q.id);

    let newIds: string[] = [];
    if (rows.length > 0) {
      const { data: inserted, error: insError } = await supabase
        .from("survey_questions")
        .insert(rows)
        .select("id");
      if (insError) throw new ApiError(500, insError.message);
      newIds = (inserted || []).map((q) => q.id);
    }

    if (oldIds.length > 0) {
      const { error: delError } = await supabase.from("survey_questions").delete().in("id", oldIds);
      if (delError) {
        // Roll back the new rows so the survey isn't left with both sets.
        if (newIds.length > 0) await supabase.from("survey_questions").delete().in("id", newIds);
        throw new ApiError(500, delError.message);
      }
    }

    return Response.json({ ok: true, count: rows.length });
  } catch (error) {
    return errorResponse(error);
  }
}

function toRowsOr400(surveyId: string, incoming: IncomingQuestion[]) {
  try {
    return buildQuestionRows(surveyId, incoming);
  } catch (error) {
    if (error instanceof SurveyValidationError) throw new ApiError(400, error.message);
    throw error;
  }
}
