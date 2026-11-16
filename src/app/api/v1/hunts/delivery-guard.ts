import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import { checkDeliveryEdit, checkStopSetChange, isDeliveryLocked } from "@/lib/hunts/delivery-lock";

/**
 * Hunt-editing routes' side of the clue delivery lock (lib/hunts/delivery-lock.ts).
 * The database trigger from migration 083 backs up the setting check.
 */

type Meta = Record<string, unknown> | null | undefined;

/** True once anyone has started (or finished) a play session on the hunt. */
export async function huntHasPlaySessions(supabase: SupabaseClient, huntId: string, route: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("play_sessions")
    .select("id", { count: "exact", head: true })
    .eq("hunt_id", huntId);
  if (error) throw internalError(route, error);
  return (count ?? 0) > 0;
}

export async function deliveryLocked(
  supabase: SupabaseClient,
  hunt: { id: string; status: string },
  route: string
): Promise<boolean> {
  if (hunt.status !== "draft") return true;
  return isDeliveryLocked({ status: hunt.status, hasPlaySessions: await huntHasPlaySessions(supabase, hunt.id, route) });
}

async function liveFindIds(supabase: SupabaseClient, huntId: string, route: string): Promise<string[]> {
  const { data, error } = await supabase.from("finds").select("id").eq("hunt_id", huntId).is("deleted_at", null);
  if (error) throw internalError(route, error);
  return (data ?? []).map((f) => f.id as string);
}

/** 409 when a locked hunt's setting would change; 400 when a new one is invalid. */
export async function assertDeliveryEditAllowed(
  supabase: SupabaseClient,
  input: { hunt: { id: string; status: string }; before: Meta; after: Meta; route: string }
): Promise<void> {
  const { hunt, before, after, route } = input;
  const [locked, findIds] = await Promise.all([
    deliveryLocked(supabase, hunt, route),
    liveFindIds(supabase, hunt.id, route),
  ]);
  const result = checkDeliveryEdit({ locked, before, after, findIds });
  if (!result.ok) throw new ApiError(locked ? 409 : 400, result.error);
}

/** 409 when stops can no longer be added or removed (locked assigned orders). */
export async function assertStopSetEditable(
  supabase: SupabaseClient,
  input: { hunt: { id: string; status: string; metadata: Meta }; route: string }
): Promise<void> {
  const { hunt, route } = input;
  const locked = await deliveryLocked(supabase, hunt, route);
  const result = checkStopSetChange({ locked, metadata: hunt.metadata });
  if (!result.ok) throw new ApiError(409, result.error);
}
