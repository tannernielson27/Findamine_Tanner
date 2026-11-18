import { describe, it, expect } from "vitest";
import { initialStep, mergeStops, stepAfterStart, withStartedStop } from "@/lib/play/stop-state";
import type { Find } from "@/lib/play/play-types";

/** Client-side stop state for issue #16: which step a stop opens on, and how fresh server data is merged in. */

const locked = (id: string, extra: Partial<Find> = {}): Find => ({
  id,
  sort_order: 0,
  started_at: null,
  open: true,
  clue_text: null,
  hot_cold_enabled: null,
  scaffolding_level: null,
  reading_check: null,
  locations: null,
  tasks: null,
  primers: null,
  ...extra,
});

const started = (id: string, extra: Partial<Find> = {}): Find =>
  locked(id, {
    started_at: "2026-11-18T10:05:00.000Z",
    clue_text: "Look for the carillon",
    hot_cold_enabled: true,
    locations: { name: "Bell Tower", latitude: 40.25, longitude: -111.65, radius_meters: 50 },
    ...extra,
  });

describe("initialStep", () => {
  it("opens an unstarted stop on the ready step, with or without a primer", () => {
    expect(initialStep(locked("a"), false)).toBe("prime");
    expect(initialStep(locked("a", { primers: { title: "Read me", content: {} } }), false)).toBe("prime");
  });

  it("resumes a started stop on its clue, without asking the player to start again", () => {
    expect(initialStep(started("a"), false)).toBe("clue");
    expect(initialStep(started("a", { primers: { title: "Read me", content: {} } }), false)).toBe("clue");
  });

  it("shows the results of a finished stop", () => {
    expect(initialStep(started("a"), true)).toBe("feedback");
  });
});

describe("stepAfterStart", () => {
  const question = { question: "Q", options: ["a", "b"], correct_answer: "a" };

  it("goes to the reading check when the stop has one, otherwise to the clue", () => {
    expect(stepAfterStart(started("a", { reading_check: { enabled: true, questions: [question] } }))).toBe("reading_check");
    expect(stepAfterStart(started("a", { reading_check: { enabled: false, questions: [question] } }))).toBe("clue");
    expect(stepAfterStart(started("a", { reading_check: { enabled: true, questions: [] } }))).toBe("clue");
    expect(stepAfterStart(started("a"))).toBe("clue");
  });
});

describe("withStartedStop", () => {
  it("puts the released details in place without touching the other stops or the input", () => {
    const stops = [locked("a"), locked("b")];
    const next = withStartedStop(stops, started("b"));
    expect(next[0]).toBe(stops[0]);
    expect(next[1].clue_text).toBe("Look for the carillon");
    expect(stops[1].clue_text).toBeNull();
  });
});

describe("mergeStops", () => {
  it("takes the server's list and order", () => {
    const fresh = [locked("b"), locked("a")];
    expect(mergeStops([], fresh)).toEqual(fresh);
    expect(mergeStops([locked("a"), locked("b")], fresh).map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("keeps the same object for a stop that was already started, and updates the rest", () => {
    const current = [started("a"), locked("b", { open: false })];
    const fresh = [started("a"), locked("b", { open: true, primers: { title: "Read me", content: {} } })];
    const merged = mergeStops(current, fresh);
    expect(merged[0]).toBe(current[0]);
    expect(merged[1]).toBe(fresh[1]);
    expect(merged[1].open).toBe(true);
  });

  it("never downgrades a started stop to a locked one", () => {
    const current = [started("a")];
    expect(mergeStops(current, [locked("a")])[0]).toBe(current[0]);
  });
});
