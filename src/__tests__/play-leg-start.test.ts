import { describe, it, expect } from "vitest";
import {
  LEG_START_MAX_AGE_MS,
  clearLegStart,
  isVagueFix,
  legStartAfterReply,
  legStartToSend,
  loadLegStart,
  saveLegStart,
  type LegStart,
} from "@/lib/play/leg-start";

/** Minimal in-memory Storage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const brokenStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const firm: LegStart = { meters: 400, provisional: false };
const provisional: LegStart = { meters: 1200, provisional: true };

describe("isVagueFix", () => {
  it("matches the arrival check: only fixes vaguer than 50 m are too rough", () => {
    expect(isVagueFix(50)).toBe(false);
    expect(isVagueFix(51)).toBe(true);
    expect(isVagueFix(8)).toBe(false);
    expect(isVagueFix(null)).toBe(false);
    expect(isVagueFix(Number.NaN)).toBe(false);
  });
});

describe("legStartToSend", () => {
  it("sends nothing on the first reading, so the server starts the leg there", () => {
    expect(legStartToSend(null, false)).toBeNull();
    expect(legStartToSend(null, true)).toBeNull();
  });

  it("echoes a settled start with every later reading", () => {
    expect(legStartToSend(firm, false)).toBe(400);
    expect(legStartToSend(firm, true)).toBe(400);
  });

  it("keeps a provisional start only until a usable fix arrives", () => {
    expect(legStartToSend(provisional, true)).toBe(1200);
    expect(legStartToSend(provisional, false)).toBeNull();
  });
});

describe("legStartAfterReply", () => {
  it("takes the first reported distance as the start of the leg", () => {
    expect(legStartAfterReply(null, null, 151.6, false)).toEqual({ meters: 152, provisional: false });
  });

  it("marks a start taken from a vague fix as provisional", () => {
    expect(legStartAfterReply(null, null, 1200.2, true)).toEqual(provisional);
  });

  it("replaces a provisional start with the first usable reading", () => {
    expect(legStartAfterReply(provisional, null, 400, false)).toEqual(firm);
  });

  it("leaves the start alone while the player walks in, or wanders a little further out", () => {
    expect(legStartAfterReply(firm, 400, 120, false)).toBe(firm);
    expect(legStartAfterReply(firm, 400, 790, false)).toBe(firm);
    expect(legStartAfterReply(provisional, 1200, 900, true)).toBe(provisional);
  });

  it("follows a player who walks far past the start, so the walk back uses the meter", () => {
    // Start saved at 120 m; the player is now 800 m away (the marker hit the cold end at 240 m).
    const near: LegStart = { meters: 120, provisional: false };
    expect(legStartAfterReply(near, 120, 800, false)).toEqual({ meters: 400, provisional: false });
    // Never shrinks again on the way back.
    const followed: LegStart = { meters: 400, provisional: false };
    expect(legStartAfterReply(followed, 400, 300, false)).toBe(followed);
  });

  it("doesn't stretch the start on a vague fix (one wild reading must not rescale the leg)", () => {
    expect(legStartAfterReply(firm, 400, 6000, true)).toBe(firm);
  });

  it("keeps what it has when the reply carries no distance (hot/cold off)", () => {
    expect(legStartAfterReply(null, null, null, false)).toBeNull();
    expect(legStartAfterReply(null, null, undefined, false)).toBeNull();
    expect(legStartAfterReply(null, null, "150", false)).toBeNull();
    expect(legStartAfterReply(null, null, Number.NaN, false)).toBeNull();
  });

  it("walks through a cold start: vague fix, then GPS settles, then the walk", () => {
    let start: LegStart | null = null;
    const readings = [
      { distance: 1200, vague: true },
      { distance: 900, vague: true },
      { distance: 150, vague: false },
      { distance: 120, vague: false },
      { distance: 80, vague: true },
    ];
    const sent: (number | null)[] = [];
    for (const r of readings) {
      const leg = legStartToSend(start, r.vague);
      sent.push(leg);
      start = legStartAfterReply(start, leg, r.distance, r.vague);
    }
    expect(sent).toEqual([null, 1200, null, 150, 150]);
    expect(start).toEqual({ meters: 150, provisional: false });
  });
});

describe("saving the leg start on the device", () => {
  const NOW = 1_800_000_000_000;

  it("round-trips per hunt and stop", () => {
    const storage = memoryStorage();
    saveLegStart("hunt-1", "find-1", firm, NOW, storage);
    saveLegStart("hunt-1", "find-2", provisional, NOW, storage);
    expect(loadLegStart("hunt-1", "find-1", NOW + 1000, storage)).toEqual(firm);
    expect(loadLegStart("hunt-1", "find-2", NOW + 1000, storage)).toEqual(provisional);
    expect(loadLegStart("hunt-1", "find-3", NOW, storage)).toBeNull();
    expect(loadLegStart("hunt-2", "find-1", NOW, storage)).toBeNull();
  });

  it("holds a distance and a time, never coordinates", () => {
    const storage = memoryStorage();
    saveLegStart("hunt-1", "find-1", firm, NOW, storage);
    const [stored] = [...storage.data.values()];
    expect(JSON.parse(stored)).toEqual({ "find-1": { meters: 400, provisional: false, at: NOW } });
  });

  it("forgets a start after a few hours, so a replay begins a fresh leg", () => {
    const storage = memoryStorage();
    saveLegStart("hunt-1", "find-1", firm, NOW, storage);
    expect(loadLegStart("hunt-1", "find-1", NOW + LEG_START_MAX_AGE_MS - 1, storage)).toEqual(firm);
    expect(loadLegStart("hunt-1", "find-1", NOW + LEG_START_MAX_AGE_MS + 1, storage)).toBeNull();
    // Expired entries are dropped on the next save.
    saveLegStart("hunt-1", "find-2", firm, NOW + LEG_START_MAX_AGE_MS + 1, storage);
    expect(Object.keys(JSON.parse([...storage.data.values()][0]))).toEqual(["find-2"]);
  });

  it("forgets a stop's start on arrival and keeps the other stops'", () => {
    const storage = memoryStorage();
    saveLegStart("hunt-1", "find-1", firm, NOW, storage);
    saveLegStart("hunt-1", "find-2", provisional, NOW, storage);
    clearLegStart("hunt-1", "find-1", NOW, storage);
    expect(loadLegStart("hunt-1", "find-1", NOW, storage)).toBeNull();
    expect(loadLegStart("hunt-1", "find-2", NOW, storage)).toEqual(provisional);
    // Clearing something that isn't there is harmless.
    expect(() => clearLegStart("hunt-9", "find-1", NOW, storage)).not.toThrow();
    expect(() => clearLegStart("hunt-1", "find-1", NOW, null)).not.toThrow();
    expect(() => clearLegStart("hunt-1", "find-1", NOW, brokenStorage)).not.toThrow();
  });

  it("ignores anything in storage that isn't a valid entry", () => {
    for (const raw of ["not json", "[]", "null", '{"find-1":{"meters":"far","at":1}}', '{"find-1":{"meters":-4,"at":1}}', '{"find-1":7}']) {
      const storage = memoryStorage({ "fm:leg-start:hunt-1": raw });
      expect(loadLegStart("hunt-1", "find-1", NOW, storage)).toBeNull();
    }
  });

  it("carries on without storage", () => {
    expect(loadLegStart("hunt-1", "find-1", NOW, null)).toBeNull();
    expect(() => saveLegStart("hunt-1", "find-1", firm, NOW, null)).not.toThrow();
    expect(loadLegStart("hunt-1", "find-1", NOW, brokenStorage)).toBeNull();
    expect(() => saveLegStart("hunt-1", "find-1", firm, NOW, brokenStorage)).not.toThrow();
  });
});
