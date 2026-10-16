import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { recommendHunt } from "@/lib/services/findbot";
import {
  VALID_SUBJECTS, VALID_GRADE_BANDS, VALID_LOCATION_TYPES,
  VALID_DIFFICULTY_PROGRESSIONS, validateEnum, clampInt, sanitizeForPrompt,
} from "@/lib/utils/ai-validation";
import { DEFAULT_GRADE_BAND, gradeBandFor } from "@/lib/utils/grade-bands";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");
    await aiLimiter.check(request, user.id);

    const body = await request.json();

    // Validate inputs
    const rawSubjects = Array.isArray(body.subject_domains) ? body.subject_domains.slice(0, 6) : ["science_nature"];
    const subject_domains = rawSubjects.filter((s: string) => VALID_SUBJECTS.includes(s as typeof VALID_SUBJECTS[number]));
    if (subject_domains.length === 0) subject_domains.push("science_nature");

    const grade_band = validateEnum(body.grade_band, VALID_GRADE_BANDS, "grade_band", DEFAULT_GRADE_BAND);
    const band = gradeBandFor(grade_band);
    const target_audience = validateEnum(body.target_audience, ["kids", "teens", "adults", "family", "all"] as const, "target_audience", band.audience);
    const location_type = validateEnum(body.location_type, VALID_LOCATION_TYPES, "location_type", "any");
    const difficulty_progression = validateEnum(body.difficulty_progression, VALID_DIFFICULTY_PROGRESSIONS, "difficulty_progression", "ascending");
    const target_duration_min = clampInt(body.target_duration_min, 10, 180, 40);
    const num_stops = clampInt(body.num_stops, 2, 10, 5);
    const theme = sanitizeForPrompt(body.theme, 200) || undefined;

    const supabase = await createSupabaseServiceClient();

    // College content is drawn from high-school level up; the library stops at grade 12.
    const gradeRange = band.libraryRange;

    // Fetch matching tasks from library
    let taskQuery = supabase
      .from("tasks")
      .select("id, title, subject_domain, tags, themes, challenge_type, difficulty_rating, location_dependency, location_type, estimated_minutes")
      .eq("is_library", true)
      .is("deleted_at", null)
      .lte("grade_range_min", gradeRange.max)
      .gte("grade_range_max", gradeRange.min)
      .limit(50);

    if (location_type !== "any") {
      taskQuery = taskQuery.in("location_type", [location_type, "any"]);
    }

    const { data: tasks } = await taskQuery;

    // Filter by subject domains in application code (array overlap)
    const filteredTasks = (tasks || []).filter(
      (t) => subject_domains.includes(t.subject_domain) || subject_domains.length === 0
    );

    // Fetch matching primers
    let primerQuery = supabase
      .from("primers")
      .select("id, title, subject_domain, tags, themes, difficulty_rating, location_dependency, location_type")
      .eq("is_library", true)
      .is("deleted_at", null)
      .limit(50);

    if (location_type !== "any") {
      primerQuery = primerQuery.in("location_type", [location_type, "any"]);
    }

    const { data: primers } = await primerQuery;

    const filteredPrimers = (primers || []).filter(
      (p) => subject_domains.includes(p.subject_domain || "") || subject_domains.length === 0
    );

    // Fetch pairing history for quality signals
    const { data: history } = await supabase
      .from("pairing_history")
      .select("primer_id, task_id, avg_score, times_used")
      .order("avg_score", { ascending: false })
      .limit(50);

    if (filteredTasks.length === 0) {
      throw new ApiError(404, "No matching tasks found in the library for these criteria");
    }

    const result = await recommendHunt({
      availableTasks: filteredTasks.map((t) => ({
        id: t.id,
        title: t.title,
        subject_domain: t.subject_domain || "",
        tags: t.tags || [],
        challenge_type: t.challenge_type,
        difficulty_rating: t.difficulty_rating || 5,
        location_type: t.location_type || "any",
        estimated_minutes: t.estimated_minutes || 5,
      })),
      availablePrimers: filteredPrimers.map((p) => ({
        id: p.id,
        title: p.title,
        subject_domain: p.subject_domain || "",
        tags: p.tags || [],
        difficulty_rating: p.difficulty_rating || 5,
        location_type: p.location_type || "any",
      })),
      pairingHistory: history?.map((h) => ({
        primer_id: h.primer_id,
        task_id: h.task_id,
        avg_score: h.avg_score || 0,
        times_used: h.times_used || 1,
      })) || [],
      huntSpec: {
        subject_domains,
        grade_band: band.promptAudience,
        target_audience,
        location_type,
        target_duration_min,
        difficulty_progression,
        num_stops,
        theme,
      },
    });

    return Response.json({
      recommendation: result,
      tasks_available: filteredTasks.length,
      primers_available: filteredPrimers.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
