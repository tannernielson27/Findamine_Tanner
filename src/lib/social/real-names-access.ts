/**
 * Server side of real names on the leaderboard (issue #13): reading the names
 * for a set of players, and recording that someone viewed them.
 *
 * Callers must already have checked canViewRealNames and realNamesRequested
 * (lib/social/real-names). Nothing here decides who is allowed.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/app/api/v1/admin/_lib/audit";
import { logger } from "@/lib/utils/logger";
import {
  isRealNameStaff,
  resolveRealName,
  withRealNames,
  type RealNameFields,
  type RealNameSubject,
  type RealNameViewer,
  type WithRealName,
} from "./real-names";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** audit_log.entity_type for a view of real names on a leaderboard. */
export const REAL_NAMES_AUDIT_ENTITY = "leaderboard_real_names";

/**
 * An open board refetches every few seconds. One audit row is written per
 * viewer and board for each window of this length in which real names were
 * served, so the trail shows who looked, where and for how long without a row
 * per refetch.
 */
export const REAL_NAMES_AUDIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Real names for these players, keyed by user id. Reads only what decides a
 * real name (role, date of birth, age band, profile metadata, deleted flag):
 * never email. A failed read yields no names rather than failing the board.
 */
export async function loadRealNames(
  supabase: ServiceClient,
  userIds: readonly string[],
  now: number = Date.now()
): Promise<Map<string, RealNameFields>> {
  const names = new Map<string, RealNameFields>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return names;

  const [users, profiles] = await Promise.all([
    supabase.from("users").select("id, role, date_of_birth, metadata, deleted_at").in("id", ids),
    // The stored age band is one of the three under-18 signals (see isMinor).
    supabase.from("user_profiles").select("user_id, effective_band").in("user_id", ids),
  ]);
  // Without both reads an under-18 player could be missed: return no names.
  const failed = users.error ?? profiles.error;
  if (failed) {
    logger.error("leaderboard.real_names.read_failed", { error: failed.message });
    return names;
  }

  const bands = new Map<string, string | null>(
    (profiles.data || []).map((p) => [p.user_id as string, (p.effective_band as string | null) ?? null])
  );
  for (const row of users.data || []) {
    const subject: RealNameSubject = { ...(row as RealNameSubject), effective_band: bands.get(row.id as string) ?? null };
    names.set(row.id as string, resolveRealName(subject, now));
  }
  return names;
}

export interface RealNamesView {
  viewer: RealNameViewer;
  /** The hunt whose board was viewed; null for the overall board. */
  huntId: string | null;
  /** Rows on the board that was returned. */
  rows: number;
  /** How many of those rows carried a real name. */
  namesReturned: number;
}

export interface RealNamesBoardRequest {
  viewer: RealNameViewer;
  /** The hunt whose board this is; null for the overall board. */
  huntId: string | null;
  /** Per player: the name other players see (see WithRealName.shown_as). */
  shownAs: ReadonlyMap<string, string>;
}

/**
 * The board an allowed viewer gets when they ask for real names: the same
 * rows, each with its real-name fields, plus `real_names: true`. Records the
 * view. Returns a new object; `board` is left as it was.
 */
export async function boardWithRealNames<T extends { user_id: string }, B extends { entries: T[] }>(
  supabase: ServiceClient,
  board: B,
  { viewer, huntId, shownAs }: RealNamesBoardRequest
): Promise<Omit<B, "entries"> & { entries: WithRealName<T>[]; real_names: true }> {
  const names = await loadRealNames(supabase, board.entries.map((entry) => entry.user_id));
  const entries = withRealNames(board.entries, names, shownAs);
  await recordRealNamesViewed(supabase, {
    viewer,
    huntId,
    rows: entries.length,
    namesReturned: entries.filter((entry) => entry.real_name !== null).length,
  });
  return { ...board, entries, real_names: true };
}

/** Real names are personal data for one viewer: never store or share the response. */
export const REAL_NAMES_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;

/**
 * Record that real names were viewed: who, which board, and how many. The
 * names themselves, and which players they belong to, are not recorded.
 * Best effort, like every audit write here: a failure is logged and the board
 * still loads.
 */
export async function recordRealNamesViewed(
  supabase: ServiceClient,
  view: RealNamesView,
  now: number = Date.now()
): Promise<void> {
  const { viewer, huntId } = view;
  try {
    const since = new Date(now - REAL_NAMES_AUDIT_WINDOW_MS).toISOString();
    const mine = supabase
      .from("audit_log")
      .select("id")
      .eq("user_id", viewer.id)
      .eq("entity_type", REAL_NAMES_AUDIT_ENTITY)
      .gte("created_at", since);
    const { data: already, error: lookupError } = await (
      huntId ? mine.eq("entity_id", huntId) : mine.is("entity_id", null)
    ).limit(1);
    if (lookupError) {
      // Can't tell whether this view is already on record: record it again
      // rather than risk leaving it out.
      logger.warn("leaderboard.real_names.audit_lookup_failed", { viewerId: viewer.id, huntId, error: lookupError.message });
    }
    if (already && already.length > 0) return;

    const basis = isRealNameStaff(viewer.role) ? "staff" : "hunt_creator";
    logger.info("leaderboard.real_names.viewed", { viewerId: viewer.id, huntId, basis });
    await writeAudit(supabase, {
      user_id: viewer.id,
      // audit_log only accepts create | update | delete; the operation is in new_values.op.
      action: "update",
      entity_type: REAL_NAMES_AUDIT_ENTITY,
      entity_id: huntId,
      new_values: {
        op: "real_names_viewed",
        board: huntId ? "hunt" : "overall",
        basis,
        viewer_role: viewer.role,
        rows: view.rows,
        names_returned: view.namesReturned,
      },
    });
  } catch (error) {
    logger.error("leaderboard.real_names.audit_failed", {
      viewerId: viewer.id,
      huntId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
