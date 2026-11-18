import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { getCompletion, insertCompletion, type CompletionRow } from "./completions";

/**
 * Starting a stop (issue #16).
 *
 * A stop's clue, map position, distance, hot/cold reading and place name are
 * released only once the player starts it ("I'm ready"). The start is timed on
 * the server in find_completions.started_at (migration 084): set once, never
 * overwritten, so a reload or a retried request can't restart the clock.
 *
 * A stop is started exactly when the session has a completion row for it:
 * rows are only created here, and before migration 084 they were only created
 * by the primer's "I'm ready", a clue hint or an arrival, all of which meant
 * the player had already seen the stop. That is why a stop from a session that
 * was in progress when this shipped (arrived at, completed, or mid-way) counts
 * as started without being started again.
 */

export const NOT_STARTED_MESSAGE =
  "This stop hasn't been started yet. Reopen the hunt and tap \"I'm ready\" to begin it.";

type StartFields = Pick<CompletionRow, "started_at" | "arrived_at" | "created_at">;

/**
 * When the player started the stop, or null when they have not. Falls back to
 * the arrival, then the row's creation, for rows written before started_at was
 * recorded (the same rule as the backfill in migration 084).
 */
export function stopStartedAt(row: StartFields | null | undefined): string | null {
  if (!row) return null;
  return row.started_at ?? row.arrived_at ?? row.created_at ?? null;
}

export interface StartedStop {
  completion: CompletionRow;
  startedAt: string;
  /** True when the stop was started by an earlier call: nothing was written. */
  alreadyStarted: boolean;
}

function alreadyStarted(completion: CompletionRow, fallback: string): StartedStop {
  return { completion, startedAt: stopStartedAt(completion) ?? fallback, alreadyStarted: true };
}

/**
 * Starts the stop for this session, once. The caller must already have checked
 * that the session is the player's own and that their clue order allows the
 * stop (assertStopOpen). `primerRead` also stamps the existing
 * `prime_viewed_at` telemetry for stops that have a primer.
 */
export async function startStop(
  supabase: SupabaseClient,
  sessionId: string,
  findId: string,
  opts: { primerRead: boolean }
): Promise<StartedStop> {
  const existing = await getCompletion(supabase, sessionId, findId);
  if (existing) return alreadyStarted(existing, existing.created_at);

  const startedAt = new Date().toISOString();
  const inserted = await insertCompletion(supabase, sessionId, findId, {
    started_at: startedAt,
    metadata: opts.primerRead ? { prime_viewed_at: startedAt } : {},
  });
  // Lost a race with another request for the same stop: its start stands.
  if (!inserted.created) return alreadyStarted(inserted.row, startedAt);
  return { completion: inserted.row, startedAt, alreadyStarted: false };
}

/**
 * The player's completion row for a stop they have started. Throws 409 when
 * they have not, so no route hands out a stop's details (hints, distance,
 * hot/cold zone) or records progress on it before its clock is running.
 */
export async function assertStopStarted(
  supabase: SupabaseClient,
  sessionId: string,
  findId: string
): Promise<CompletionRow> {
  const completion = await getCompletion(supabase, sessionId, findId);
  if (!completion) throw new ApiError(409, NOT_STARTED_MESSAGE);
  return completion;
}
