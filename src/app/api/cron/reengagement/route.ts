/**
 * Re-engagement nudge cron (Workstream B / Task B4).
 *
 * RESEARCH-INTEGRITY GUARDRAIL: nudges are applied UNIFORMLY across all
 * participants and privacy conditions. This route selects recipients ONLY by
 * engagement signals (inactivity + cooldown) and the participant's own
 * notification preferences — it never reads `privacy_treatment`,
 * `profile_visibility`, or any condition field, and never branches on condition.
 * See src/lib/services/reengagement.ts for the (condition-blind, tested) decision.
 *
 * CRON_SECRET auth, same pattern as the other crons.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  decideReengagement,
  reengagementMessage,
  REENGAGEMENT_TYPE,
  type ParticipantEngagement,
} from "@/lib/services/reengagement";
import { fetchAllRows, ID_CHUNK } from "@/lib/utils/paginate";

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * A participant's most recent session start and find completion.
 *
 * find_completions (migration 002) has no user_id: it belongs to a user only
 * through play_session_id → play_sessions.user_id. The old query filtered on
 * the missing column, PostgREST rejected it, and a participant who kept
 * playing inside one long session looked inactive since that session started.
 */
async function lastGameplay(
  supabase: ServiceClient,
  userId: string
): Promise<{ lastSession: string | null; lastFind: string | null }> {
  const sessions = await fetchAllRows<{ id: string; started_at: string | null }>((from, to) =>
    supabase
      .from("play_sessions")
      .select("id, started_at")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to)
  );

  let lastSession: string | null = null;
  for (const s of sessions) lastSession = maxIso(lastSession, s.started_at);

  let lastFind: string | null = null;
  const sessionIds = sessions.map((s) => s.id);
  for (let i = 0; i < sessionIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("find_completions")
      .select("completed_at")
      .in("play_session_id", sessionIds.slice(i, i + ID_CHUNK))
      // completed_at is nullable (arrived but not finished) and NULLs sort first descending.
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`find_completions read failed: ${error.message}`);
    lastFind = maxIso(lastFind, (data?.[0]?.completed_at as string | undefined) ?? null);
  }

  return { lastSession, lastFind };
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();
  const nowMs = Date.now();

  let enrollments: { user_id: string; enrolled_at: string }[];
  try {
    enrollments = await fetchAllRows<{ user_id: string; enrolled_at: string }>((from, to) =>
      supabase
        .from("study_enrollments")
        .select("user_id, enrolled_at")
        .is("withdrawn_at", null)
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (err) {
    console.error("reengagement: enrollment read failed:", err);
    return Response.json({ error: "Could not read enrollments" }, { status: 500 });
  }

  let nudged = 0;
  let considered = 0;
  let skipped = 0;

  for (const e of enrollments) {
    considered++;
    const userId = e.user_id;

    // Activity signal: most recent gameplay (session start or find completion),
    // falling back to enrollment as the baseline. Condition-independent.
    let gameplay: Awaited<ReturnType<typeof lastGameplay>>;
    try {
      gameplay = await lastGameplay(supabase, userId);
    } catch (err) {
      // Unknown activity must not be read as inactivity: skip rather than nudge.
      console.error("reengagement: activity read failed:", err);
      skipped++;
      continue;
    }
    const lastSeenAt = maxIso(maxIso(gameplay.lastSession, gameplay.lastFind), e.enrolled_at);

    const lastNudge = await supabase
      .from("notifications")
      .select("created_at")
      .eq("user_id", userId)
      .eq("type", REENGAGEMENT_TYPE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("push_enabled, disabled_types")
      .eq("user_id", userId)
      .maybeSingle();

    const engagement: ParticipantEngagement = {
      lastSeenAt,
      lastNudgeAt: lastNudge.data?.created_at ?? null,
      pushEnabled: prefs?.push_enabled ?? true,
      disabledTypes: prefs?.disabled_types ?? [],
    };

    const decision = decideReengagement(engagement, nowMs);
    if (!decision.shouldNudge || decision.daysInactive == null) continue;

    const msg = reengagementMessage(decision.daysInactive);
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type: REENGAGEMENT_TYPE,
      title: msg.title,
      body: msg.body,
    });
    if (!error) nudged++;
  }

  return Response.json({
    participants_considered: considered,
    nudges_sent: nudged,
    skipped_activity_unknown: skipped,
  });
}
