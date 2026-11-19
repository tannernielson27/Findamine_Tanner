/**
 * Scheduled-hunt notices (issue #14): tells players in a running scheduled
 * hunt when new stops have opened, and once when the hunt is about to end.
 *
 * RESEARCH-INTEGRITY GUARDRAIL: recipients are chosen ONLY by being in the
 * hunt (an active play session) and by their own notification preferences.
 * This route never reads `privacy_treatment`, `profile_visibility` or any
 * condition field, and must not start to. See
 * src/lib/services/hunt-schedule-notices.ts for the (condition-blind, tested)
 * decisions.
 *
 * Safe to call as often as you like: each notice is recorded per player in
 * hunt_schedule_notices (migration 087) and sent once. Called rarely, it
 * announces everything released since (within about a day) in one notice;
 * called every few minutes, notices arrive when a release happens.
 *
 * CRON_SECRET auth, same pattern as the other crons.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/services/email";
import { readHuntWindow, readScheduleTimeZone, type HuntWindow } from "@/lib/hunts/schedule";
import {
  HUNT_ENDING_TYPE,
  HUNT_NOTICE_ENTITY,
  HUNT_RELEASE_TYPE,
  dueEndingNotice,
  dueReleaseNotice,
  endingMessage,
  huntNoticeHref,
  mayEmail,
  mayNotify,
  noticeEmailHtml,
  releaseMessage,
  type NoticeMessage,
  type NoticePreferences,
} from "@/lib/services/hunt-schedule-notices";

export const maxDuration = 60;

const PLAYABLE_STATUSES = ["published", "enrollment_open", "in_progress"];
/** Most hunts looked at, and most players notified per hunt, in one run. */
const MAX_HUNTS = 50;
const MAX_PLAYERS_PER_HUNT = 1000;
const UNIQUE_VIOLATION = "23505";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

interface DueNotice {
  kind: "release" | "ending_soon";
  type: string;
  dueAtMs: number;
  message: NoticeMessage;
}

/** What is due for one hunt right now: at most one release notice and one ending notice. */
function dueNotices(
  hunt: { title: string; metadata: Record<string, unknown> | null },
  window: HuntWindow,
  releases: ReadonlyArray<string | null>,
  nowMs: number
): DueNotice[] {
  const due: DueNotice[] = [];
  const release = dueReleaseNotice(window, releases, nowMs);
  if (release) {
    due.push({ kind: "release", type: HUNT_RELEASE_TYPE, dueAtMs: release.dueAtMs, message: releaseMessage(hunt.title, release.stopCount) });
  }
  const ending = dueEndingNotice(window, nowMs);
  if (ending) {
    due.push({
      kind: "ending_soon",
      type: HUNT_ENDING_TYPE,
      dueAtMs: ending.dueAtMs,
      message: endingMessage(hunt.title, window, readScheduleTimeZone(hunt.metadata)),
    });
  }
  return due;
}

/**
 * Sends one notice to one player, once. The record goes in first: if another
 * run already made it, this one stops. If the notification can't be written
 * the record is taken back, so a later run tries again.
 */
async function sendOnce(
  supabase: ServiceClient,
  huntId: string,
  player: { id: string; email: string | null; prefs: NoticePreferences | null },
  notice: DueNotice
): Promise<"sent" | "already" | "muted" | "failed"> {
  if (!mayNotify(player.prefs, notice.type)) return "muted";
  const record = { hunt_id: huntId, user_id: player.id, kind: notice.kind, due_at: new Date(notice.dueAtMs).toISOString() };
  const { error: recordError } = await supabase.from("hunt_schedule_notices").insert(record);
  if (recordError) return recordError.code === UNIQUE_VIOLATION ? "already" : "failed";

  const { error } = await supabase.from("notifications").insert({
    user_id: player.id,
    type: notice.type,
    title: notice.message.title,
    body: notice.message.body,
    entity_type: HUNT_NOTICE_ENTITY,
    entity_id: huntId,
  });
  if (error) {
    await supabase
      .from("hunt_schedule_notices")
      .delete()
      .eq("hunt_id", huntId)
      .eq("user_id", player.id)
      .eq("kind", notice.kind)
      .eq("due_at", record.due_at);
    return "failed";
  }

  // Email is the fallback for players who asked for it. Its failure is not
  // retried: the in-app notice is already there.
  if (player.email && mayEmail(player.prefs, notice.type)) {
    const link = `${SITE_URL}${huntNoticeHref(HUNT_NOTICE_ENTITY, huntId)}`;
    await sendEmail({ to: player.email, subject: notice.message.title, html: noticeEmailHtml(notice.message, link) });
  }
  return "sent";
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Hunts whose window is open right now.
  const { data: hunts, error: huntsError } = await supabase
    .from("hunts")
    .select("id, title, status, metadata, starts_at, ends_at")
    .in("status", PLAYABLE_STATUSES)
    .is("deleted_at", null)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .limit(MAX_HUNTS);
  if (huntsError) {
    console.error("hunt-releases: hunts read failed:", huntsError.message);
    return Response.json({ error: "Could not read hunts" }, { status: 500 });
  }

  const totals = { hunts_open: 0, notices_due: 0, sent: 0, already: 0, muted: 0, failed: 0 };

  for (const hunt of hunts ?? []) {
    const window = readHuntWindow(hunt);
    if (!window) continue;
    totals.hunts_open++;

    const { data: finds, error: findsError } = await supabase
      .from("finds")
      .select("id, release_at")
      .eq("hunt_id", hunt.id)
      .is("deleted_at", null);
    if (findsError) {
      totals.failed++;
      continue;
    }
    const due = dueNotices(
      { title: String(hunt.title ?? "your hunt"), metadata: (hunt.metadata as Record<string, unknown> | null) ?? null },
      window,
      (finds ?? []).map((f) => (f.release_at as string | null) ?? null),
      nowMs
    );
    if (due.length === 0) continue;
    totals.notices_due += due.length;

    // Everyone in the hunt: an active play session. Nothing else is read about them.
    const { data: sessions, error: sessionsError } = await supabase
      .from("play_sessions")
      .select("user_id")
      .eq("hunt_id", hunt.id)
      .eq("status", "active")
      .limit(MAX_PLAYERS_PER_HUNT);
    if (sessionsError) {
      totals.failed++;
      continue;
    }
    const playerIds = [...new Set((sessions ?? []).map((s) => s.user_id as string))];
    if (playerIds.length === 0) continue;

    const [{ data: prefRows }, { data: userRows }] = await Promise.all([
      supabase.from("notification_preferences").select("user_id, push_enabled, email_enabled, disabled_types").in("user_id", playerIds),
      supabase.from("users").select("id, email").in("id", playerIds),
    ]);
    const prefs = new Map((prefRows ?? []).map((p) => [p.user_id as string, p as NoticePreferences]));
    const emails = new Map((userRows ?? []).map((u) => [u.id as string, (u.email as string | null) ?? null]));

    for (const notice of due) {
      for (const id of playerIds) {
        const outcome = await sendOnce(supabase, hunt.id as string, { id, email: emails.get(id) ?? null, prefs: prefs.get(id) ?? null }, notice);
        totals[outcome]++;
      }
    }
  }

  return Response.json(totals);
}
