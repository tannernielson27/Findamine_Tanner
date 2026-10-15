import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { generateModule } from "@/lib/services/findbot";
import {
  VALID_SUBJECTS, VALID_GRADE_BANDS, VALID_CHALLENGE_TYPES,
  VALID_DIFFICULTY_TIERS, VALID_LOCATION_TYPES,
  validateEnum, sanitizeForPrompt, clampInt,
} from "@/lib/utils/ai-validation";
import { DEFAULT_GRADE_BAND, gradeBandFor } from "@/lib/utils/grade-bands";

const MAX_LESSON_PLAN = 10000;
const MAX_TOPIC = 200;

export async function POST(request: NextRequest) {
  try {
    await aiLimiter.check(request);
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();

    // Validate inputs
    const subject = validateEnum(body.subject, VALID_SUBJECTS, "subject", "science_nature");
    const grade_band = validateEnum(body.grade_band, VALID_GRADE_BANDS, "grade_band", DEFAULT_GRADE_BAND);
    const band = gradeBandFor(grade_band);
    const challenge_type = validateEnum(body.challenge_type, VALID_CHALLENGE_TYPES, "challenge_type", "multiple_choice");
    const difficulty_tier = validateEnum(body.difficulty_tier, VALID_DIFFICULTY_TIERS, "difficulty_tier", "medium");
    const location_type = validateEnum(body.location_type, VALID_LOCATION_TYPES, "location_type", "any");
    const topic = sanitizeForPrompt(body.topic, MAX_TOPIC);
    const lesson_plan_text = typeof body.lesson_plan_text === "string"
      ? body.lesson_plan_text.slice(0, MAX_LESSON_PLAN)
      : undefined;
    const tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string").slice(0, 20) : undefined;
    const save_to_library = body.save_to_library === true;

    if (!topic && !lesson_plan_text) {
      throw new ApiError(400, "Either topic or lesson_plan_text is required");
    }

    const result = await generateModule({
      subject,
      gradeBand: band.promptAudience,
      challengeType: challenge_type,
      difficultyTier: difficulty_tier,
      locationType: location_type,
      topic: topic || "Custom topic",
      tags,
      lessonPlanText: lesson_plan_text,
    });

    if (save_to_library) {
      // Only admin and researcher can save to shared library
      // Teachers can generate but must request library addition
      if (!["admin", "researcher"].includes(user.role)) {
        throw new ApiError(403, "Only admins and researchers can add content to the shared library. Content has been generated but not saved.");
      }

      const supabase = await createSupabaseServiceClient();

      const gradeRange = band.range;
      const difficultyMap: Record<string, number> = { easy: 3, medium: 5, hard: 8 };
      const difficultyRating = difficultyMap[difficulty_tier] || 5;

      // Validate generated content before saving
      const primerTitle = (result.primer?.title || "").slice(0, 500);
      const taskTitle = (result.task?.title || "").slice(0, 500);
      if (!primerTitle || !taskTitle) {
        throw new ApiError(500, "AI generated invalid content — please try again");
      }

      const { data: primer } = await supabase
        .from("primers")
        .insert({
          title: primerTitle,
          content: result.primer.content,
          subject_domain: subject,
          grade_range_min: gradeRange.min,
          grade_range_max: gradeRange.max,
          is_library: true,
          location_dependency: location_type === "any" ? "independent" : "type_dependent",
          location_type: location_type,
          difficulty_rating: difficultyRating,
          tags: tags || [],
          learning_objectives: result.primer.learning_objectives || [],
          created_by: user.id,
        })
        .select("id")
        .single();

      const { data: task } = await supabase
        .from("tasks")
        .insert({
          title: taskTitle,
          subject_domain: subject,
          challenge_type,
          content: result.task.content,
          grade_range_min: gradeRange.min,
          grade_range_max: gradeRange.max,
          difficulty_level: Math.ceil(difficultyRating / 2),
          is_library: true,
          location_dependency: location_type === "any" ? "independent" : "type_dependent",
          location_type: location_type,
          difficulty_rating: difficultyRating,
          tags: tags || [],
          learning_objectives: result.task.learning_objectives || [],
          created_by: user.id,
        })
        .select("id")
        .single();

      return Response.json({
        ...result,
        saved: true,
        primer_id: primer?.id,
        task_id: task?.id,
        generated_by: "gpt-4o-mini",
      }, { status: 201 });
    }

    return Response.json({ ...result, saved: false, generated_by: "gpt-4o-mini" });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
