import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompletion, insertCompletion, type CompletionRow } from "./completions";
import { internalError } from "@/lib/utils/internal-error";

/**
 * How an arrival was confirmed:
 *   gps      — an automatic GPS ping landed inside the radius
 *   gps_tap  — the player tapped "I'm here" and a fresh fix was inside the radius
 *   photo    — location was off or too vague, so the player took a photo at the
 *              stop instead. Not location-checked; flagged for admin review.
 */
export type ArrivalMethod = "gps" | "gps_tap" | "photo";

export interface ArrivalMetadata {
  arrival_lat: number | null;
  arrival_lng: number | null;
  arrival_distance: number | null;
  arrival_accuracy: number | null;
  arrival_method: ArrivalMethod;
  /** True when the arrival was not confirmed by location (kept for old readers). */
  arrival_manual: boolean;
  /** "pending" when an admin should look at it. */
  arrival_review?: "pending";
  arrival_photo_id?: string;
}

export interface RecordedArrival {
  completion: CompletionRow;
  created: boolean;
  alreadyArrived: boolean;
}

/**
 * Stamps the arrival on the player's completion row for this stop, creating
 * the row if needed. A stop that was already arrived at is left untouched.
 */
export async function recordArrival(
  supabase: SupabaseClient,
  sessionId: string,
  findId: string,
  arrival: ArrivalMetadata,
  route: string
): Promise<RecordedArrival> {
  const existing = await getCompletion(supabase, sessionId, findId);

  if (!existing) {
    const inserted = await insertCompletion(supabase, sessionId, findId, {
      arrived_at: new Date().toISOString(),
      metadata: arrival,
    });
    // Lost a race: the other request's row may already carry an arrival.
    if (!inserted.created && inserted.row.arrived_at) {
      return { completion: inserted.row, created: false, alreadyArrived: true };
    }
    if (inserted.created) return { completion: inserted.row, created: true, alreadyArrived: false };
    return stamp(supabase, inserted.row, arrival, route);
  }

  if (existing.arrived_at) return { completion: existing, created: false, alreadyArrived: true };
  // A row already exists from the primer or a clue hint: stamp the arrival.
  return stamp(supabase, existing, arrival, route);
}

async function stamp(
  supabase: SupabaseClient,
  row: CompletionRow,
  arrival: ArrivalMetadata,
  route: string
): Promise<RecordedArrival> {
  const arrivedAt = new Date().toISOString();
  const metadata = { ...(row.metadata || {}), ...arrival };
  const { error } = await supabase
    .from("find_completions")
    .update({ arrived_at: arrivedAt, metadata })
    .eq("id", row.id);
  if (error) throw internalError(route, error);
  return { completion: { ...row, arrived_at: arrivedAt, metadata }, created: false, alreadyArrived: false };
}
