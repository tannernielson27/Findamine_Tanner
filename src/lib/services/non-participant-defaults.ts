/**
 * Write the private-leaning starting privacy map for a user outside the study
 * (see lib/utils/non-participant-defaults.ts for the why).
 *
 * Runs from the (app) layout after enrollment. Only touches a user whose map
 * is still empty AND who has no study_enrollments row: an enrolled participant
 * in the neutral condition has an intentionally empty map and must keep it.
 * Never throws — a failure leaves today's behavior and is logged.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  NON_PARTICIPANT_DEFAULTS_KEY,
  nonParticipantDefaults,
} from "@/lib/utils/non-participant-defaults";

export async function applyNonParticipantDefaults(
  userId: string,
  ageBand: string,
  currentVisibility: Record<string, unknown> | null | undefined
): Promise<boolean> {
  if (currentVisibility && Object.keys(currentVisibility).length > 0) return false;
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: enrollments, error: enrollmentError } = await supabase
      .from("study_enrollments")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (enrollmentError) throw new Error(enrollmentError.message);
    if ((enrollments || []).length > 0) return false;

    // Fresh read: metadata is read-modify-write, and the map may have been set
    // since the caller loaded it.
    const { data: row, error: readError } = await supabase
      .from("users")
      .select("metadata, profile_visibility")
      .eq("id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return false;
    const stored = (row.profile_visibility || {}) as Record<string, unknown>;
    if (Object.keys(stored).length > 0) return false;

    const metadata = {
      ...((row.metadata || {}) as Record<string, unknown>),
      [NON_PARTICIPANT_DEFAULTS_KEY]: new Date().toISOString(),
    };
    const { error: writeError } = await supabase
      .from("users")
      .update({ profile_visibility: nonParticipantDefaults(ageBand), metadata })
      .eq("id", userId);
    if (writeError) throw new Error(writeError.message);
    return true;
  } catch (err) {
    console.error(
      `[privacy] could not write non-participant defaults for user ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}
