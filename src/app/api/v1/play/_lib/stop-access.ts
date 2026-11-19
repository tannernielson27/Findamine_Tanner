import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import { fullDeliveryMetadata } from "@/lib/hunts/clue-orders-store";
import {
  checkStopAccess,
  orderIndexFor,
  readClueDelivery,
  readClueOrders,
  sessionStopOrder,
  type ClueDelivery,
} from "@/lib/play/clue-delivery";
import { readNavigationHelp, type NavigationHelp } from "@/lib/play/navigation-help";

/**
 * Server-side clue delivery (lib/play/clue-delivery.ts) for the play routes
 * that start or advance work on a stop: the stop must be a live stop of this
 * hunt and, unless the hunt hands out all clues at once, the player's current
 * stop in their order (or one they already finished). The UI follows the same
 * order; this stops a crafted request from skipping ahead.
 */

interface SessionRef {
  id: string;
  metadata?: Record<string, unknown> | null;
}

export interface SessionStopsInput {
  huntId: string;
  userId: string;
  session: SessionRef;
  route: string;
}

export interface StopAccessInput extends SessionStopsInput {
  findId: string;
}

interface StopRow {
  id: string;
  sort_order: number | null;
}

/** One stop's progress in a session (the furthest-along row when there are duplicates). */
export interface StopProgress {
  find_id: string;
  started_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SessionStops<F extends StopRow> {
  mode: ClueDelivery;
  /** How much navigation help the hunt gives (lib/play/navigation-help). */
  navigationHelp: NavigationHelp;
  /** The hunt's live stops in the order this session plays them. */
  ordered: F[];
  progress: Map<string, StopProgress>;
  completedIds: Set<string>;
  /** May the player start or work on this stop now? (lib/play/clue-delivery checkStopAccess) */
  isOpen: (findId: string) => boolean;
}

export const OUT_OF_ORDER_MESSAGE = "That stop isn't open yet. Finish your current stop first.";

const BASE_FIND_COLUMNS = "id, sort_order";
const PROGRESS_COLUMNS = "find_id, started_at, arrived_at, completed_at, created_at";

async function loadSessionMetadata(supabase: SupabaseClient, session: SessionRef, route: string) {
  if (session.metadata !== undefined) return session.metadata;
  const { data, error } = await supabase.from("play_sessions").select("metadata").eq("id", session.id).maybeSingle();
  if (error) throw internalError(route, error);
  return (data?.metadata as Record<string, unknown> | null) ?? null;
}

const rank = (row: StopProgress): number => (row.completed_at ? 2 : row.arrived_at ? 1 : 0);

/** One entry per stop: completed beats arrived beats the oldest row (see completions.ts). */
function progressByStop(rows: ReadonlyArray<StopProgress>): Map<string, StopProgress> {
  const byStop = new Map<string, StopProgress>();
  const oldestFirst = [...rows].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  for (const row of oldestFirst) {
    const kept = byStop.get(row.find_id);
    if (!kept || rank(row) > rank(kept)) byStop.set(row.find_id, row);
  }
  return byStop;
}

/**
 * The session's stops in play order with the player's progress on each.
 * `findColumns` lets a caller load more than the ids (the stops route).
 */
export async function loadSessionStops<F extends StopRow = StopRow>(
  supabase: SupabaseClient,
  input: SessionStopsInput,
  findColumns: string = BASE_FIND_COLUMNS
): Promise<SessionStops<F>> {
  const { huntId, userId, session, route } = input;

  const [huntRes, findsRes, completionsRes, sessionMetadata] = await Promise.all([
    supabase.from("hunts").select("metadata").eq("id", huntId).maybeSingle(),
    supabase.from("finds").select(findColumns).eq("hunt_id", huntId).is("deleted_at", null),
    supabase.from("find_completions").select(PROGRESS_COLUMNS).eq("play_session_id", session.id),
    loadSessionMetadata(supabase, session, route),
  ]);
  for (const res of [huntRes, findsRes, completionsRes]) {
    if (res.error) throw internalError(route, res.error);
  }

  const huntMetadata = await fullDeliveryMetadata(supabase, { id: huntId, metadata: huntRes.data?.metadata }, route);
  const mode = readClueDelivery(huntMetadata);
  const orderCount = readClueOrders(huntMetadata).length;
  const orderIndex = mode === "assigned_order" ? orderIndexFor(sessionMetadata, { userId, huntId, orderCount }) : null;

  const finds = (findsRes.data ?? []) as unknown as F[];
  const ordered = sessionStopOrder(finds, { huntMetadata, sessionId: session.id, orderIndex });
  const orderedIds = ordered.map((f) => f.id);
  const progress = progressByStop((completionsRes.data ?? []) as unknown as StopProgress[]);
  const completedIds = new Set([...progress.values()].filter((c) => c.completed_at).map((c) => c.find_id));

  return {
    mode,
    navigationHelp: readNavigationHelp(huntMetadata),
    ordered,
    progress,
    completedIds,
    isOpen: (findId) => checkStopAccess({ mode, orderedIds, completedIds, findId }).ok,
  };
}

/** What a route learns about the hunt while checking that a stop is open. */
export interface OpenStop {
  navigationHelp: NavigationHelp;
}

/** Throws 404 for a stop outside the hunt, 409 for one out of order. */
export async function assertStopOpen(supabase: SupabaseClient, input: StopAccessInput): Promise<OpenStop> {
  const { mode, navigationHelp, ordered, completedIds } = await loadSessionStops(supabase, input);
  const access = checkStopAccess({ mode, orderedIds: ordered.map((f) => f.id), completedIds, findId: input.findId });
  if (access.ok) return { navigationHelp };
  if (access.reason === "not_in_hunt") throw new ApiError(404, "Find not found");
  throw new ApiError(409, OUT_OF_ORDER_MESSAGE);
}
