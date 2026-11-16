import { describe, expect, it } from "vitest";
import {
  checkDeliveryEdit,
  checkStopSetChange,
  deliverySettingsChanged,
  isDeliveryLocked,
  remapClueOrders,
} from "@/lib/hunts/delivery-lock";

const twoOrders = [["a", "b"], ["b", "a"]];

describe("isDeliveryLocked", () => {
  it("is unlocked only for a draft nobody has played", () => {
    expect(isDeliveryLocked({ status: "draft", hasPlaySessions: false })).toBe(false);
  });

  it("locks once the hunt is published or live", () => {
    for (const status of ["published", "enrollment_open", "in_progress", "ended"]) {
      expect(isDeliveryLocked({ status, hasPlaySessions: false })).toBe(true);
    }
  });

  it("stays locked for a draft that was played and then unpublished", () => {
    expect(isDeliveryLocked({ status: "draft", hasPlaySessions: true })).toBe(true);
  });
});

describe("deliverySettingsChanged", () => {
  it("treats the legacy flag and the explicit mode as the same setting", () => {
    expect(deliverySettingsChanged({ shuffle_stops: true }, { shuffle_stops: true, clue_delivery: "random_order" })).toBe(false);
    expect(deliverySettingsChanged({}, { clue_delivery: "fixed_order", shuffle_stops: false })).toBe(false);
  });

  it("ignores unrelated metadata", () => {
    expect(deliverySettingsChanged({ hide_scores: false }, { hide_scores: true })).toBe(false);
  });

  it("sees a mode change", () => {
    expect(deliverySettingsChanged({}, { clue_delivery: "all_at_once" })).toBe(true);
    expect(deliverySettingsChanged({ shuffle_stops: true }, { shuffle_stops: false })).toBe(true);
  });

  it("sees an order change in assigned_order, and ignores leftover orders in other modes", () => {
    const before = { clue_delivery: "assigned_order", clue_orders: twoOrders };
    expect(deliverySettingsChanged(before, { ...before, clue_orders: [["a", "b"], ["a", "b"]] })).toBe(true);
    expect(deliverySettingsChanged({ clue_orders: twoOrders }, {})).toBe(false);
  });
});

describe("checkDeliveryEdit", () => {
  const ids = ["a", "b"];

  it("allows edits that leave the setting alone, even when locked", () => {
    expect(checkDeliveryEdit({ locked: true, before: { shuffle_stops: true }, after: { shuffle_stops: true, hide_scores: true }, findIds: ids })).toEqual({ ok: true });
  });

  it("rejects a change once locked, with a clear reason", () => {
    const result = checkDeliveryEdit({ locked: true, before: {}, after: { clue_delivery: "all_at_once" }, findIds: ids });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked/i);
  });

  it("allows a valid change while unlocked", () => {
    expect(
      checkDeliveryEdit({ locked: false, before: {}, after: { clue_delivery: "assigned_order", clue_orders: twoOrders }, findIds: ids })
    ).toEqual({ ok: true });
  });

  it("rejects an invalid change while unlocked", () => {
    expect(checkDeliveryEdit({ locked: false, before: {}, after: { clue_delivery: "assigned_order", clue_orders: [["a"]] }, findIds: ids }).ok).toBe(false);
    expect(checkDeliveryEdit({ locked: false, before: {}, after: { clue_delivery: "sideways" }, findIds: ids }).ok).toBe(false);
  });

  it("lets a creator switch to assigned_order before any orders exist only via a valid set", () => {
    expect(checkDeliveryEdit({ locked: false, before: {}, after: { clue_delivery: "assigned_order" }, findIds: ids }).ok).toBe(false);
  });
});

describe("checkStopSetChange", () => {
  it("blocks adding or removing stops on a locked assigned_order hunt", () => {
    const result = checkStopSetChange({ locked: true, metadata: { clue_delivery: "assigned_order", clue_orders: twoOrders } });
    expect(result.ok).toBe(false);
  });

  it("allows it in other modes, or before the lock", () => {
    expect(checkStopSetChange({ locked: true, metadata: { clue_delivery: "random_order" } }).ok).toBe(true);
    expect(checkStopSetChange({ locked: false, metadata: { clue_delivery: "assigned_order" } }).ok).toBe(true);
  });
});

describe("remapClueOrders", () => {
  it("swaps old stop ids for the copies' ids and drops unknown ones", () => {
    const map = new Map([["a", "A"], ["b", "B"]]);
    expect(remapClueOrders([["a", "b"], ["b", "x", "a"]], map)).toEqual([["A", "B"], ["B", "A"]]);
  });

  it("never mutates its input", () => {
    const orders = [["a", "b"]];
    remapClueOrders(orders, new Map([["a", "A"]]));
    expect(orders).toEqual([["a", "b"]]);
  });
});
