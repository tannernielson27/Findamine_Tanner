/**
 * Pure display logic for the play HUD: the 5-step heat scale, the distance
 * readout, the direction arrow and GPS accuracy. Kept free of React so it is
 * unit-testable in the node test environment.
 */

import { heatLevel } from "@/lib/native/haptics";

export interface HeatDisplay {
  /** 1 (icy) … 5 (burning). */
  level: number;
  /** Plain-language label. Distance-based only: the server knows no direction of travel. */
  label: string;
  /** Text colour on white, ≥7:1 for outdoor legibility. */
  textColor: string;
  /** Background behind the direction arrow. */
  tint: string;
  /** Marker position on the scale, % from the cold end (centre of the step). */
  markerPercent: number;
}

const COLD_TEXT = "#145782"; // 7.7:1 on white
const HOT_TEXT = "#9A3412"; // 7.3:1 on white
const BURNING_TEXT = "#7C2D12"; // 9.4:1 on white
const COLD_TINT = "#DCE9F3";
const HOT_TINT = "#FDE7DA";

const BY_LEVEL: Record<number, Omit<HeatDisplay, "level" | "markerPercent">> = {
  1: { label: "Far away", textColor: COLD_TEXT, tint: COLD_TINT },
  2: { label: "Cold", textColor: COLD_TEXT, tint: COLD_TINT },
  3: { label: "Getting warmer", textColor: HOT_TEXT, tint: HOT_TINT },
  4: { label: "Hot! You're close", textColor: HOT_TEXT, tint: HOT_TINT },
  5: { label: "You're right here", textColor: BURNING_TEXT, tint: HOT_TINT },
};

/** Display values for a hot/cold zone, or null for an unknown zone. */
export function heatDisplay(zone: string | null | undefined): HeatDisplay | null {
  const level = heatLevel(zone);
  if (level == null) return null;
  return { level, markerPercent: (level - 1) * 20 + 10, ...BY_LEVEL[level] };
}

export interface DistanceParts {
  value: string;
  unit: string;
}

/** Splits the server's distance label ("120m", "1.2km") into number and unit. */
export function splitDistanceLabel(label: string): DistanceParts {
  const match = /^\s*([\d.,]+)\s*([a-z]+)?\s*$/i.exec(label);
  if (!match) return { value: label, unit: "" };
  return { value: match[1], unit: match[2] ?? "" };
}

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Initial great-circle bearing from `from` to `to`, degrees clockwise from north (0–360). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

/** "northeast" etc. for a bearing in degrees. */
export function compassWord(bearing: number): string {
  const idx = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS[idx];
}

/** Accuracy (metres) beyond which the HUD warns that the GPS fix is rough. */
export const WEAK_ACCURACY_METERS = 30;

/** True when the fix is too rough to trust for arrival. */
export function isWeakAccuracy(accuracy: number | null | undefined): boolean {
  return typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > WEAK_ACCURACY_METERS;
}

/**
 * How long to wait before announcing a new status, given when the last one
 * was announced. 0 means announce now. Keeps screen readers from being
 * flooded while the heat level flickers between two zones.
 */
export function announcementDelay(lastAnnouncedAt: number | null, now: number, minGapMs: number): number {
  if (lastAnnouncedAt == null) return 0;
  return Math.max(0, lastAnnouncedAt + minGapMs - now);
}
