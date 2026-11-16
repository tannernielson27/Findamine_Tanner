import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import {
  checkStopAccess,
  orderIndexFor,
  readClueDelivery,
  readClueOrders,
  sessionStopOrder,
} from "@/lib/play/clue-delivery";

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

export interface StopAccessInput {
  huntId: string;
  userId: string;
  session: SessionRef;
  findId: string;
  route: string;
}

export const OUT_OF_ORDER_MESSAGE = "That stop isn't open yet. Finish your current stop first.";

async function loadSessionMetadata(supabase: SupabaseClient, session: SessionRef, route: string) {
  if (session.metadata !== undefined) return session.metadata;
  const { data, error } = await supabase.from("play_sessions").select("metadata").eq("id", session.id).maybeSingle();
  if (error) throw internalError(route, error);
  return (data?.metadata as Record<string, unknown> | null) ?? null;
}

/** Throws 404 for a stop outside the hunt, 409 for one out of order. */
export async function assertStopOpen(supabase: SupabaseClient, input: StopAccessInput): Promise<void> {
  const { huntId, userId, session, findId, route } = input;

  const [huntRes, findsRes, completionsRes, sessionMetadata] = await Promise.all([
    supabase.from("hunts").select("metadata").eq("id", huntId).maybeSingle(),
    supabase.from("finds").select("id, sort_order").eq("hunt_id", huntId).is("deleted_at", null),
    supabase.from("find_completions").select("find_id, completed_at").eq("play_session_id", session.id),
    loadSessionMetadata(supabase, session, route),
  ]);
  for (const res of [huntRes, findsRes, completionsRes]) {
    if (res.error) throw internalError(route, res.error);
  }

  const huntMetadata = (huntRes.data?.metadata as Record<string, unknown> | null) ?? null;
  const mode = readClueDelivery(huntMetadata);
  const orderCount = readClueOrders(huntMetadata).length;
  const orderIndex = mode === "assigned_order" ? orderIndexFor(sessionMetadata, { userId, huntId, orderCount }) : null;

  const finds = (findsRes.data ?? []) as { id: string; sort_order: number | null }[];
  const ordered = sessionStopOrder(finds, { huntMetadata, sessionId: session.id, orderIndex });
  const completed = (completionsRes.data ?? []) as { find_id: string; completed_at: string | null }[];
  const completedIds = new Set(completed.filter((c) => c.completed_at).map((c) => c.find_id));

  const access = checkStopAccess({ mode, orderedIds: ordered.map((f) => f.id), completedIds, findId });
  if (access.ok) return;
  if (access.reason === "not_in_hunt") throw new ApiError(404, "Find not found");
  throw new ApiError(409, OUT_OF_ORDER_MESSAGE);
}
