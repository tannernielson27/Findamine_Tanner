import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { suggestPairings } from "@/lib/services/findbot";
import { VALID_SUBJECTS, VALID_LOCATION_TYPES, validateEnum, clampInt } from "@/lib/utils/ai-validation";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");
    await aiLimiter.check(request, user.id);

    const body = await request.json();
    const subject = body.subject ? validateEnum(body.subject, VALID_SUBJECTS, "subject", "science_nature") : undefined;
    const location_type = body.location_type ? validateEnum(body.location_type, VALID_LOCATION_TYPES, "location_type", "any") : undefined;
    const count = clampInt(body.count, 1, 20, 5);

    const supabase = await createSupabaseServiceClient();

    // Fetch library tasks
    let taskQuery = supabase
      .from("tasks")
      .select("id, title, subject_domain, tags, challenge_type, difficulty_rating")
      .eq("is_library", true)
      .is("deleted_at", null)
      .limit(30);

    if (subject) taskQuery = taskQuery.eq("subject_domain", subject);
    if (location_type) taskQuery = taskQuery.in("location_type", [location_type, "any"]);

    const { data: tasks } = await taskQuery;

    // Fetch library primers
    let primerQuery = supabase
      .from("primers")
      .select("id, title, subject_domain, tags, difficulty_rating")
      .eq("is_library", true)
      .is("deleted_at", null)
      .limit(30);

    if (subject) primerQuery = primerQuery.eq("subject_domain", subject);

    const { data: primers } = await primerQuery;

    if (!tasks?.length || !primers?.length) {
      throw new ApiError(404, "Not enough library content to suggest pairings");
    }

    const result = await suggestPairings({
      availableTasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        subject_domain: t.subject_domain || "",
        tags: t.tags || [],
        challenge_type: t.challenge_type,
        difficulty_rating: t.difficulty_rating || 5,
      })),
      availablePrimers: primers.map((p) => ({
        id: p.id,
        title: p.title,
        subject_domain: p.subject_domain || "",
        tags: p.tags || [],
        difficulty_rating: p.difficulty_rating || 5,
      })),
      targetCount: count,
    });

    return Response.json({ ...result, generated_by: "gpt-4o-mini" });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 15;
