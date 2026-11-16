/**
 * Builds the ActiveHunt contract (lib/play/active-hunt.ts) from play rows.
 *
 * An unfinished hunt is a play_sessions row with status 'active' (the only
 * unfinished status the play routes write; 'paused' is never set). A player
 * can have one active session per hunt, so several hunts can be in progress
 * at once: the one with the latest activity wins. Activity is the latest of
 * the session's own timestamps and its stop arrivals/completions, because
 * recording a stop writes find_completions and need not touch the session.
 *
 * Pure: no I/O, unit tested directly.
 */

import type { ActiveHunt } from "@/lib/play/active-hunt";
import { readClueDelivery, sessionStopOrder } from "@/lib/play/clue-delivery";

/** Hunt statuses the start route lets a player resume (mirrors play/[huntId]/start). */
export const PLAYABLE_HUNT_STATUSES: readonly string[] = ["published", "enrollment_open", "in_progress"];

export interface SessionRow {
  id: string;
  hunt_id: string;
  started_at: string | null;
  updated_at: string | null;
  /** Holds the assigned clue order group (`clue_order_index`). */
  metadata?: Record<string, unknown> | null;
}

export interface CompletionRow {
  play_session_id: string;
  find_id: string;
  arrived_at: string | null;
  completed_at: string | null;
  created_at: string | null;
}

export interface FindRow {
  id: string;
  sort_order: number | null;
}

export interface ActiveHuntSource {
  id: string;
  title: string;
  cover_image_url?: string | null;
  /** Hunt metadata; clue delivery (lib/play/clue-delivery) changes which stop is current. */
  metadata?: Record<string, unknown> | null;
}

function latest(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

/** The session's last activity as an ISO string, or null when nothing is dated. */
export function lastActivity(session: SessionRow, completions: ReadonlyArray<CompletionRow>): string | null {
  const own = completions.filter((c) => c.play_session_id === session.id);
  return latest([
    session.updated_at,
    session.started_at,
    ...own.flatMap((c) => [c.arrived_at, c.completed_at, c.created_at]),
  ]);
}

/** Sessions ordered most recent activity first (undated ones last). */
export function rankSessions(
  sessions: ReadonlyArray<SessionRow>,
  completions: ReadonlyArray<CompletionRow>
): Array<SessionRow & { lastActiveAt: string | null }> {
  return sessions
    .map((s) => ({ ...s, lastActiveAt: lastActivity(s, completions) }))
    .sort((a, b) => {
      const am = a.lastActiveAt ? Date.parse(a.lastActiveAt) : -Infinity;
      const bm = b.lastActiveAt ? Date.parse(b.lastActiveAt) : -Infinity;
      return bm - am;
    });
}

/**
 * Stop counts for one session. Only live stops count (a stop deleted after it
 * was finished no longer does), a stop is finished when its completion has
 * completed_at, and the current stop is the first unfinished one in the
 * session's stop order (see lib/play/clue-delivery), matching where the play
 * page resumes. With all clues open at once there is no fixed next stop, so
 * the current stop is the count of finished ones plus one.
 */
export function buildActiveHunt(
  hunt: ActiveHuntSource,
  sessionId: string,
  finds: ReadonlyArray<FindRow>,
  completions: ReadonlyArray<CompletionRow>,
  lastActiveAt: string | null,
  /** The session's assigned order group (assigned_order hunts only). */
  orderIndex: number | null = null
): ActiveHunt {
  const ordered = sessionStopOrder(finds, { huntMetadata: hunt.metadata, sessionId, orderIndex });
  const done = new Set(
    completions.filter((c) => c.play_session_id === sessionId && c.completed_at).map((c) => c.find_id)
  );
  const totalStops = ordered.length;
  const completedStops = ordered.filter((f) => done.has(f.id)).length;
  const firstOpen = ordered.findIndex((f) => !done.has(f.id));
  const position = readClueDelivery(hunt.metadata) === "all_at_once" ? completedStops : firstOpen;
  const currentStop = firstOpen >= 0 ? position + 1 : Math.max(1, totalStops);

  return {
    huntId: hunt.id,
    title: hunt.title,
    currentStop,
    totalStops,
    completedStops,
    href: `/play/${hunt.id}`,
    coverImageUrl: hunt.cover_image_url ?? null,
    lastActiveAt,
  };
}
