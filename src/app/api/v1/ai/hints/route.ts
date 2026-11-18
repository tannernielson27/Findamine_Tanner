import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { generateHint } from "@/lib/services/findbot";
import { withLogging } from "@/lib/utils/with-logging";
import type { AgeBand } from "@/lib/themes/tokens";
import { bandForUser } from "@/lib/utils/age-band";
import { canSeeAnswerKeys } from "../../hunts/redact-finds";
import { assertStopStarted } from "../../play/_lib/stop-start";

export const POST = withLogging("POST /api/v1/ai/hints", async (request: NextRequest) => {
  const user = await getAuthUser(request);
  if (!user) throw new ApiError(401, "Not authenticated");
  await aiLimiter.check(request, user.id);

  const body = await request.json();
  const { find_id, level } = body;
  if (typeof find_id !== "string" || !find_id) throw new ApiError(400, "find_id required");

  const hintLevel = Math.max(1, Math.min(4, level || 1));
  const supabase = await createSupabaseServiceClient();

  const { data: find } = await supabase
    .from("finds")
    .select("hunt_id, clue_text, tasks(id, title, content, challenge_type), locations(name)")
    .eq("id", find_id)
    .single();

  if (!find) throw new ApiError(404, "Find not found");

  // The hint is written from the clue and the place name, so it is only for a
  // player who has started this stop, or for someone who can edit the hunt.
  await assertMayReadStop(supabase, user, find.hunt_id as string, find_id);

  const task = find.tasks as unknown as { id: string; title: string; content: Record<string, unknown> } | null;
  const location = find.locations as unknown as { name: string } | null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("effective_band")
    .eq("user_id", user.id)
    .maybeSingle();

  const ageBand: AgeBand = bandForUser(profile?.effective_band, user.role);

  // Check cache first
  if (task) {
    const { data: cached } = await supabase
      .from("ai_hint_cache")
      .select("id, hint_text")
      .eq("task_id", task.id)
      .eq("hint_level", hintLevel)
      .eq("age_band", ageBand)
      .eq("status", "active")
      .maybeSingle();

    if (cached) {
      await supabase.rpc("increment_hint_usage", {
        p_cache_id: cached.id,
      });

      return Response.json({ hint: cached.hint_text, level: hintLevel, source: "cache" });
    }
  }

  const hint = await generateHint({
    taskTitle: task?.title || "Challenge",
    taskContent: task?.content || {},
    clueText: find.clue_text,
    locationName: location?.name || null,
    hintLevel,
    ageBand,
  });

  if (task && hint) {
    await supabase.from("ai_hint_cache").insert({
      task_id: task.id,
      hint_level: hintLevel,
      age_band: ageBand,
      hint_text: hint,
      ai_model: "claude-sonnet-4-20250514",
    });
  }

  return Response.json({ hint, level: hintLevel, source: "ai" });
});

/** 404 unless the caller edits the hunt or is playing it; 409 until they have started the stop. */
async function assertMayReadStop(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  user: { id: string; role: string },
  huntId: string,
  findId: string
): Promise<void> {
  const { data: hunt } = await supabase.from("hunts").select("created_by").eq("id", huntId).maybeSingle();
  if (hunt && canSeeAnswerKeys(user, hunt.created_by as string | null)) return;

  const { data: session } = await supabase
    .from("play_sessions")
    .select("id")
    .eq("hunt_id", huntId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!session) throw new ApiError(404, "Find not found");
  await assertStopStarted(supabase, session.id as string, findId);
}

export const maxDuration = 30;
