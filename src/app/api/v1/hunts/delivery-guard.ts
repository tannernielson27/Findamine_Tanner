import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import {
  checkDeliveryEdit,
  checkStopSetChange,
  freezesStops,
  inheritClueOrders,
  isDeliveryLocked,
  resolveStudyFlag,
} from "@/lib/hunts/delivery-lock";
import { fullDeliveryMetadata } from "@/lib/hunts/clue-orders-store";

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

/**
 * Settles a hunt metadata update against the stored hunt: keeps stored
 * assigned orders the update leaves out, applies the clue delivery lock (409 /
 * 400) and the study-flag rules (403 for non-reviewers, 409 for clearing a
 * locked study hunt). Returns full metadata before and after (orders merged in).
 */
export async function prepareMetadataUpdate(
  supabase: SupabaseClient,
  input: { hunt: { id: string; status: string; metadata: Meta }; incoming: Meta; canSetStudyFlag: boolean; route: string }
): Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }> {
  const { hunt, incoming, canSetStudyFlag, route } = input;
  const before = await fullDeliveryMetadata(supabase, hunt, route);
  const withOrders = inheritClueOrders(before, incoming ?? null) as Record<string, unknown> | null;
  const locked = await deliveryLocked(supabase, hunt, route);
  const flag = resolveStudyFlag({ before, after: withOrders, canSetStudyFlag, locked });
  if (!flag.ok) throw new ApiError(flag.status, flag.error);
  await assertDeliveryEditAllowed(supabase, { hunt, before, after: flag.metadata, route });
  return { before, after: flag.metadata };
}

/**
 * 409 when stops can no longer be added, removed or reordered: a locked study
 * hunt, or a locked hunt with assigned orders. Other hunts never freeze, so
 * they skip the lock lookup entirely.
 */
export async function assertStopSetEditable(
  supabase: SupabaseClient,
  input: { hunt: { id: string; status: string; metadata?: unknown }; route: string }
): Promise<void> {
  const { hunt, route } = input;
  const metadata = (hunt.metadata as Meta) ?? null;
  if (!freezesStops(metadata)) return;
  const locked = await deliveryLocked(supabase, hunt, route);
  const result = checkStopSetChange({ locked, metadata });
  if (!result.ok) throw new ApiError(409, result.error);
}
