import { describe, expect, it } from "vitest";
import { arriveDelayMs, distanceMeters, isMeaningfulFix } from "@/lib/play/geo-filter";

const base = { lat: 40.25, lng: -111.65, accuracy: 20 };
// ~1.1 m per 1e-5 degrees of latitude
const north = (m: number, accuracy: number | null = 20) => ({ ...base, lat: base.lat + m / 111320, accuracy });

describe("isMeaningfulFix", () => {
  it("accepts the first fix", () => expect(isMeaningfulFix(null, base)).toBe(true));
  it("ignores sub-3m jitter", () => expect(isMeaningfulFix(base, north(1.5))).toBe(false));
  it("accepts real movement", () => expect(isMeaningfulFix(base, north(5))).toBe(true));
  it("accepts a much better accuracy at the same spot", () => {
    expect(isMeaningfulFix(base, north(0.5, 8))).toBe(true);
    expect(isMeaningfulFix(base, north(0.5, 18))).toBe(false);
  });
  it("measures metres", () => expect(distanceMeters(base, north(100))).toBeCloseTo(100, 0));
});

describe("arriveDelayMs", () => {
  it("sends immediately the first time", () => expect(arriveDelayMs(null, 1000, false)).toBe(0));
  it("spaces far pings by 3s", () => expect(arriveDelayMs(1000, 2000, false)).toBe(2000));
  it("spaces near pings by 1s", () => expect(arriveDelayMs(1000, 1400, true)).toBe(600));
  it("never goes negative", () => expect(arriveDelayMs(0, 10_000, false)).toBe(0));
});
