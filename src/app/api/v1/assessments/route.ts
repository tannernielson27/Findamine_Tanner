import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { authLimiter, generalLimiter } from "@/lib/utils/rate-limit";
import { ALL_ITEMS, parseResponses, scoreResponses, type AssessmentType, type Scores } from "./scoring";

const TYPES: AssessmentType[] = ["personality", "growth_mindset"];

interface AssessmentRow {
  assessment_type: AssessmentType;
  scores: Scores | null;
  assessed_at: string;
}

/**
 * The signed-in user's own latest saved assessment (never anyone else's:
 * other users' scores are only served by the profile route, behind the
 * personality_scores privacy setting).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await generalLimiter.check(request, user.id);

    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("player_assessments")
      .select("assessment_type, scores, assessed_at")
      .eq("user_id", user.id)
      .in("assessment_type", TYPES)
      .order("assessed_at", { ascending: false })
      .limit(20);
    if (error) throw new ApiError(500, "Could not load your results");

    // Newest row per type, merged into the one profile the page shows.
    const latest = new Map<AssessmentType, AssessmentRow>();
    for (const row of (data || []) as AssessmentRow[]) {
      if (!latest.has(row.assessment_type)) latest.set(row.assessment_type, row);
    }
    if (latest.size === 0) return Response.json({ assessment: null });

    const scores: Scores = {};
    for (const type of TYPES) Object.assign(scores, latest.get(type)?.scores || {});
    const assessedAt = [...latest.values()].map((r) => r.assessed_at).sort().pop() ?? null;

    return Response.json({ assessment: { scores, assessed_at: assessedAt } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Save the signed-in user's answers. The user id always comes from the
 * session and the scores are computed here from the answers, so a caller can
 * neither write someone else's row nor store scores that don't match.
 * A retake adds new rows; readers use the newest per type.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await authLimiter.check(request, user.id);

    const body = await request.json().catch(() => null);
    const responses = parseResponses(body?.responses);
    if (!responses) {
      throw new ApiError(400, `Answer all ${ALL_ITEMS.length} statements with a whole number from 1 to 7.`);
    }

    const scored = scoreResponses(responses);
    const assessedAt = new Date().toISOString();

    const supabase = await createSupabaseServiceClient();
    const { error } = await supabase.from("player_assessments").insert(
      TYPES.map((type) => ({
        user_id: user.id,
        assessment_type: type,
        responses: { items: scored[type].responses },
        scores: scored[type].scores,
        assessed_at: assessedAt,
      }))
    );
    if (error) throw new ApiError(500, "Could not save your results. Please try again.");

    return Response.json(
      {
        assessment: {
          scores: { ...scored.personality.scores, ...scored.growth_mindset.scores },
          assessed_at: assessedAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
