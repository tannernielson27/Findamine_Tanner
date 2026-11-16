import { describe, expect, it } from "vitest";
import {
  assignOrderIndex,
  checkStopAccess,
  CLUE_DELIVERY_KEY,
  CLUE_ORDERS_KEY,
  isClueDelivery,
  normalizeOrder,
  orderIndexFor,
  readClueDelivery,
  readClueOrders,
  recordedOrderIndex,
  SESSION_ORDER_INDEX_KEY,
  sessionDeliveryMetadata,
  sessionStopOrder,
  validateClueDelivery,
  validateClueOrders,
  withClueDelivery,
} from "@/lib/play/clue-delivery";
import { orderStops, SHUFFLE_STOPS_KEY } from "@/lib/play/stop-order";
import { buildActiveHunt } from "@/lib/play/active-hunt-builder";

const stops = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, sort_order: i }));
const findIds = stops.map((f) => f.id);
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((f) => f.id);

describe("readClueDelivery", () => {
  it("reads an explicit mode", () => {
    expect(readClueDelivery({ clue_delivery: "all_at_once" })).toBe("all_at_once");
    expect(readClueDelivery({ clue_delivery: "fixed_order" })).toBe("fixed_order");
    expect(readClueDelivery({ clue_delivery: "assigned_order" })).toBe("assigned_order");
    expect(readClueDelivery({ clue_delivery: "random_order" })).toBe("random_order");
  });

  it("reads the legacy shuffle flag as random_order", () => {
    expect(readClueDelivery({ shuffle_stops: true })).toBe("random_order");
  });

  it("lets an explicit mode win over the legacy flag", () => {
    expect(readClueDelivery({ clue_delivery: "fixed_order", shuffle_stops: true })).toBe("fixed_order");
  });

  it("defaults to the creator's fixed order", () => {
    expect(readClueDelivery({})).toBe("fixed_order");
    expect(readClueDelivery(null)).toBe("fixed_order");
    expect(readClueDelivery(undefined)).toBe("fixed_order");
    expect(readClueDelivery({ clue_delivery: "sideways" })).toBe("fixed_order");
    expect(readClueDelivery({ shuffle_stops: "true" })).toBe("fixed_order");
  });

  it("recognises the four modes only", () => {
    expect(isClueDelivery("all_at_once")).toBe(true);
    expect(isClueDelivery("nope")).toBe(false);
    expect(isClueDelivery(3)).toBe(false);
  });
});

describe("readClueOrders", () => {
  it("keeps only arrays of string ids", () => {
    expect(readClueOrders({ clue_orders: [["a", "b"], ["b", "a"]] })).toEqual([["a", "b"], ["b", "a"]]);
    expect(readClueOrders({ clue_orders: [["a", 1], "x", null] })).toEqual([]);
    expect(readClueOrders({ clue_orders: "a,b" })).toEqual([]);
    expect(readClueOrders(null)).toEqual([]);
  });
});

describe("withClueDelivery", () => {
  it("returns a new object and never mutates the input", () => {
    const before = { hide_scores: true, shuffle_stops: true };
    const frozen = Object.freeze({ ...before });
    const out = withClueDelivery(frozen, "fixed_order");
    expect(out).not.toBe(frozen);
    expect(frozen).toEqual(before);
    expect(out.hide_scores).toBe(true);
  });

  it("keeps the legacy flag in step for older readers", () => {
    expect(withClueDelivery({}, "random_order")[SHUFFLE_STOPS_KEY]).toBe(true);
    expect(withClueDelivery({ shuffle_stops: true }, "fixed_order")[SHUFFLE_STOPS_KEY]).toBe(false);
    expect(withClueDelivery({}, "all_at_once")[CLUE_DELIVERY_KEY]).toBe("all_at_once");
  });

  it("stores orders only for assigned_order", () => {
    const orders = [["f0", "f1"], ["f1", "f0"]];
    expect(withClueDelivery({}, "assigned_order", orders)[CLUE_ORDERS_KEY]).toEqual(orders);
    expect(withClueDelivery({ clue_orders: orders }, "fixed_order")).not.toHaveProperty(CLUE_ORDERS_KEY);
  });

  it("copies the orders it stores", () => {
    const orders = [["f0", "f1"]];
    const out = withClueDelivery({}, "assigned_order", orders);
    (out[CLUE_ORDERS_KEY] as string[][])[0].push("x");
    expect(orders).toEqual([["f0", "f1"]]);
  });
});

describe("validateClueOrders", () => {
  it("accepts two or more full permutations", () => {
    expect(validateClueOrders([findIds, [...findIds].reverse()], findIds)).toEqual({ ok: true });
  });

  it("allows repeated orders (weighting one order over another)", () => {
    expect(validateClueOrders([findIds, findIds, [...findIds].reverse()], findIds).ok).toBe(true);
  });

  it("needs at least two orders", () => {
    const result = validateClueOrders([findIds], findIds);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least 2/);
  });

  it("rejects an order missing a stop", () => {
    const result = validateClueOrders([findIds, findIds.slice(1)], findIds);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Order 2/);
  });

  it("rejects an order with a repeated or unknown stop", () => {
    expect(validateClueOrders([findIds, ["f0", "f0", "f2", "f3", "f4"]], findIds).ok).toBe(false);
    expect(validateClueOrders([findIds, ["f0", "f1", "f2", "f3", "zz"]], findIds).ok).toBe(false);
  });

  it("caps how many orders a hunt can have", () => {
    const many = Array.from({ length: 13 }, () => findIds);
    expect(validateClueOrders(many, findIds).ok).toBe(false);
  });
});

describe("validateClueDelivery", () => {
  it("only checks orders for assigned_order", () => {
    expect(validateClueDelivery({ clue_delivery: "fixed_order", clue_orders: [["junk"]] }, findIds).ok).toBe(true);
    expect(validateClueDelivery({ clue_delivery: "assigned_order" }, findIds).ok).toBe(false);
    expect(
      validateClueDelivery({ clue_delivery: "assigned_order", clue_orders: [findIds, [...findIds].reverse()] }, findIds).ok
    ).toBe(true);
  });

  it("rejects an unknown explicit mode", () => {
    expect(validateClueDelivery({ clue_delivery: "sideways" }, findIds).ok).toBe(false);
  });
});

describe("normalizeOrder", () => {
  it("drops removed or repeated stops and appends new ones in creator order", () => {
    expect(normalizeOrder(["f3", "gone", "f1", "f3"], findIds)).toEqual(["f3", "f1", "f0", "f2", "f4"]);
  });
});

describe("assignOrderIndex", () => {
  it("is deterministic per player and hunt", () => {
    expect(assignOrderIndex("user-1", "hunt-1", 3)).toBe(assignOrderIndex("user-1", "hunt-1", 3));
  });

  it("stays in range", () => {
    for (let i = 0; i < 50; i++) {
      const index = assignOrderIndex(`u${i}`, "hunt-1", 4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
  });

  it("spreads players roughly evenly across the orders", () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[assignOrderIndex(`player-${i}`, "hunt-x", 3)] += 1;
    for (const count of counts) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it("returns 0 when there is nothing to choose from", () => {
    expect(assignOrderIndex("u", "h", 0)).toBe(0);
  });
});

describe("recordedOrderIndex / orderIndexFor", () => {
  it("uses a valid recorded index", () => {
    expect(recordedOrderIndex({ [SESSION_ORDER_INDEX_KEY]: 1 }, 3)).toBe(1);
    expect(orderIndexFor({ clue_order_index: 2 }, { userId: "u", huntId: "h", orderCount: 3 })).toBe(2);
  });

  it("ignores a missing or out-of-range index and falls back to the assignment", () => {
    expect(recordedOrderIndex({ clue_order_index: 5 }, 3)).toBeNull();
    expect(recordedOrderIndex({ clue_order_index: "1" }, 3)).toBeNull();
    expect(recordedOrderIndex(null, 3)).toBeNull();
    expect(orderIndexFor({}, { userId: "u", huntId: "h", orderCount: 3 })).toBe(assignOrderIndex("u", "h", 3));
  });
});

describe("sessionDeliveryMetadata", () => {
  it("records the mode, and the order group for assigned_order", () => {
    expect(sessionDeliveryMetadata("fixed_order", null)).toEqual({ clue_delivery: "fixed_order" });
    expect(sessionDeliveryMetadata("assigned_order", 2)).toEqual({ clue_delivery: "assigned_order", clue_order_index: 2 });
  });
});

describe("sessionStopOrder", () => {
  const unsorted = [stops[3], stops[0], stops[4], stops[1], stops[2]];

  it("uses the creator's order for fixed_order and all_at_once", () => {
    for (const mode of ["fixed_order", "all_at_once"]) {
      const out = sessionStopOrder(unsorted, { huntMetadata: { clue_delivery: mode }, sessionId: "s", orderIndex: null });
      expect(ids(out)).toEqual(findIds);
    }
  });

  it("matches the existing per-session shuffle for random_order and the legacy flag", () => {
    const expected = ids(orderStops(stops, { shuffle: true, seed: "s1" }));
    expect(ids(sessionStopOrder(stops, { huntMetadata: { clue_delivery: "random_order" }, sessionId: "s1", orderIndex: null }))).toEqual(expected);
    expect(ids(sessionStopOrder(stops, { huntMetadata: { shuffle_stops: true }, sessionId: "s1", orderIndex: null }))).toEqual(expected);
  });

  it("follows the assigned order group", () => {
    const meta = { clue_delivery: "assigned_order", clue_orders: [findIds, ["f4", "f2", "f0", "f1", "f3"]] };
    expect(ids(sessionStopOrder(stops, { huntMetadata: meta, sessionId: "s", orderIndex: 1 }))).toEqual(["f4", "f2", "f0", "f1", "f3"]);
    expect(ids(sessionStopOrder(stops, { huntMetadata: meta, sessionId: "s", orderIndex: 0 }))).toEqual(findIds);
  });

  it("tolerates stops added or removed after the orders were written", () => {
    const meta = { clue_delivery: "assigned_order", clue_orders: [["f4", "gone", "f2"], ["f0"]] };
    expect(ids(sessionStopOrder(stops, { huntMetadata: meta, sessionId: "s", orderIndex: 0 }))).toEqual(["f4", "f2", "f0", "f1", "f3"]);
  });

  it("falls back to the creator's order when the assigned group is unusable", () => {
    const meta = { clue_delivery: "assigned_order", clue_orders: [] };
    expect(ids(sessionStopOrder(stops, { huntMetadata: meta, sessionId: "s", orderIndex: 3 }))).toEqual(findIds);
  });

  it("never mutates the input", () => {
    const input = [...unsorted];
    sessionStopOrder(input, { huntMetadata: { clue_delivery: "random_order" }, sessionId: "s", orderIndex: null });
    expect(ids(input)).toEqual(ids(unsorted));
  });
});

describe("active hunt builder with clue delivery", () => {
  const done = (findId: string) => ({
    play_session_id: "s1",
    find_id: findId,
    arrived_at: null,
    completed_at: "2026-01-01T00:00:00Z",
    created_at: null,
  });

  it("all_at_once: the current stop is the number found plus one", () => {
    const hunt = { id: "h", title: "T", metadata: { clue_delivery: "all_at_once" } };
    expect(buildActiveHunt(hunt, "s1", stops, [done("f3")], null).currentStop).toBe(2);
  });

  it("assigned_order: resumes at the first unfinished stop of the session's group", () => {
    const hunt = {
      id: "h",
      title: "T",
      metadata: { clue_delivery: "assigned_order", clue_orders: [findIds, ["f4", "f3", "f2", "f1", "f0"]] },
    };
    expect(buildActiveHunt(hunt, "s1", stops, [done("f4")], null, 1).currentStop).toBe(2);
    expect(buildActiveHunt(hunt, "s1", stops, [done("f4")], null, 0).currentStop).toBe(1);
  });
});

describe("checkStopAccess", () => {
  const orderedIds = ["f2", "f0", "f1"];

  it("in all_at_once allows any stop in the hunt", () => {
    expect(checkStopAccess({ mode: "all_at_once", orderedIds, completedIds: new Set(), findId: "f1" })).toEqual({ ok: true });
  });

  it("in ordered modes allows only the current stop", () => {
    for (const mode of ["fixed_order", "assigned_order", "random_order"] as const) {
      expect(checkStopAccess({ mode, orderedIds, completedIds: new Set(), findId: "f2" }).ok).toBe(true);
      expect(checkStopAccess({ mode, orderedIds, completedIds: new Set(), findId: "f0" })).toEqual({
        ok: false,
        reason: "out_of_order",
        currentFindId: "f2",
      });
    }
  });

  it("moves on once the current stop is finished, and still allows finished stops", () => {
    const completedIds = new Set(["f2"]);
    expect(checkStopAccess({ mode: "fixed_order", orderedIds, completedIds, findId: "f0" }).ok).toBe(true);
    expect(checkStopAccess({ mode: "fixed_order", orderedIds, completedIds, findId: "f2" }).ok).toBe(true);
    expect(checkStopAccess({ mode: "fixed_order", orderedIds, completedIds, findId: "f1" }).ok).toBe(false);
  });

  it("rejects a stop that is not in the hunt in every mode", () => {
    for (const mode of ["all_at_once", "fixed_order"] as const) {
      expect(checkStopAccess({ mode, orderedIds, completedIds: new Set(), findId: "zz" })).toEqual({
        ok: false,
        reason: "not_in_hunt",
        currentFindId: null,
      });
    }
  });
});
