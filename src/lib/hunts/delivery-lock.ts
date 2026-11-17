/**
 * Locking the clue delivery setting (lib/play/clue-delivery.ts).
 *
 * A hunt "begins" when it is published (any status other than draft) or when
 * anyone has a play session on it, whichever comes first. Sessions can only be
 * started on a published hunt, but a hunt can be unpublished afterwards, so
 * both are checked: a played-then-unpublished draft stays locked. To run a
 * different setting, clone the hunt (the copy is a fresh draft).
 *
 * The clue delivery lock applies to every hunt. Stops are frozen after the
 * lock (no add, remove or move; a stop's own content can still be edited)
 * only when:
 *   - the hunt is a study hunt (metadata `study_hunt`, set by admins and
 *     researchers only), so every participant gets the same stops; or
 *   - it uses assigned orders, which list the exact set of stops.
 * Other hunts keep the usual unpublish → edit → resubmit workflow.
 *
 * The study flag can only be set or cleared by admins and researchers, and
 * once a study hunt is locked it can't be cleared at all (that would undo the
 * freeze).
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

export const STUDY_STOPS_LOCKED_MESSAGE =
  "This study hunt has been published or played, so its stops can't be added, removed or reordered. Clone the hunt to change its stops.";

export const ASSIGNED_STOPS_LOCKED_MESSAGE =
  "This hunt uses assigned orders and has been published or played, so its stops can't be added, removed or reordered. Clone the hunt to change its stops.";

export const STUDY_FLAG_FORBIDDEN_MESSAGE = "Only admins and researchers can mark or unmark a study hunt.";

export const STUDY_FLAG_LOCKED_MESSAGE =
  "This study hunt has been published or played, so it can't stop being a study hunt.";

/** Hunt metadata key marking a study hunt. */
export const STUDY_HUNT_KEY = "study_hunt";

export function isDeliveryLocked(hunt: { status: string; hasPlaySessions: boolean }): boolean {
  return hunt.status !== "draft" || hunt.hasPlaySessions;
}

export function readStudyHunt(metadata: Meta): boolean {
  return metadata?.[STUDY_HUNT_KEY] === true;
}

/** Would this hunt's stops freeze once it is locked? (Study hunt or assigned orders.) */
export function freezesStops(metadata: Meta): boolean {
  return readStudyHunt(metadata) || readClueDelivery(metadata) === "assigned_order";
}

/** Are this hunt's stops frozen (no add, remove or reorder)? */
export function stopsFrozen(input: { locked: boolean; metadata: Meta }): boolean {
  return input.locked && freezesStops(input.metadata);
}

/**
 * Metadata for a hunt created (or cloned) by someone with `role`: the study
 * flag survives only for admins and researchers. Never mutates.
 */
export function withStudyFlagFor<T extends Readonly<Record<string, unknown>> | null>(
  role: string | null | undefined,
  metadata: T
): T {
  if (!metadata || !(STUDY_HUNT_KEY in metadata) || role === "admin" || role === "researcher") return metadata;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== STUDY_HUNT_KEY)) as T;
}

export type StudyFlagResult =
  | { ok: true; metadata: Record<string, unknown> | null }
  | { ok: false; status: 403 | 409; error: string };

/**
 * The study flag an update ends up with. A save that leaves the key out keeps
 * the stored value (creators' clients never manage it). Only admins and
 * researchers may change it, and nobody may clear it once a study hunt is
 * locked. Never mutates.
 */
export function resolveStudyFlag(input: {
  before: Meta;
  after: Readonly<Record<string, unknown>> | null;
  canSetStudyFlag: boolean;
  locked: boolean;
}): StudyFlagResult {
  const { before, after, canSetStudyFlag, locked } = input;
  const was = readStudyHunt(before);
  if (!after || !(STUDY_HUNT_KEY in after)) {
    if (!was) return { ok: true, metadata: after ? { ...after } : null };
    return { ok: true, metadata: { ...(after ?? {}), [STUDY_HUNT_KEY]: true } };
  }
  const next = readStudyHunt(after);
  if (next === was) return { ok: true, metadata: { ...after } };
  if (!canSetStudyFlag) return { ok: false, status: 403, error: STUDY_FLAG_FORBIDDEN_MESSAGE };
  if (was && locked) return { ok: false, status: 409, error: STUDY_FLAG_LOCKED_MESSAGE };
  return { ok: true, metadata: { ...after } };
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

/** May a stop be added to, removed from or moved within this hunt? */
export function checkStopSetChange(input: { locked: boolean; metadata: Meta }): Check {
  if (!stopsFrozen(input)) return { ok: true };
  return {
    ok: false,
    error: readStudyHunt(input.metadata) ? STUDY_STOPS_LOCKED_MESSAGE : ASSIGNED_STOPS_LOCKED_MESSAGE,
  };
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
