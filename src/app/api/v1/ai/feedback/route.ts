import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { generateFeedback } from "@/lib/services/findbot";
import type { AgeBand } from "@/lib/themes/tokens";
import { bandForUser } from "@/lib/utils/age-band";

export async function POST(request: NextRequest) {
  try {
    await aiLimiter.check(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("effective_band")
      .eq("user_id", user.id)
      .maybeSingle();

    const ageBand: AgeBand = bandForUser(profile?.effective_band, user.role);

    const feedback = await generateFeedback({
      isCorrect: body.is_correct,
      partialCredit: body.partial_credit,
      taskTitle: body.task_title || "Challenge",
      answer: body.answer || "",
      correctAnswer: body.correct_answer,
      attemptNumber: body.attempt_number || 1,
      hintsUsed: body.hints_used || 0,
      ageBand,
    });

    // Log feedback
    await supabase.from("feedback_log").insert({
      user_id: user.id,
      feedback_text: feedback.main,
      trigger_type: "answer_submitted",
      context_type: body.context_type || "find",
      context_id: body.context_id || null,
      generated_by: "ai",
      ai_model: "claude-sonnet-4-20250514",
    });

    return Response.json({ feedback, source: "ai" });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
