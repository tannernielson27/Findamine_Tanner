/**
 * Hot/Cold GPS Meter
 *
 * One scaled value drives everything the player sees: the marker position
 * (0 = cold end, 100 = hot end) and, from the fifth of the scale it falls in,
 * the named zone used for the label, colour, announcement and haptics. The
 * two can therefore never disagree.
 *
 * The scale adapts to the leg. It is anchored on the player's distance at
 * their first reading for the stop (the reference) and on the stop's arrival
 * radius, with a log scale of distance in between, so a 150 m campus leg and
 * a 3 km city leg both travel the whole meter and the marker moves more per
 * metre as the player closes in.
 *
 *   inside the radius            burning, marker pinned at 90
 *   radius < d <= reference      10 + 70 x ln(reference / d) / ln(reference / radius)
 *   d > reference (walked away)  10 x (1 - ln(d / reference) / ln(2)), not below 0
 *
 * Zones: icy 0-20, cold 20-40, warm 40-60, hot 60-80, burning 80-100.
 */

import { stopRadius } from "@/lib/play/arrival-check";

export const HEAT_ZONES = ["icy", "cold", "warm", "hot", "burning"] as const;
export type HeatZone = (typeof HEAT_ZONES)[number];

export interface HotColdZone {
  zone: HeatZone;
  color: string;
  label: string;
  emoji: string;
  distanceLabel: string;
  /** Marker position on the meter, % from the cold end. Always inside `zone`'s fifth of the scale. */
  markerPercent: number;
}

export interface HotColdInput {
  /** Metres from the player's fix to the stop. */
  distanceMeters: number;
  /** The stop's arrival radius, the same one the "I'm here" check uses. */
  radiusMeters: number;
  /** Distance at the player's first reading for this stop. Missing: this reading is the first. */
  referenceMeters?: number | null;
  /** The zone the player was last shown, so GPS noise on a boundary doesn't flip it. */
  previousZone?: HeatZone | null;
  /** The arrival check (which allows for GPS error) has placed the player at the stop. */
  atStop?: boolean;
}

/** Width of one zone on the 0-100 scale. */
const ZONE_WIDTH = 20;
/** Where the first reading of a leg sits: off the cold end, so walking away still shows. */
const START_PERCENT = 10;
/** The scale just outside the radius. Everything from here up belongs to "burning". */
const BURNING_FROM = 80;
/** Marker position at the stop: the middle of the top step. */
const BURNING_PERCENT = 90;
/** The marker reaches the cold end once the player is this many times the reference away. */
export const AWAY_FACTOR = 2;
/** Shortest leg the scale is stretched over; a first reading closer than this starts mid-scale. */
export const MIN_REFERENCE_M = 100;
/** ...and never less than this many arrival radii, for stops with a large radius. */
const MIN_REFERENCE_RADII = 4;
/** Longest leg the scale is stretched over; beyond it the marker waits at the cold end. */
export const MAX_REFERENCE_M = 5000;
/** How far past a zone boundary (scale points) a reading must be before the zone changes. */
const ZONE_HOLD = 2;
/** Metres past the radius before a player who was "burning" drops back to "hot". */
const BURNING_HOLD_M = 5;
/** Marker positions are sent to one decimal place. */
const STEP = 0.1;

const ZONE_STYLE: Record<HeatZone, Pick<HotColdZone, "color" | "label" | "emoji">> = {
  icy: { color: "#3B82F6", label: "Brrr! Pretty far away.", emoji: "🧊" },
  cold: { color: "#60A5FA", label: "Still a bit chilly...", emoji: "❄️" },
  warm: { color: "#22C55E", label: "Getting warmer!", emoji: "☀️" },
  hot: { color: "#F97316", label: "Very hot! Almost there!", emoji: "🌡️" },
  burning: { color: "#EF4444", label: "You're right here!", emoji: "🔥" },
};

const BURNING_INDEX = HEAT_ZONES.indexOf("burning");

/** A zone name from untrusted input, or null. */
export function parseHeatZone(value: unknown): HeatZone | null {
  return typeof value === "string" && (HEAT_ZONES as readonly string[]).includes(value) ? (value as HeatZone) : null;
}

/** "42m" below a kilometre, "1.5km" from there up. */
export function formatDistanceLabel(distanceMeters: number): string {
  const rounded = Math.round(distanceMeters);
  return rounded >= 1000 ? `${(distanceMeters / 1000).toFixed(1)}km` : `${rounded}m`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The leg length the scale is stretched over. Clamped so a first reading
 * right next to the stop doesn't turn a few metres of GPS noise into a swing
 * across the meter, and one from across town doesn't leave the marker frozen
 * for most of the trip.
 */
function scaleReference(referenceMeters: number, radius: number): number {
  const min = Math.max(MIN_REFERENCE_M, radius * MIN_REFERENCE_RADII);
  return clamp(referenceMeters, min, Math.max(MAX_REFERENCE_M, min));
}

/** Position on the scale for a reading outside the radius: 0 up to (not including) 80. */
function scaledPercent(distance: number, radius: number, reference: number): number {
  if (distance > reference) {
    return Math.max(0, START_PERCENT * (1 - Math.log(distance / reference) / Math.log(AWAY_FACTOR)));
  }
  const progress = Math.log(reference / distance) / Math.log(reference / radius);
  return START_PERCENT + (BURNING_FROM - START_PERCENT) * progress;
}

/** The zone (by index) a position falls in, staying in the previous zone near a boundary. */
function zoneIndexFor(percent: number, previous: number | null): number {
  const raw = clamp(Math.floor(percent / ZONE_WIDTH), 0, BURNING_INDEX - 1);
  if (previous === null || previous >= BURNING_INDEX || raw === previous) return raw;
  const heldBelow = raw > previous && percent < (previous + 1) * ZONE_WIDTH + ZONE_HOLD;
  const heldAbove = raw < previous && percent >= previous * ZONE_WIDTH - ZONE_HOLD;
  return heldBelow || heldAbove ? previous : raw;
}

function reading(zone: HeatZone, markerPercent: number, distanceMeters: number): HotColdZone {
  return { zone, ...ZONE_STYLE[zone], distanceLabel: formatDistanceLabel(distanceMeters), markerPercent };
}

export function getHotColdZone(input: HotColdInput): HotColdZone {
  const { distanceMeters, previousZone = null, atStop = false } = input;
  const radius = stopRadius(input.radiusMeters);
  const distance = Math.max(0, distanceMeters);

  // The top zone belongs to the arrival radius alone, whatever the leg length.
  const heldAtStop = previousZone === "burning" && distance <= radius + BURNING_HOLD_M;
  if (atStop || distance <= radius || heldAtStop) return reading("burning", BURNING_PERCENT, distance);

  const reference = scaleReference(isPositive(input.referenceMeters) ? input.referenceMeters : distance, radius);
  const percent = scaledPercent(distance, radius, reference);
  const index = zoneIndexFor(percent, previousZone ? HEAT_ZONES.indexOf(previousZone) : null);
  // Keep the marker inside the zone it is labelled with (it rests on the
  // boundary while a zone is being held).
  const floor = index * ZONE_WIDTH;
  const marker = clamp(Math.round(percent / STEP) * STEP, floor, floor + ZONE_WIDTH - STEP);
  return reading(HEAT_ZONES[index], Number(marker.toFixed(1)), distance);
}

/**
 * Calculate distance between two GPS points using Haversine formula.
 * Returns distance in meters.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Should the hot/cold meter update?
 * Only update after significant movement (>10m) to avoid jitter.
 */
export function shouldUpdateMeter(
  prevLat: number,
  prevLon: number,
  newLat: number,
  newLon: number,
  minMovementMeters: number = 10
): boolean {
  const moved = haversineDistance(prevLat, prevLon, newLat, newLon);
  return moved >= minMovementMeters;
}
