/**
 * Locking the clue delivery setting (lib/play/clue-delivery.ts).
 *
 * A hunt "begins" when it is published (any status other than draft) or when
 * anyone has a play session on it, whichever comes first. Sessions can only be
 * started on a published hunt, but a hunt can be unpublished afterwards, so
 * both are checked: a played-then-unpublished draft stays locked. To run a
 * different setting, clone the hunt (the copy is a fresh draft).
 *
 * After the lock, on an assigned_order hunt the set of stops is frozen too
 * (adding or removing a stop would break every order). Other modes keep the
 * app's existing behaviour for stop edits.
 *
 * The database enforces the same rule for the setting itself (migration 083).
 *
 * Pure: no I/O, unit tested directly.
 */

import {
  CLUE_DELIVERY_KEY,
  readClueDelivery,
  readClueOrders,
  validateClueDelivery,
  type Check,
} from "@/lib/play/clue-delivery";

type Meta = Readonly<Record<string, unknown>> | null | undefined;

export const DELIVERY_LOCKED_MESSAGE =
  "Clue delivery is locked because this hunt has been published or played. Clone the hunt to use a different setting.";

export const STOPS_LOCKED_MESSAGE =
  "This hunt uses assigned orders and has been published or played, so stops can't be added or removed. Clone the hunt to change its stops.";

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
export function checkStopSetChange(input: { locked: boolean; metadata: Meta }): Check {
  return input.locked && readClueDelivery(input.metadata) === "assigned_order"
    ? { ok: false, error: STOPS_LOCKED_MESSAGE }
    : { ok: true };
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
