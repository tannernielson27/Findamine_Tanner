/**
 * Locking the clue delivery setting (lib/play/clue-delivery.ts).
 *
 * A hunt "begins" when it is published (any status other than draft) or when
 * anyone has a play session on it, whichever comes first. Sessions can only be
 * started on a published hunt, but a hunt can be unpublished afterwards, so
 * both are checked: a played-then-unpublished draft stays locked. To run a
 * different setting, clone the hunt (the copy is a fresh draft).
 *
 * After the lock the stops are frozen too, in every mode: no stop can be
 * added, removed or moved, since any of those changes the order players get
 * (and would break assigned orders). A stop's own content (clue text, hints,
 * challenge) can still be edited.
 *
 * The database enforces the same rules (migration 083).
 *
 * Pure: no I/O, unit tested directly.
 */

import {
  CLUE_DELIVERY_KEY,
  CLUE_ORDERS_KEY,
  readClueDelivery,
  readClueOrders,
  validateClueDelivery,
  type Check,
} from "@/lib/play/clue-delivery";

type Meta = Readonly<Record<string, unknown>> | null | undefined;

export const DELIVERY_LOCKED_MESSAGE =
  "Clue delivery is locked because this hunt has been published or played. Clone the hunt to use a different setting.";

export const STOPS_LOCKED_MESSAGE =
  "This hunt has been published or played, so its stops can't be added, removed or reordered. Clone the hunt to change its stops.";

export function isDeliveryLocked(hunt: { status: string; hasPlaySessions: boolean }): boolean {
  return hunt.status !== "draft" || hunt.hasPlaySessions;
}

function deliveryKey(metadata: Meta): string {
  const mode = readClueDelivery(metadata);
  const orders = mode === "assigned_order" ? readClueOrders(metadata) : [];
  return JSON.stringify([mode, orders]);
}

/** Did the effective setting (mode, plus orders for assigned_order) change? */
export function deliverySettingsChanged(before: Meta, after: Meta): boolean {
  return deliveryKey(before) !== deliveryKey(after);
}

/** May this metadata update go through? Validates only when the setting changes. */
export function checkDeliveryEdit(input: {
  locked: boolean;
  before: Meta;
  after: Meta;
  findIds: ReadonlyArray<string>;
}): Check {
  if (deliverySettingsChanged(input.before, input.after)) {
    if (input.locked) return { ok: false, error: DELIVERY_LOCKED_MESSAGE };
    return validateClueDelivery(input.after, input.findIds);
  }
  // Same effective setting but a different stored value (e.g. an unknown
  // mode, which reads as fixed_order): reject junk, allow the rest.
  if (input.after?.[CLUE_DELIVERY_KEY] !== input.before?.[CLUE_DELIVERY_KEY]) {
    return validateClueDelivery(input.after, input.findIds);
  }
  return { ok: true };
}

/** May a stop be added to or removed from this hunt? */
export function checkStopSetChange(input: { locked: boolean }): Check {
  return input.locked ? { ok: false, error: STOPS_LOCKED_MESSAGE } : { ok: true };
}

/**
 * An update that names assigned_order but leaves `clue_orders` out (a client
 * that never saw them) keeps the stored orders. Returns `after` unchanged
 * otherwise; never mutates.
 */
export function inheritClueOrders<T extends Meta>(before: Meta, after: T): T | Record<string, unknown> {
  if (!after || readClueDelivery(after) !== "assigned_order" || CLUE_ORDERS_KEY in after) return after;
  return { ...after, [CLUE_ORDERS_KEY]: readClueOrders(before) };
}

/** Orders rewritten for a cloned hunt's new stop ids; unknown ids dropped. */
export function remapClueOrders(
  orders: ReadonlyArray<ReadonlyArray<string>>,
  idMap: ReadonlyMap<string, string>
): string[][] {
  return orders.map((order) => order.flatMap((id) => {
    const mapped = idMap.get(id);
    return mapped ? [mapped] : [];
  }));
}
