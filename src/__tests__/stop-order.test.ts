import { describe, expect, it } from "vitest";
import { isShuffled, orderStops, seededShuffle, SHUFFLE_STOPS_KEY } from "@/lib/play/stop-order";

const stops = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, sort_order: i }));
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((f) => f.id);

describe("isShuffled", () => {
  it("is true only for an explicit true flag", () => {
    expect(SHUFFLE_STOPS_KEY).toBe("shuffle_stops");
    expect(isShuffled({ shuffle_stops: true })).toBe(true);
    expect(isShuffled({ shuffle_stops: false })).toBe(false);
    expect(isShuffled({ shuffle_stops: "true" })).toBe(false);
    expect(isShuffled({})).toBe(false);
    expect(isShuffled(null)).toBe(false);
    expect(isShuffled(undefined)).toBe(false);
  });
});

describe("seededShuffle", () => {
  it("keeps every item exactly once and leaves the input untouched", () => {
    const input = [...stops];
    const out = seededShuffle(input, "session-1");
    expect([...ids(out)].sort()).toEqual([...ids(stops)].sort());
    expect(ids(input)).toEqual(ids(stops));
    expect(out).not.toBe(input);
  });

  it("is stable for the same seed", () => {
    expect(ids(seededShuffle(stops, "session-1"))).toEqual(ids(seededShuffle(stops, "session-1")));
  });

  it("gives different sessions different orders", () => {
    const orders = new Set(
      ["a", "b", "c", "d", "e", "f"].map((seed) => ids(seededShuffle(stops, seed)).join(","))
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it("actually moves stops away from the creator's order", () => {
    const seeds = Array.from({ length: 20 }, (_, i) => `seed-${i}`);
    const unchanged = seeds.filter((seed) => ids(seededShuffle(stops, seed)).join() === ids(stops).join());
    expect(unchanged.length).toBeLessThan(2);
  });

  it("handles empty and single-item lists", () => {
    expect(seededShuffle([], "x")).toEqual([]);
    expect(seededShuffle([1], "x")).toEqual([1]);
  });
});

describe("orderStops", () => {
  const scrambled = [stops[3], stops[0], stops[2], stops[1]];

  it("uses the creator's order when shuffle is off", () => {
    expect(ids(orderStops(scrambled, { shuffle: false, seed: "s1" }))).toEqual(["f0", "f1", "f2", "f3"]);
  });

  it("falls back to the creator's order without a session seed", () => {
    expect(ids(orderStops(scrambled, { shuffle: true, seed: null }))).toEqual(["f0", "f1", "f2", "f3"]);
    expect(ids(orderStops(scrambled, { shuffle: true, seed: undefined }))).toEqual(["f0", "f1", "f2", "f3"]);
  });

  it("shuffles independent of the order the stops arrived in", () => {
    const fromScrambled = ids(orderStops(scrambled, { shuffle: true, seed: "s1" }));
    const fromSorted = ids(orderStops(stops.slice(0, 4), { shuffle: true, seed: "s1" }));
    expect(fromScrambled).toEqual(fromSorted);
  });

  it("treats a null sort_order as 0", () => {
    const list = [{ id: "b", sort_order: 1 }, { id: "a", sort_order: null }];
    expect(ids(orderStops(list, { shuffle: false, seed: null }))).toEqual(["a", "b"]);
  });
});
