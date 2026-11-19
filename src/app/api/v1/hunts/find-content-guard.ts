import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import { mayReadContentRow } from "@/lib/hunts/content-access";

/**
 * What a stop may point at.
 *
 * A stop names its place, challenge and primer by id, and the hunt's owner is
 * shown all three in full. So the ids a builder may put on a stop are the
 * rows they may read anyway (lib/hunts/content-access.ts: their own and the
 * shared library; admins and researchers: any), plus rows the same hunt
 * already uses, which keeps the stops of a copied hunt editable.
 *
 * Anything else is refused with one message, whether the row exists or not.
 * Migration 088 has the same rule in the database for writes that skip the API.
 */

const REFERENCES = [
  { column: "location_id", table: "locations", label: "place" },
  { column: "task_id", table: "tasks", label: "challenge" },
  { column: "primer_id", table: "primers", label: "primer" },
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function contentRefusedMessage(label: string): string {
  return `That ${label} isn't one of yours or in the shared library. Choose another, or create a new one.`;
}

export async function assertFindContentAllowed(
  supabase: SupabaseClient,
  input: { user: { id: string; role: string }; huntId: string; fields: Readonly<Record<string, unknown>>; route: string }
): Promise<void> {
  const { user, huntId, fields, route } = input;
  for (const { column, table, label } of REFERENCES) {
    const id = fields[column];
    if (id === undefined || id === null) continue;
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new ApiError(400, `${column} must be an id`);

    const { data: row, error } = await supabase
      .from(table)
      .select("id, created_by, is_library")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw internalError(route, error);
    if (row && mayReadContentRow(user, row as Record<string, unknown>)) continue;

    // Already on one of this hunt's stops (a copied hunt keeps the original's rows).
    const { data: used, error: usedError } = await supabase
      .from("finds")
      .select("id")
      .eq("hunt_id", huntId)
      .eq(column, id)
      .is("deleted_at", null)
      .limit(1);
    if (usedError) throw internalError(route, usedError);
    // Whether or not the row is still there: re-saving a stop whose place or
    // challenge was removed later must not be refused as someone else's.
    if (used && used.length > 0) continue;

    throw new ApiError(403, contentRefusedMessage(label));
  }
}
