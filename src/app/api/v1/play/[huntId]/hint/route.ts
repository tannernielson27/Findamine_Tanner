import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { playLimiter } from "@/lib/utils/rate-limit";

/**
 * 4-level hint system:
 * Level 1: General encouragement + restate question
 * Level 2: Point toward relevant information
 * Level 3: Narrow down answer space
 * Level 4: Give answer structure with one piece missing
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await playLimiter.check(request, user.id);

    const body = await request.json();
    const { find_id, level } = body;

    if (!find_id) throw new ApiError(400, "find_id required");
    const hintLevel = Math.max(1, Math.min(4, level || 1));

    const supabase = await createSupabaseServiceClient();

    // Get active session
    const { data: session } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!session) throw new ApiError(404, "No active play session");

    // Get task content for this find
    const { data: find } = await supabase
      .from("finds")
      .select("tasks(id, content, challenge_type)")
      .eq("id", find_id)
      .single();

    const task = find?.tasks as unknown as { id: string; content: Record<string, unknown>; challenge_type: string } | null;

    // Check cached hint first
    if (task) {
      const { data: cached } = await supabase
        .from("ai_hint_cache")
        .select("id, hint_text")
        .eq("task_id", task.id)
        .eq("hint_level", hintLevel)
        .eq("status", "active")
        .maybeSingle();

      if (cached) {
        // Atomically increment usage count
        await supabase.rpc("increment_hint_usage", {
          p_cache_id: cached.id,
        });

        // Update completion hints_used
        await supabase
          .from("find_completions")
          .update({ hints_used: hintLevel })
          .eq("play_session_id", session.id)
          .eq("find_id", find_id);

        return Response.json({ hint: cached.hint_text, level: hintLevel, source: "cache" });
      }
    }

    // Generate hint based on level (fallback templates)
    const hints = task?.content?.hints as string[] | undefined;
    let hintText: string;

    if (hints && hints[hintLevel - 1]) {
      hintText = hints[hintLevel - 1];
    } else {
      // Fallback generic hints
      const genericHints = [
        "Take a moment to look around. What do you notice about this location? Re-read the clue carefully.",
        "Think about what the clue is really asking. The answer is connected to something you can observe here.",
        "You're getting closer! Focus on the most specific detail in the clue. The answer is right in front of you.",
        "Almost there! Go back to the main thing the clue points to. Look at it one more time and count or describe exactly what you see.",
      ];
      hintText = genericHints[hintLevel - 1];
    }

    // Update completion hints_used
    await supabase
      .from("find_completions")
      .update({ hints_used: hintLevel })
      .eq("play_session_id", session.id)
      .eq("find_id", find_id);

    // Log in feedback_log
    await supabase.from("feedback_log").insert({
      user_id: user.id,
      feedback_text: hintText,
      trigger_type: "hint_requested",
      context_type: "find",
      context_id: find_id,
      generated_by: hints ? "template" : "template",
    });

    return Response.json({ hint: hintText, level: hintLevel, source: "template" });
  } catch (error) {
    return errorResponse(error);
  }
}
