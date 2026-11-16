/**
 * Edits to a hunt's assigned clue orders, for the orders editor. Each returns
 * a new list; none mutates its input.
 *
 * Pure: no I/O, unit tested directly.
 */

import { MAX_CLUE_ORDERS, normalizeOrder } from "@/lib/play/clue-delivery";

type Orders = ReadonlyArray<ReadonlyArray<string>>;

/** Orders fitted to the current stops (see normalizeOrder). */
export function fitOrders(orders: Orders, findIds: ReadonlyArray<string>): string[][] {
  return orders.map((order) => normalizeOrder(order, findIds));
}

/** Adds a new order (the creator's order, reversed when it is the second). */
export function addOrder(orders: Orders, findIds: ReadonlyArray<string>): string[][] {
  if (orders.length >= MAX_CLUE_ORDERS) return orders.map((o) => [...o]);
  const fresh = orders.length === 1 ? [...findIds].reverse() : [...findIds];
  return [...orders.map((o) => [...o]), fresh];
}

export function removeOrder(orders: Orders, index: number): string[][] {
  return orders.filter((_, i) => i !== index).map((o) => [...o]);
}

/** Moves the stop at `position` in order `index` one place up (-1) or down (+1). */
export function moveStop(orders: Orders, index: number, position: number, direction: -1 | 1): string[][] {
  return orders.map((order, i) => {
    const copy = [...order];
    const target = position + direction;
    if (i !== index || target < 0 || target >= copy.length) return copy;
    [copy[position], copy[target]] = [copy[target], copy[position]];
    return copy;
  });
}

/** A starting set when switching to assigned orders: creator order and its reverse. */
export function starterOrders(findIds: ReadonlyArray<string>): string[][] {
  return [[...findIds], [...findIds].reverse()];
}
