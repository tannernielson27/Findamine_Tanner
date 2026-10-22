import { describe, it, expect } from "vitest";
import {
  WEAK_ACCURACY_METERS,
  announcementDelay,
  bearingDegrees,
  compassWord,
  heatDisplay,
  isWeakAccuracy,
  splitDistanceLabel,
} from "@/lib/play/proximity";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("heatDisplay", () => {
  it("maps the five zones to the five scale steps with the marker centred on each", () => {
    const zones = ["icy", "cold", "warm", "hot", "burning"];
    expect(zones.map((z) => heatDisplay(z)?.level)).toEqual([1, 2, 3, 4, 5]);
    expect(zones.map((z) => heatDisplay(z)?.markerPercent)).toEqual([10, 30, 50, 70, 90]);
  });

  it("uses plain, distance-only words (no claim about the direction of travel)", () => {
    for (const zone of ["icy", "cold", "warm", "hot", "burning"]) {
      const label = heatDisplay(zone)!.label;
      expect(label).not.toMatch(/another way|wrong way|turn/i);
      expect(label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("keeps every heat label at 7:1 or better on the white card (outdoor legibility)", () => {
    for (const zone of ["icy", "cold", "warm", "hot", "burning"]) {
      expect(contrast(heatDisplay(zone)!.textColor, "#FFFFFF")).toBeGreaterThanOrEqual(7);
    }
  });

  it("returns null for an unknown zone", () => {
    expect(heatDisplay("tepid")).toBeNull();
    expect(heatDisplay(null)).toBeNull();
  });
});

describe("splitDistanceLabel", () => {
  it("splits the server's labels into number and unit", () => {
    expect(splitDistanceLabel("120m")).toEqual({ value: "120", unit: "m" });
    expect(splitDistanceLabel("1.2km")).toEqual({ value: "1.2", unit: "km" });
    expect(splitDistanceLabel(" 8 m ")).toEqual({ value: "8", unit: "m" });
  });

  it("passes anything else through whole", () => {
    expect(splitDistanceLabel("nearby")).toEqual({ value: "nearby", unit: "" });
  });
});

describe("bearingDegrees / compassWord", () => {
  const here = { lat: 40.2518, lng: -111.6493 };

  it("points north, east, south and west", () => {
    expect(bearingDegrees(here, { lat: 40.26, lng: -111.6493 })).toBeCloseTo(0, 0);
    expect(bearingDegrees(here, { lat: 40.2518, lng: -111.64 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(here, { lat: 40.24, lng: -111.6493 })).toBeCloseTo(180, 0);
    expect(bearingDegrees(here, { lat: 40.2518, lng: -111.66 })).toBeCloseTo(270, 0);
  });

  it("names the nearest of eight compass points", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(44)).toBe("northeast");
    expect(compassWord(181)).toBe("south");
    expect(compassWord(350)).toBe("north");
    expect(compassWord(-90)).toBe("west");
  });
});

describe("isWeakAccuracy", () => {
  it("warns only above the threshold and only for real numbers", () => {
    expect(isWeakAccuracy(WEAK_ACCURACY_METERS)).toBe(false);
    expect(isWeakAccuracy(40)).toBe(true);
    expect(isWeakAccuracy(null)).toBe(false);
    expect(isWeakAccuracy(Number.NaN)).toBe(false);
  });
});

describe("announcementDelay", () => {
  it("announces the first status at once", () => {
    expect(announcementDelay(null, 1000, 8000)).toBe(0);
  });

  it("holds later changes until the gap has passed", () => {
    expect(announcementDelay(1000, 3000, 8000)).toBe(6000);
    expect(announcementDelay(1000, 9000, 8000)).toBe(0);
    expect(announcementDelay(1000, 20000, 8000)).toBe(0);
  });
});
