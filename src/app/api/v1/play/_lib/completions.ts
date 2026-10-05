import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";

/**
 * find_completions access for the play routes.
 *
 * A player should have one row per (play_session_id, find_id), but the table
 * had no unique constraint before migration 069, so concurrent requests could
 * insert two. These helpers never use `.maybeSingle()` on that pair: they pick
 * one canonical row, and treat a unique violation on insert as "already there".
 */

const COMPLETION_COLUMNS =
  "id, arrived_at, completed_at, hints_used, clue_hints_used, metadata, created_at";

const UNIQUE_VIOLATION = "23505";

export interface CompletionRow {
  id: string;
  arrived_at: string | null;
  completed_at: string | null;
  hints_used: number | null;
  clue_hints_used: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** The furthest-along row for this stop, or null if the player has none. */
export async function getCompletion(
  supabase: SupabaseClient,
  sessionId: string,
  findId: string
): Promise<CompletionRow | null> {
  const { data, error } = await supabase
    .from("find_completions")
    .select(COMPLETION_COLUMNS)
    .eq("play_session_id", sessionId)
    .eq("find_id", findId)
    .order("created_at", { ascending: true });

  if (error) throw new ApiError(500, error.message);

  const rows = (data || []) as CompletionRow[];
  return (
    rows.find((r) => r.completed_at) ??
    rows.find((r) => r.arrived_at) ??
    rows[0] ??
    null
  );
}

/**
 * Insert a completion row. If another request created it first (unique
 * violation), return that row instead of failing.
 */
export async function insertCompletion(
  supabase: SupabaseClient,
  sessionId: string,
  findId: string,
  values: Record<string, unknown>
): Promise<{ row: CompletionRow; created: boolean }> {
  const { data, error } = await supabase
    .from("find_completions")
    .insert({ play_session_id: sessionId, find_id: findId, ...values })
    .select(COMPLETION_COLUMNS)
    .single();

  if (!error && data) return { row: data as CompletionRow, created: true };

  if (error?.code === UNIQUE_VIOLATION) {
    const existing = await getCompletion(supabase, sessionId, findId);
    if (existing) return { row: existing, created: false };
  }
  throw new ApiError(500, error?.message || "Failed to record progress");
}
