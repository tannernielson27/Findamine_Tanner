import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { playLimiter } from "@/lib/utils/rate-limit";
import { getCompletion, insertCompletion } from "../../_lib/completions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    await playLimiter.check(request);
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const { find_id, level } = body;
    if (!find_id) throw new ApiError(400, "find_id required");

    const levelNum = parseInt(level) || 1;
    const hintLevel = Math.max(1, Math.min(3, levelNum));
    const supabase = await createSupabaseServiceClient();

    // Verify user has an active session in this hunt
    const { data: session } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!session) throw new ApiError(403, "Not a participant in this hunt");

    // Get the find's clue hints
    const { data: find } = await supabase
      .from("finds")
      .select("clue_hints")
      .eq("id", find_id)
      .eq("hunt_id", huntId)
      .single();

    if (!find) throw new ApiError(404, "Find not found");

    const hints = (find.clue_hints || []) as string[];
    if (hints.length === 0) {
      throw new ApiError(404, "No clue hints available for this stop");
    }

    const hintIndex = Math.min(hintLevel - 1, hints.length - 1);
    const hint = hints[hintIndex];

    // Update clue_hints_used on the completion record
    // The clue step comes before arrival, so there is often no row yet: create
    // one, otherwise the hint penalty would never reach scoring.
    {
      const usedLevel = hintIndex + 1;
      const completion = await getCompletion(supabase, session.id, find_id);

      if (!completion) {
        await insertCompletion(supabase, session.id, find_id, { clue_hints_used: usedLevel });
      } else if ((completion.clue_hints_used || 0) < usedLevel) {
        const { error: updateError } = await supabase
          .from("find_completions")
          .update({ clue_hints_used: usedLevel })
          .eq("id", completion.id);
        if (updateError) throw new ApiError(500, updateError.message);
      }
    }

    return Response.json({
      hint,
      level: hintIndex + 1,
      total_hints: hints.length,
      penalty_per_hint: 2,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
