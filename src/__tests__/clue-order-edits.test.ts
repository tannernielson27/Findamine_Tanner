import { describe, expect, it } from "vitest";
import { addOrder, fitOrders, moveStop, removeOrder, starterOrders } from "@/lib/hunts/clue-order-edits";
import { MAX_CLUE_ORDERS } from "@/lib/play/clue-delivery";

const ids = ["a", "b", "c"];

describe("clue order edits", () => {
  it("starts with the creator's order and its reverse", () => {
    expect(starterOrders(ids)).toEqual([["a", "b", "c"], ["c", "b", "a"]]);
  });

  it("adds an order without touching the existing ones", () => {
    const orders = [["a", "b", "c"]];
    const out = addOrder(orders, ids);
    expect(out).toEqual([["a", "b", "c"], ["c", "b", "a"]]);
    expect(orders).toEqual([["a", "b", "c"]]);
    expect(addOrder(out, ids)).toHaveLength(3);
  });

  it("stops adding at the cap", () => {
    const full = Array.from({ length: MAX_CLUE_ORDERS }, () => ids);
    expect(addOrder(full, ids)).toHaveLength(MAX_CLUE_ORDERS);
  });

  it("removes one order", () => {
    expect(removeOrder([["a"], ["b"], ["c"]], 1)).toEqual([["a"], ["c"]]);
  });

  it("moves a stop within one order only, and ignores moves off the ends", () => {
    const orders = [["a", "b", "c"], ["a", "b", "c"]];
    expect(moveStop(orders, 1, 2, -1)).toEqual([["a", "b", "c"], ["a", "c", "b"]]);
    expect(moveStop(orders, 0, 0, -1)).toEqual(orders);
    expect(moveStop(orders, 0, 2, 1)).toEqual(orders);
    expect(orders).toEqual([["a", "b", "c"], ["a", "b", "c"]]);
  });

  it("fits saved orders to the current stops", () => {
    expect(fitOrders([["c", "x"], ["b", "a", "c"]], ids)).toEqual([["c", "a", "b"], ["b", "a", "c"]]);
  });
});
