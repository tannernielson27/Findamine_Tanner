import { describe, it, expect } from "vitest";
import {
  HEAT_ZONES,
  formatDistanceLabel,
  getHotColdZone,
  parseHeatZone,
  type HeatZone,
  type HotColdZone,
} from "@/lib/services/hot-cold";
import { DEFAULT_STOP_RADIUS_M } from "@/lib/play/arrival-check";

const RADIUS = DEFAULT_STOP_RADIUS_M; // 25 m
/** The three leg lengths from the pilot feedback: campus, mid, city. */
const LEGS = [150, 500, 3000];

function read(distance: number, leg: number | null, previousZone: HeatZone | null = null, radius = RADIUS): HotColdZone {
  return getHotColdZone({ distanceMeters: distance, radiusMeters: radius, referenceMeters: leg, previousZone });
}

/** Distances from the start of the leg down to just outside the radius, 1 m apart. */
function walkIn(leg: number, radius = RADIUS): number[] {
  const steps: number[] = [];
  for (let d = leg; d > radius; d -= 1) steps.push(d);
  return steps;
}

function zoneIndex(zone: HeatZone): number {
  return HEAT_ZONES.indexOf(zone);
}

/** The marker must sit inside the fifth of the scale that belongs to its zone. */
function expectMarkerInsideZone(reading: HotColdZone) {
  const lo = zoneIndex(reading.zone) * 20;
  expect(reading.markerPercent).toBeGreaterThanOrEqual(lo);
  expect(reading.markerPercent).toBeLessThan(lo + 20);
}

describe("hot/cold scale: the walk spans the meter on any leg", () => {
  it.each(LEGS)("starts a %d m leg near the cold end, with room below for walking away", (leg) => {
    const start = read(leg, leg);
    expect(start.zone).toBe("icy");
    expect(start.markerPercent).toBe(10);
  });

  it.each(LEGS)("treats the first reading of a %d m leg as its own reference", (leg) => {
    expect(read(leg, null)).toEqual(read(leg, leg));
  });

  it.each(LEGS)("moves the marker forward with every metre walked on a %d m leg", (leg) => {
    const markers = walkIn(leg).map((d) => read(d, leg).markerPercent);
    for (let i = 1; i < markers.length; i++) expect(markers[i]).toBeGreaterThanOrEqual(markers[i - 1]);
    // Reaches the top of the last pre-arrival step by the edge of the radius.
    expect(markers[markers.length - 1]).toBeGreaterThan(75);
    expect(Math.max(...markers)).toBeLessThan(80);
  });

  it.each(LEGS)("passes through icy, cold, warm and hot in order on a %d m leg", (leg) => {
    const seen = walkIn(leg).map((d) => read(d, leg).zone);
    const order = seen.filter((zone, i) => zone !== seen[i - 1]);
    expect(order).toEqual(["icy", "cold", "warm", "hot"]);
  });

  it.each(LEGS)("is visibly under way halfway along a %d m leg", (leg) => {
    expect(read(leg / 2, leg).markerPercent - read(leg, leg).markerPercent).toBeGreaterThanOrEqual(8);
  });

  it("uses a log scale: halving the distance moves the marker the same amount anywhere on the leg", () => {
    const far = read(1500, 3000).markerPercent - read(3000, 3000).markerPercent;
    const near = read(100, 3000).markerPercent - read(200, 3000).markerPercent;
    expect(far).toBeGreaterThan(5);
    // Equal up to the one-decimal rounding of each marker position.
    expect(Math.abs(far - near)).toBeLessThan(0.25);
  });

  it.each(LEGS)("moves more per metre close to the stop than at the start of a %d m leg", (leg) => {
    const firstTenth = read(leg * 0.9, leg).markerPercent - read(leg, leg).markerPercent;
    const sameMetresNearStop = read(RADIUS + 1, leg).markerPercent - read(RADIUS + 1 + leg * 0.1, leg).markerPercent;
    expect(sameMetresNearStop).toBeGreaterThan(firstTenth);
  });

  it.each(LEGS)("keeps the marker inside its zone's step on a %d m leg", (leg) => {
    for (const d of [...walkIn(leg), RADIUS, 10, 0, leg * 1.5, leg * 4]) expectMarkerInsideZone(read(d, leg));
  });
});

describe("hot/cold scale: burning means at the stop", () => {
  it.each(LEGS)("is burning exactly inside the arrival radius on a %d m leg", (leg) => {
    expect(read(RADIUS, leg).zone).toBe("burning");
    expect(read(RADIUS / 2, leg).zone).toBe("burning");
    expect(read(0, leg).zone).toBe("burning");
    expect(read(RADIUS + 1, leg).zone).toBe("hot");
  });

  it("pins the marker in the middle of the top step, so GPS noise at the stop can't move it", () => {
    expect([0, 5, 12, 25].map((d) => read(d, 150).markerPercent)).toEqual([90, 90, 90, 90]);
  });

  it("is never reachable from far away, however long the leg", () => {
    for (const leg of [3000, 5000, 40_000]) {
      expect(read(60, leg).zone).not.toBe("burning");
      expect(read(RADIUS + 0.5, leg).zone).not.toBe("burning");
    }
  });

  it("follows the stop's own radius", () => {
    expect(read(50, 600, null, 50).zone).toBe("burning");
    expect(read(51, 600, null, 50).zone).toBe("hot");
    expect(read(20, 150, null, 15).zone).toBe("hot");
    expect(read(15, 150, null, 15).zone).toBe("burning");
    expect(read(900, 3000, null, 1000).zone).toBe("burning");
  });

  it("is burning whenever the arrival check has placed the player at the stop", () => {
    // 40 m with ±15 m GPS error is inside a 25 m radius for the arrival check.
    const reading = getHotColdZone({ distanceMeters: 40, radiusMeters: RADIUS, referenceMeters: 150, atStop: true });
    expect(reading.zone).toBe("burning");
    expect(reading.markerPercent).toBe(90);
  });

  it("falls back to the default radius when the stop has none", () => {
    expect(read(RADIUS, 150, null, 0).zone).toBe("burning");
    expect(read(RADIUS + 1, 150, null, Number.NaN).zone).toBe("hot");
  });
});

describe("hot/cold scale: walking away from the stop", () => {
  it("slides the marker below the start position, down to the cold end at twice the start distance", () => {
    const start = read(150, 150).markerPercent;
    const away = [170, 200, 250, 299].map((d) => read(d, 150).markerPercent);
    expect(away[0]).toBeLessThan(start);
    for (let i = 1; i < away.length; i++) expect(away[i]).toBeLessThan(away[i - 1]);
    expect(read(300, 150).markerPercent).toBe(0);
  });

  it("never goes below zero or leaves the icy zone, however far the player goes", () => {
    for (const d of [301, 1000, 50_000, 1e9]) {
      const reading = read(d, 150);
      expect(reading.zone).toBe("icy");
      expect(reading.markerPercent).toBe(0);
    }
  });

  it("picks the walk back up from where the player turned round", () => {
    expect(read(150, 150).markerPercent).toBe(10);
    expect(read(100, 150).markerPercent).toBeGreaterThan(20);
  });
});

describe("hot/cold scale: reference distance clamps", () => {
  it("does not stretch a tiny leg over the whole meter", () => {
    // First reading 30 m out with a 25 m radius: the player is already close.
    const start = read(30, 30);
    expect(start.zone).toBe("hot");
    // 3 m of GPS wobble must not throw the marker across the scale.
    expect(Math.abs(read(33, 30).markerPercent - start.markerPercent)).toBeLessThan(6);
  });

  it("treats every reference below the minimum the same", () => {
    expect(read(60, 30)).toEqual(read(60, 100));
    expect(read(60, 0)).toEqual(read(60, 100));
    expect(read(60, -5)).toEqual(read(60, 100));
  });

  it("scales the minimum with a large radius", () => {
    // 4 x 1000 m radius: a 1.2 km first reading is "close" for this stop.
    const reading = read(1200, 1200, null, 1000);
    expect(reading.zone).toBe("hot");
    expect(read(4000, 4000, null, 1000).markerPercent).toBe(10);
  });

  it("caps a huge reference so the last kilometres still use the meter", () => {
    // Hunt opened at home, 40 km from the first stop.
    expect(read(40_000, 40_000).markerPercent).toBe(0);
    expect(read(5000, 40_000).markerPercent).toBe(10);
    expect(read(1000, 40_000)).toEqual(read(1000, 5000));
    expect(read(60, 40_000).zone).toBe("hot");
  });

  it("survives a reference that is not a number", () => {
    const reading = read(120, Number.NaN);
    expect(Number.isFinite(reading.markerPercent)).toBe(true);
    expect(reading).toEqual(read(120, 120));
  });
});

describe("hot/cold scale: GPS jitter", () => {
  it.each(LEGS)("barely moves the marker for a 3 m wobble mid-way along a %d m leg", (leg) => {
    const mid = leg / 2;
    expect(Math.abs(read(mid + 3, leg).markerPercent - read(mid, leg).markerPercent)).toBeLessThan(2);
  });

  // On a 500 m leg the cold/warm boundary (40%) falls at about 138.5 m.
  const JUST_COLD = 140;
  const JUST_WARM = 137;

  it("has a boundary between those two test distances", () => {
    expect(read(JUST_COLD, 500).zone).toBe("cold");
    expect(read(JUST_WARM, 500).zone).toBe("warm");
  });

  it("holds the zone the player was shown while readings wobble across a boundary", () => {
    const heldCold = read(JUST_WARM, 500, "cold");
    expect(heldCold.zone).toBe("cold");
    expectMarkerInsideZone(heldCold);

    const heldWarm = read(JUST_COLD, 500, "warm");
    expect(heldWarm.zone).toBe("warm");
    expectMarkerInsideZone(heldWarm);
  });

  it("changes zone once at most while the player stands on a boundary", () => {
    const noise = [3, -2, 1, -3, 2, -1, 3, -3, 0, 2, -2, 3, -1, 1, -3];
    let previous: HeatZone | null = null;
    let changes = 0;
    for (const offset of noise) {
      const reading = read(138.5 + offset, 500, previous);
      if (previous && reading.zone !== previous) changes++;
      previous = reading.zone;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });

  it("flips on every wobble without the previous zone (what the hold prevents)", () => {
    const zones = [JUST_COLD, JUST_WARM, JUST_COLD, JUST_WARM].map((d) => read(d, 500).zone);
    expect(zones).toEqual(["cold", "warm", "cold", "warm"]);
  });

  it("still changes zone on a real move past the boundary, in either direction", () => {
    expect(read(120, 500, "cold").zone).toBe("warm");
    expect(read(160, 500, "warm").zone).toBe("cold");
    // Several zones at once is not noise.
    expect(read(40, 500, "icy").zone).toBe("hot");
  });

  it("holds burning for a few metres past the radius, then lets go", () => {
    expect(read(RADIUS + 3, 150, "burning").zone).toBe("burning");
    expect(read(RADIUS + 3, 150, "hot").zone).toBe("hot");
    expect(read(RADIUS + 10, 150, "burning").zone).toBe("hot");
  });

  it("never needs a margin to enter burning: inside the radius is at the stop", () => {
    expect(read(RADIUS, 150, "hot").zone).toBe("burning");
    expect(read(RADIUS, 150, "icy").zone).toBe("burning");
  });

  it("keeps the marker inside the held zone's step for every previous zone", () => {
    for (const leg of LEGS) {
      for (const previous of HEAT_ZONES) {
        for (const d of [...walkIn(leg).filter((_, i) => i % 7 === 0), RADIUS + 2, RADIUS, leg * 1.3]) {
          expectMarkerInsideZone(read(d, leg, previous));
        }
      }
    }
  });
});

describe("hot/cold reading details", () => {
  it("labels the distance in metres below a kilometre and kilometres above, whatever the zone", () => {
    expect(formatDistanceLabel(42.4)).toBe("42m");
    expect(formatDistanceLabel(999.4)).toBe("999m");
    expect(formatDistanceLabel(999.6)).toBe("1.0km");
    expect(formatDistanceLabel(1540)).toBe("1.5km");
    // 1.5 km into a 3 km leg is "cold", not "icy": still shown in km.
    const reading = read(1500, 3000);
    expect(reading.zone).toBe("cold");
    expect(reading.distanceLabel).toBe("1.5km");
  });

  it("gives every zone a colour and a label", () => {
    const readings = [read(150, 150), read(90, 150), read(55, 150), read(30, 150), read(10, 150)];
    expect(readings.map((r) => r.zone)).toEqual([...HEAT_ZONES]);
    for (const r of readings) {
      expect(r.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("parses only the five zone names", () => {
    expect(HEAT_ZONES.map(parseHeatZone)).toEqual([...HEAT_ZONES]);
    expect(parseHeatZone("lukewarm")).toBeNull();
    expect(parseHeatZone(4)).toBeNull();
    expect(parseHeatZone(undefined)).toBeNull();
  });
});
