import { NextRequest } from "next/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { generateClueWithHints } from "@/lib/services/findbot";
import {
  VALID_DIFFICULTY_TIERS, VALID_LOCATION_TYPES,
  validateEnum, sanitizeForPrompt, validatePayloadSize, clampInt,
} from "@/lib/utils/ai-validation";

/** The max never falls below the min (a college min with no max stays college). */
function gradeRangeFrom(min: number, rawMax: unknown) {
  return { min, max: clampInt(rawMax, min, 16, Math.max(min, 8)) };
}

export async function POST(request: NextRequest) {
  try {
    await aiLimiter.check(request);
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const { primer_content, task_content, location_name, grade_min, grade_max } = body;

    if (!primer_content && !task_content) {
      throw new ApiError(400, "At least primer_content or task_content is required");
    }

    // Validate payload sizes
    if (primer_content) validatePayloadSize(primer_content, 5000, "primer_content");
    if (task_content) validatePayloadSize(task_content, 5000, "task_content");

    const result = await generateClueWithHints({
      primerContent: primer_content || {},
      taskContent: task_content || {},
      locationName: sanitizeForPrompt(location_name, 200),
      locationType: validateEnum(body.location_type, VALID_LOCATION_TYPES, "location_type", "any"),
      difficultyTier: validateEnum(body.difficulty_tier, VALID_DIFFICULTY_TIERS, "difficulty_tier", "medium"),
      gradeRange: grade_min != null ? gradeRangeFrom(clampInt(grade_min, 0, 16, 3), grade_max) : undefined,
    });

    return Response.json({ ...result, generated_by: "gpt-4o-mini" });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 15;
