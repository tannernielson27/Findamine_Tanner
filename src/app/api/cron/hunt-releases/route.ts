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
 * hunt_schedule_notices (migration 087) and sent once. A notice covers the
 * stops released since that player's last one (or since they joined), so a
 * run once a day announces the day's releases in one notice, and a run every
 * few minutes announces each release as it happens.
 *
 * If a player's settings can't be read, nobody in that hunt is notified on
 * this run: a mute is never overridden by a failed read. The next run retries.
 *
 * CRON_SECRET auth, same pattern as the other crons.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/services/email";
import { fetchAllByIds, fetchAllRows } from "@/lib/utils/paginate";
import { readHuntWindow, readScheduleTimeZone, type HuntWindow } from "@/lib/hunts/schedule";
import {
  HUNT_ENDING_TYPE,
  HUNT_NOTICE_ENTITY,
  HUNT_RELEASE_TYPE,
  RELEASE_LOOKBACK_MS,
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
/** Most hunts looked at in one run, oldest window first. */
const MAX_HUNTS = 50;
/** Records and notifications are written this many at a time. */
const WRITE_BATCH = 200;
/** Emails sent at once. */
const EMAIL_CONCURRENCY = 10;
/** Stop starting new work this long into the run, well inside maxDuration. */
const TIME_BUDGET_MS = 45_000;
const UNIQUE_VIOLATION = "23505";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

interface Pending {
  userId: string;
  kind: "release" | "ending_soon";
  type: string;
  /** The moment the notice is about, as stored in hunt_schedule_notices.due_at. */
  dueAt: string;
  message: NoticeMessage;
  email: string | null;
}

interface Totals {
  hunts_open: number;
  sent: number;
  already: number;
  muted: number;
  failed: number;
  stopped_early: boolean;
}

interface OpenHunt {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
  window: HuntWindow;
}

/** Everything the run needs to know about one hunt's players, or a thrown error. */
async function loadPlayers(supabase: ServiceClient, huntId: string, nowMs: number) {
  // Everyone in the hunt: an active play session. Nothing else is read about them.
  const sessions = await fetchAllRows<{ user_id: string; started_at: string | null }>((from, to) =>
    supabase
      .from("play_sessions")
      .select("user_id, started_at")
      .eq("hunt_id", huntId)
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to)
  );
  const joinedAt = new Map<string, number>();
  for (const s of sessions) {
    const at = s.started_at ? Date.parse(s.started_at) : Number.NaN;
    const known = joinedAt.get(s.user_id);
    joinedAt.set(s.user_id, Math.min(known ?? Infinity, Number.isFinite(at) ? at : -Infinity));
  }
  const playerIds = [...joinedAt.keys()];
  if (playerIds.length === 0) return null;

  const [prefRows, userRows, sentRows] = await Promise.all([
    fetchAllByIds<NoticePreferences & { user_id: string }>(playerIds, (ids, from, to) =>
      supabase
        .from("notification_preferences")
        .select("user_id, push_enabled, email_enabled, disabled_types")
        .in("user_id", ids)
        .order("user_id", { ascending: true })
        .range(from, to)
    ),
    fetchAllByIds<{ id: string; email: string | null }>(playerIds, (ids, from, to) =>
      supabase.from("users").select("id, email").in("id", ids).order("id", { ascending: true }).range(from, to)
    ),
    // What this hunt's players were already told, as far back as a release can still be announced.
    fetchAllRows<{ user_id: string; kind: string; due_at: string }>((from, to) =>
      supabase
        .from("hunt_schedule_notices")
        .select("user_id, kind, due_at")
        .eq("hunt_id", huntId)
        .gt("due_at", new Date(nowMs - RELEASE_LOOKBACK_MS).toISOString())
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const lastRelease = new Map<string, number>();
  const toldEnding = new Set<string>();
  for (const row of sentRows) {
    if (row.kind === "ending_soon") toldEnding.add(`${row.user_id}|${new Date(row.due_at).toISOString()}`);
    if (row.kind === "release") lastRelease.set(row.user_id, Math.max(lastRelease.get(row.user_id) ?? -Infinity, Date.parse(row.due_at)));
  }
  return {
    playerIds,
    joinedAt,
    prefs: new Map(prefRows.map((p) => [p.user_id, p as NoticePreferences])),
    emails: new Map(userRows.map((u) => [u.id, u.email ?? null])),
    lastRelease,
    toldEnding,
  };
}

/** The notices owed to one hunt's players right now, and how many were muted by their own settings. */
function pendingFor(
  hunt: OpenHunt,
  releases: ReadonlyArray<string | null>,
  players: NonNullable<Awaited<ReturnType<typeof loadPlayers>>>,
  nowMs: number
): { pending: Pending[]; muted: number; already: number } {
  const pending: Pending[] = [];
  let muted = 0;
  let already = 0;
  const ending = dueEndingNotice(hunt.window, nowMs);
  const endingDueAt = ending ? new Date(ending.dueAtMs).toISOString() : null;
  const anyRelease = dueReleaseNotice(hunt.window, releases, nowMs);

  for (const userId of players.playerIds) {
    const prefs = players.prefs.get(userId) ?? null;
    const email = players.emails.get(userId) ?? null;

    if (anyRelease) {
      // Only what opened since this player's last notice, and since they joined.
      const afterMs = Math.max(players.lastRelease.get(userId) ?? -Infinity, players.joinedAt.get(userId) ?? -Infinity);
      const release = dueReleaseNotice(hunt.window, releases, nowMs, { afterMs });
      if (!release) already++;
      else if (!mayNotify(prefs, HUNT_RELEASE_TYPE)) muted++;
      else {
        pending.push({
          userId, kind: "release", type: HUNT_RELEASE_TYPE, dueAt: new Date(release.dueAtMs).toISOString(),
          message: releaseMessage(hunt.title, release.stopCount), email: mayEmail(prefs, HUNT_RELEASE_TYPE) ? email : null,
        });
      }
    }

    if (endingDueAt) {
      if (players.toldEnding.has(`${userId}|${endingDueAt}`)) already++;
      else if (!mayNotify(prefs, HUNT_ENDING_TYPE)) muted++;
      else {
        pending.push({
          userId, kind: "ending_soon", type: HUNT_ENDING_TYPE, dueAt: endingDueAt,
          message: endingMessage(hunt.title, hunt.window, readScheduleTimeZone(hunt.metadata)),
          email: mayEmail(prefs, HUNT_ENDING_TYPE) ? email : null,
        });
      }
    }
  }
  return { pending, muted, already };
}

const recordOf = (huntId: string, p: Pending) => ({ hunt_id: huntId, user_id: p.userId, kind: p.kind, due_at: p.dueAt });

/**
 * Records a batch as sent, which is what makes each notice go out once. A
 * clash means another run got to some of them first: those are skipped.
 */
async function claim(supabase: ServiceClient, huntId: string, batch: Pending[]): Promise<{ claimed: Pending[]; already: number; failed: number }> {
  const { error } = await supabase.from("hunt_schedule_notices").insert(batch.map((p) => recordOf(huntId, p)));
  if (!error) return { claimed: batch, already: 0, failed: 0 };
  if (error.code !== UNIQUE_VIOLATION) return { claimed: [], already: 0, failed: batch.length };

  const claimed: Pending[] = [];
  let already = 0;
  let failed = 0;
  for (const p of batch) {
    const { error: rowError } = await supabase.from("hunt_schedule_notices").insert(recordOf(huntId, p));
    if (!rowError) claimed.push(p);
    else if (rowError.code === UNIQUE_VIOLATION) already++;
    else failed++;
  }
  return { claimed, already, failed };
}

/** Takes back the records of notices that could not be written, so a later run sends them. */
async function release(supabase: ServiceClient, huntId: string, batch: Pending[]): Promise<void> {
  for (const p of batch) {
    await supabase
      .from("hunt_schedule_notices")
      .delete()
      .eq("hunt_id", huntId)
      .eq("user_id", p.userId)
      .eq("kind", p.kind)
      .eq("due_at", p.dueAt);
  }
}

async function sendBatch(supabase: ServiceClient, huntId: string, batch: Pending[], totals: Totals): Promise<void> {
  const { claimed, already, failed } = await claim(supabase, huntId, batch);
  totals.already += already;
  totals.failed += failed;
  if (claimed.length === 0) return;

  const { error } = await supabase.from("notifications").insert(
    claimed.map((p) => ({
      user_id: p.userId,
      type: p.type,
      title: p.message.title,
      body: p.message.body,
      entity_type: HUNT_NOTICE_ENTITY,
      entity_id: huntId,
    }))
  );
  if (error) {
    await release(supabase, huntId, claimed);
    totals.failed += claimed.length;
    return;
  }
  totals.sent += claimed.length;

  // Email is the fallback for players who asked for it. A failed email is not
  // retried: the in-app notice is already there.
  const link = `${SITE_URL}${huntNoticeHref(HUNT_NOTICE_ENTITY, huntId)}`;
  const emails = claimed.filter((p) => p.email);
  for (let i = 0; i < emails.length; i += EMAIL_CONCURRENCY) {
    await Promise.allSettled(
      emails.slice(i, i + EMAIL_CONCURRENCY).map((p) =>
        sendEmail({ to: p.email as string, subject: p.message.title, html: noticeEmailHtml(p.message, link) })
      )
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();
  const startedMs = Date.now();
  const nowMs = startedMs;
  const nowIso = new Date(nowMs).toISOString();
  const outOfTime = () => Date.now() - startedMs > TIME_BUDGET_MS;

  // Hunts whose window is open right now.
  const { data: huntRows, error: huntsError } = await supabase
    .from("hunts")
    .select("id, title, status, metadata, starts_at, ends_at")
    .in("status", PLAYABLE_STATUSES)
    .is("deleted_at", null)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(MAX_HUNTS);
  if (huntsError) {
    console.error("hunt-releases: hunts read failed:", huntsError.message);
    return Response.json({ error: "Could not read hunts" }, { status: 500 });
  }

  const totals: Totals = { hunts_open: 0, sent: 0, already: 0, muted: 0, failed: 0, stopped_early: false };

  for (const row of huntRows ?? []) {
    const window = readHuntWindow(row);
    if (!window) continue;
    totals.hunts_open++;
    if (outOfTime()) {
      totals.stopped_early = true;
      break;
    }
    const hunt: OpenHunt = {
      id: row.id as string,
      title: String(row.title ?? "your hunt"),
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      window,
    };

    try {
      const { data: finds, error: findsError } = await supabase
        .from("finds")
        .select("id, release_at")
        .eq("hunt_id", hunt.id)
        .is("deleted_at", null);
      if (findsError) throw new Error(findsError.message);
      const releases = (finds ?? []).map((f) => (f.release_at as string | null) ?? null);
      // Nothing opened lately and the end is not near: no need to look at the players.
      if (!dueReleaseNotice(window, releases, nowMs) && !dueEndingNotice(window, nowMs)) continue;

      const players = await loadPlayers(supabase, hunt.id, nowMs);
      if (!players) continue;
      const { pending, muted, already } = pendingFor(hunt, releases, players, nowMs);
      totals.muted += muted;
      totals.already += already;

      for (let i = 0; i < pending.length; i += WRITE_BATCH) {
        if (outOfTime()) {
          totals.stopped_early = true;
          break;
        }
        await sendBatch(supabase, hunt.id, pending.slice(i, i + WRITE_BATCH), totals);
      }
    } catch (err) {
      // A failed read (settings included) sends nothing for this hunt on this run.
      console.error("hunt-releases: skipped a hunt:", err instanceof Error ? err.message : String(err));
      totals.failed++;
    }
    if (totals.stopped_early) break;
  }

  return Response.json(totals);
}
