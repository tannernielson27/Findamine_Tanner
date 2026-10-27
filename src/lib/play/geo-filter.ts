/**
 * Pure helpers that keep GPS jitter from churning the play screen: a phone
 * standing still still reports a new fix every second or so.
 */

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
}

/** Fixes that moved less than this (and didn't get meaningfully more accurate) are noise. */
export const MIN_MOVE_METERS = 3;
/** Min gap between arrive pings while the player is still far away. */
export const ARRIVE_MIN_INTERVAL_MS = 3000;
/** Min gap once the last reading said the player is close (heat level 4+). */
export const ARRIVE_NEAR_INTERVAL_MS = 1000;

const EARTH_RADIUS_M = 6371000;

/** Haversine distance in metres. */
export function distanceMeters(a: Pick<Fix, "lat" | "lng">, b: Pick<Fix, "lat" | "lng">): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `next` is worth reacting to given the last fix we accepted. */
export function isMeaningfulFix(prev: Fix | null, next: Fix): boolean {
  if (!prev) return true;
  if (distanceMeters(prev, next) >= MIN_MOVE_METERS) return true;
  // Same spot, but a much tighter accuracy circle is new information.
  return prev.accuracy != null && next.accuracy != null && next.accuracy <= prev.accuracy * 0.6 && prev.accuracy - next.accuracy >= 5;
}

/** Milliseconds to wait before the next arrive ping is allowed. */
export function arriveDelayMs(lastSentAt: number | null, now: number, near: boolean): number {
  if (lastSentAt == null) return 0;
  const interval = near ? ARRIVE_NEAR_INTERVAL_MS : ARRIVE_MIN_INTERVAL_MS;
  return Math.max(0, lastSentAt + interval - now);
}
