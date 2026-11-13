import { describe, it, expect } from "vitest";
import {
  ACCURACY_ALLOWANCE_CAP_M,
  DEFAULT_STOP_RADIUS_M,
  checkArrival,
  formatDistance,
  stopRadius,
} from "@/lib/play/arrival-check";
import { interpretCheckIn } from "@/lib/play/check-in";

describe("checkArrival", () => {
  it("accepts a fix inside the radius", () => {
    expect(checkArrival({ distance: 10, accuracy: 5, radius: 25 })).toEqual({ kind: "inside" });
  });

  it("subtracts GPS error, up to the cap", () => {
    expect(checkArrival({ distance: 40, accuracy: 15, radius: 25 }).kind).toBe("inside");
    expect(checkArrival({ distance: 25 + ACCURACY_ALLOWANCE_CAP_M + 1, accuracy: 45, radius: 25 }).kind).toBe("too_far");
  });

  it("treats a missing accuracy as no allowance", () => {
    expect(checkArrival({ distance: 26, accuracy: null, radius: 25 })).toEqual({ kind: "too_far", distance: 26, radius: 25 });
  });

  it("rejects a vague fix even when it lands on the stop", () => {
    expect(checkArrival({ distance: 0, accuracy: 51, radius: 25 })).toEqual({ kind: "weak_gps", accuracy: 51 });
  });

  it("ignores nonsense accuracy values", () => {
    expect(checkArrival({ distance: 26, accuracy: -5, radius: 25 }).kind).toBe("too_far");
    expect(checkArrival({ distance: 26, accuracy: Number.NaN, radius: 25 }).kind).toBe("too_far");
  });

  it("falls back to the default radius", () => {
    expect(stopRadius(null)).toBe(DEFAULT_STOP_RADIUS_M);
    expect(stopRadius(0)).toBe(DEFAULT_STOP_RADIUS_M);
    expect(stopRadius(60)).toBe(60);
  });
});

describe("formatDistance", () => {
  it("rounds metres to 5 and switches to km", () => {
    expect(formatDistance(142)).toBe("about 140 m");
    expect(formatDistance(1)).toBe("about 5 m");
    expect(formatDistance(1234)).toBe("about 1.2 km");
  });
});

describe("interpretCheckIn", () => {
  it("moves on when the server recorded the arrival", () => {
    expect(interpretCheckIn({ arrived: true })).toEqual({ kind: "arrived" });
  });

  it("offers the photo route only when the server allows it", () => {
    expect(interpretCheckIn({ arrived: false, reason: "no_gps", photo_allowed: true })).toEqual({ kind: "photo", reason: "no_gps" });
    expect(interpretCheckIn({ arrived: false, reason: "weak_gps", photo_allowed: true })).toEqual({ kind: "photo", reason: "weak_gps" });
    expect(interpretCheckIn({ arrived: false, reason: "weak_gps", photo_allowed: false }).kind).toBe("failed");
  });

  it("tells the player how far they are", () => {
    const out = interpretCheckIn({ arrived: false, reason: "too_far", distance: 142 });
    expect(out).toEqual({ kind: "too_far", message: `You're about 140 m from this stop. Get closer, then tap "I'm here" again.` });
  });

  it("asks for a retry on anything unexpected", () => {
    expect(interpretCheckIn({}).kind).toBe("failed");
  });
});
