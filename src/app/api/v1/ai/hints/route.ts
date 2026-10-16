import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, ApiError } from "@/lib/utils/api-auth";
import { aiLimiter } from "@/lib/utils/rate-limit";
import { generateHint } from "@/lib/services/findbot";
import { withLogging } from "@/lib/utils/with-logging";
import type { AgeBand } from "@/lib/themes/tokens";
import { bandForUser } from "@/lib/utils/age-band";

export const POST = withLogging("POST /api/v1/ai/hints", async (request: NextRequest) => {
  const user = await getAuthUser(request);
  if (!user) throw new ApiError(401, "Not authenticated");
  await aiLimiter.check(request, user.id);

  const body = await request.json();
  const { find_id, level } = body;
  if (!find_id) throw new ApiError(400, "find_id required");

  const hintLevel = Math.max(1, Math.min(4, level || 1));
  const supabase = await createSupabaseServiceClient();

  const { data: find } = await supabase
    .from("finds")
    .select("clue_text, tasks(id, title, content, challenge_type), locations(name)")
    .eq("id", find_id)
    .single();

  if (!find) throw new ApiError(404, "Find not found");

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

export const maxDuration = 30;
