import type { SupabaseClient } from "@supabase/supabase-js";
import { internalError } from "@/lib/utils/internal-error";
import {
  CLUE_ORDERS_KEY,
  readClueDelivery,
  readClueOrders,
  withoutClueOrders,
} from "@/lib/play/clue-delivery";

/**
 * Storage for assigned clue orders (public.hunt_clue_orders, migration 083).
 *
 * The orders are kept out of hunts.metadata because public hunts are readable
 * by anyone; the table is service-role only. Server code works with "full"
 * metadata (hunts.metadata plus `clue_orders`) so the pure helpers in
 * lib/play/clue-delivery see one shape. Only owners and reviewers are ever
 * sent full metadata.
 *
 * The table is only queried for assigned_order hunts, so every other hunt keeps
 * working even before migration 083 is applied.
 */

type Meta = Record<string, unknown> | null;
const TABLE = "hunt_clue_orders";

export async function loadClueOrders(
  supabase: SupabaseClient,
  huntId: string,
  route: string
): Promise<string[][] | null> {
  const { data, error } = await supabase.from(TABLE).select("orders").eq("hunt_id", huntId).maybeSingle();
  if (error) throw internalError(route, error);
  if (!data) return null;
  return readClueOrders({ [CLUE_ORDERS_KEY]: data.orders });
}

/**
 * The hunt's metadata with its stored orders merged in. The table is the only
 * source: any stray `clue_orders` left in hunts.metadata (migration 083 moves
 * and strips them) is dropped, never served. Non-assigned hunts come back
 * without the key and without a query.
 */
export async function fullDeliveryMetadata(
  supabase: SupabaseClient,
  hunt: { id: string; metadata?: unknown },
  route: string
): Promise<Meta> {
  const metadata = withoutClueOrders((hunt.metadata as Meta) ?? null);
  if (readClueDelivery(metadata) !== "assigned_order") return metadata;
  const stored = await loadClueOrders(supabase, hunt.id, route);
  return { ...(metadata ?? {}), [CLUE_ORDERS_KEY]: stored ?? [] };
}

/**
 * Persists the orders from full metadata: upserts them for assigned_order,
 * removes them otherwise. Skips the write when nothing changed, so saving an
 * unrelated setting on a locked hunt never touches the locked orders.
 */
export async function saveClueOrders(
  supabase: SupabaseClient,
  input: { huntId: string; before: Meta; after: Meta; route: string }
): Promise<void> {
  const { huntId, before, after, route } = input;
  const wantOrders = readClueDelivery(after) === "assigned_order";
  const nextOrders = wantOrders ? readClueOrders(after) : [];
  const hadOrders = readClueDelivery(before) === "assigned_order";
  const prevOrders = hadOrders ? readClueOrders(before) : [];
  if (wantOrders === hadOrders && JSON.stringify(nextOrders) === JSON.stringify(prevOrders)) return;

  const { error } = wantOrders
    ? await supabase.from(TABLE).upsert({ hunt_id: huntId, orders: nextOrders }, { onConflict: "hunt_id" })
    : await supabase.from(TABLE).delete().eq("hunt_id", huntId);
  if (error) throw internalError(route, error);
}

/** What goes into hunts.metadata itself: never the orders. */
export function storedMetadata(metadata: Meta): Meta {
  return withoutClueOrders(metadata);
}
