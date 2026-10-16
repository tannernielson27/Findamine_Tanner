import { NextRequest } from "next/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { COLLEGE_MIN_GRADE } from "@/lib/utils/grade-bands";
import { clampInt } from "@/lib/utils/ai-validation";
import { generateContent } from "@/lib/services/findbot";
import type { AgeBand } from "@/lib/themes/tokens";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");
    await aiLimiter.check(request, user.id);

    const body = await request.json();
    const { content_type, location_name, subject_domain, grade_min, grade_max, existing_content } = body;

    if (!content_type || !["clue", "task", "primer"].includes(content_type)) {
      throw new ApiError(400, "content_type must be clue, task, or primer");
    }

    // FindBot's voice follows who will play the content, not who is writing it
    // (authors are adults). College-level ranges (13+) get the adult voice.
    const gradeMin = clampInt(grade_min, 0, 16, -1);
    const gradeRange = gradeMin >= 0
      ? { min: gradeMin, max: clampInt(grade_max, gradeMin, 16, Math.min(gradeMin + 2, 16)) }
      : undefined;
    const ageBand: AgeBand = !gradeRange || gradeRange.max >= COLLEGE_MIN_GRADE ? "adult"
      : gradeRange.max <= 3 ? "primary"
      : gradeRange.max <= 6 ? "intermediate"
      : "teen";

    const content = await generateContent({
      contentType: content_type,
      locationName: location_name,
      subjectDomain: subject_domain,
      gradeRange,
      existingContent: existing_content,
      ageBand,
    });

    if (!content) {
      throw new ApiError(500, "Failed to generate content");
    }

    return Response.json({
      content,
      content_type,
      generated_by: "findbot",
      model: "claude-sonnet-4-20250514",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
