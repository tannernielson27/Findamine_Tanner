/**
 * How a hunt hands out its clues (hunt metadata `clue_delivery`).
 *
 *   all_at_once     every clue is open; the player picks which one to work on
 *   fixed_order     everyone gets the creator's order (finds.sort_order)
 *   assigned_order  each player is assigned one of n creator-defined orders
 *                   (metadata `clue_orders`: each a permutation of the find ids)
 *   random_order    each player gets their own random order, seeded by the
 *                   play session id (see stop-order.ts)
 *
 * Back-compat: hunts saved before this setting existed only have
 * `shuffle_stops: true`, which reads as random_order. Writes keep that flag in
 * step so older readers still behave.
 *
 * The assigned_order group is deterministic per player and hunt (seeded by
 * user id + hunt id), so a reload or a replay lands in the same group. The
 * start route records it on the play session (`clue_order_index`) for export.
 *
 * Pure: no I/O, unit tested directly.
 */

import { hashSeed, orderStops, SHUFFLE_STOPS_KEY } from "@/lib/play/stop-order";

export const CLUE_DELIVERY_MODES = ["all_at_once", "fixed_order", "assigned_order", "random_order"] as const;
export type ClueDelivery = (typeof CLUE_DELIVERY_MODES)[number];

export const CLUE_DELIVERY_KEY = "clue_delivery";
export const CLUE_ORDERS_KEY = "clue_orders";
/** Play session metadata key holding the assigned order group (0-based). */
export const SESSION_ORDER_INDEX_KEY = "clue_order_index";
export const MIN_CLUE_ORDERS = 2;
export const MAX_CLUE_ORDERS = 12;

type Meta = Readonly<Record<string, unknown>> | null | undefined;

export type Check = { ok: true } | { ok: false; error: string };

export function isClueDelivery(value: unknown): value is ClueDelivery {
  return typeof value === "string" && (CLUE_DELIVERY_MODES as ReadonlyArray<string>).includes(value);
}

/** The hunt's delivery mode; an explicit valid value wins over the legacy flag. */
export function readClueDelivery(metadata: Meta): ClueDelivery {
  const explicit = metadata?.[CLUE_DELIVERY_KEY];
  if (isClueDelivery(explicit)) return explicit;
  return metadata?.[SHUFFLE_STOPS_KEY] === true ? "random_order" : "fixed_order";
}

/** True when players must take the stops in a set sequence. */
export function isOrderedDelivery(mode: ClueDelivery): boolean {
  return mode !== "all_at_once";
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

/** The creator's orders for assigned_order; [] when absent or malformed. */
export function readClueOrders(metadata: Meta): string[][] {
  const raw = metadata?.[CLUE_ORDERS_KEY];
  if (!Array.isArray(raw) || !raw.every(isIdList)) return [];
  return raw.map((order) => [...order]);
}

/**
 * Metadata without the creator's orders. The orders are stored in their own
 * table (migration 083) and only owners and reviewers may see them; this is
 * the shape kept in hunts.metadata and handed to players. Never mutates.
 */
export function withoutClueOrders<T extends Meta>(metadata: T): T {
  if (!metadata) return metadata;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== CLUE_ORDERS_KEY)) as T;
}

/**
 * New metadata with the delivery mode set. Orders are stored only for
 * assigned_order (and removed otherwise). Never mutates the input.
 */
export function withClueDelivery(
  metadata: Meta,
  mode: ClueDelivery,
  orders: ReadonlyArray<ReadonlyArray<string>> = []
): Record<string, unknown> {
  const rest = withoutClueOrders(metadata ?? {});
  const base = { ...rest, [CLUE_DELIVERY_KEY]: mode, [SHUFFLE_STOPS_KEY]: mode === "random_order" };
  return mode === "assigned_order" ? { ...base, [CLUE_ORDERS_KEY]: orders.map((o) => [...o]) } : base;
}

function permutationError(order: ReadonlyArray<string>, findIds: ReadonlyArray<string>): string | null {
  const known = new Set(findIds);
  const seen = new Set<string>();
  for (const id of order) {
    if (!known.has(id)) return "includes a stop that is no longer in the hunt";
    if (seen.has(id)) return "lists a stop twice";
    seen.add(id);
  }
  return seen.size === known.size ? null : "is missing a stop";
}

/** Each order must list every stop exactly once; 2 to 12 orders. */
export function validateClueOrders(
  orders: ReadonlyArray<ReadonlyArray<string>>,
  findIds: ReadonlyArray<string>
): Check {
  if (orders.length < MIN_CLUE_ORDERS) {
    return { ok: false, error: `Assigned orders needs at least ${MIN_CLUE_ORDERS} orders.` };
  }
  if (orders.length > MAX_CLUE_ORDERS) {
    return { ok: false, error: `Assigned orders allows at most ${MAX_CLUE_ORDERS} orders.` };
  }
  for (const [index, order] of orders.entries()) {
    const problem = permutationError(order, findIds);
    if (problem) return { ok: false, error: `Order ${index + 1} ${problem}. Every order must list each stop once.` };
  }
  return { ok: true };
}

/** The whole delivery setting is usable for this set of stops. */
export function validateClueDelivery(metadata: Meta, findIds: ReadonlyArray<string>): Check {
  const explicit = metadata?.[CLUE_DELIVERY_KEY];
  if (explicit !== undefined && !isClueDelivery(explicit)) {
    return { ok: false, error: "Unknown clue delivery setting." };
  }
  if (readClueDelivery(metadata) !== "assigned_order") return { ok: true };
  return validateClueOrders(readClueOrders(metadata), findIds);
}

/**
 * An order fitted to the current stops: unknown and repeated ids dropped,
 * stops it does not mention appended in creator order. Never mutates.
 */
export function normalizeOrder(order: ReadonlyArray<string>, findIds: ReadonlyArray<string>): string[] {
  const known = new Set(findIds);
  const kept = [...new Set(order)].filter((id) => known.has(id));
  const listed = new Set(kept);
  return [...kept, ...findIds.filter((id) => !listed.has(id))];
}

/** The order group (0..n-1) for a player in a hunt; stable across sessions. */
export function assignOrderIndex(userId: string, huntId: string, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return hashSeed(`${huntId}:${userId}`) % orderCount;
}

/** The order group recorded on a play session, if it is still valid. */
export function recordedOrderIndex(sessionMetadata: Meta, orderCount: number): number | null {
  const value = sessionMetadata?.[SESSION_ORDER_INDEX_KEY];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < orderCount ? value : null;
}

/** Recorded group first, otherwise the deterministic assignment. */
export function orderIndexFor(
  sessionMetadata: Meta,
  ctx: { userId: string; huntId: string; orderCount: number }
): number {
  return recordedOrderIndex(sessionMetadata, ctx.orderCount) ?? assignOrderIndex(ctx.userId, ctx.huntId, ctx.orderCount);
}

/** What the start route records on a new play session, for researchers. */
export function sessionDeliveryMetadata(mode: ClueDelivery, orderIndex: number | null): Record<string, unknown> {
  return mode === "assigned_order" && orderIndex !== null
    ? { [CLUE_DELIVERY_KEY]: mode, [SESSION_ORDER_INDEX_KEY]: orderIndex }
    : { [CLUE_DELIVERY_KEY]: mode };
}

interface Stop {
  id: string;
  sort_order: number | null;
}

export interface SessionOrderContext {
  huntMetadata: Meta;
  sessionId: string | null | undefined;
  /** assigned_order group for this session (null when unknown or not relevant). */
  orderIndex: number | null | undefined;
  /**
   * assigned_order on the player's device: the hunt's orders are hidden, so
   * the start route sends this session's own order instead.
   */
  ownOrder?: ReadonlyArray<string> | null;
}

/**
 * The stops in the order this session plays them. In all_at_once this is the
 * creator's order, used for listing. Never mutates the input.
 */
export function sessionStopOrder<T extends Stop>(finds: ReadonlyArray<T>, ctx: SessionOrderContext): T[] {
  const mode = readClueDelivery(ctx.huntMetadata);
  const byCreator = orderStops(finds, { shuffle: mode === "random_order", seed: ctx.sessionId });
  if (mode !== "assigned_order") return byCreator;

  const orders = readClueOrders(ctx.huntMetadata);
  const order = ctx.ownOrder ?? (ctx.orderIndex != null ? orders[ctx.orderIndex] : undefined);
  if (!order) return byCreator;
  const byId = new Map(byCreator.map((f) => [f.id, f]));
  return normalizeOrder(order, byCreator.map((f) => f.id)).flatMap((id) => {
    const find = byId.get(id);
    return find ? [find] : [];
  });
}

export type StopAccess =
  | { ok: true }
  | { ok: false; reason: "not_in_hunt" | "out_of_order"; currentFindId: string | null };

/**
 * May the player work on `findId` now? In all_at_once any stop in the hunt;
 * otherwise only the first unfinished stop in their order, or a stop they
 * already finished (revisiting results is harmless).
 */
export function checkStopAccess(input: {
  mode: ClueDelivery;
  orderedIds: ReadonlyArray<string>;
  completedIds: ReadonlySet<string>;
  findId: string;
}): StopAccess {
  const { mode, orderedIds, completedIds, findId } = input;
  if (!orderedIds.includes(findId)) return { ok: false, reason: "not_in_hunt", currentFindId: null };
  if (!isOrderedDelivery(mode) || completedIds.has(findId)) return { ok: true };
  const current = orderedIds.find((id) => !completedIds.has(id)) ?? null;
  return current === findId ? { ok: true } : { ok: false, reason: "out_of_order", currentFindId: current };
}

/** Short player/creator-facing name for a mode. */
export const CLUE_DELIVERY_LABELS: Record<ClueDelivery, string> = {
  all_at_once: "All at once",
  fixed_order: "Same order for everyone",
  assigned_order: "Assigned orders",
  random_order: "Random order",
};

export const CLUE_DELIVERY_DESCRIPTIONS: Record<ClueDelivery, string> = {
  all_at_once: "Players choose which stop to work on. Each clue appears when they start that stop.",
  fixed_order: "Everyone gets the stops in your order.",
  assigned_order: "Each player is assigned one of the orders you define.",
  random_order: "Each player gets the stops in their own random order.",
};
