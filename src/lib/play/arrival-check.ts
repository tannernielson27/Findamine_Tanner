/**
 * Decides whether a GPS fix counts as arriving at a stop. Shared by the
 * automatic GPS pings and the "I'm here" button, so both follow one rule.
 *
 * Phone GPS is only good to roughly 5–15 m outdoors, so the reported accuracy
 * is subtracted from the distance (capped, so a vague fix can't stretch the
 * radius far). A fix vaguer than MAX_USABLE_ACCURACY_M is not trusted at all.
 */

/** Radius for new stops, and for any stop that has none stored. */
export const DEFAULT_STOP_RADIUS_M = 25;
/** Smallest radius a creator can set: tighter than GPS can reliably confirm. */
export const MIN_STOP_RADIUS_M = 15;
export const MAX_STOP_RADIUS_M = 1000;
/** Most GPS error we give the player the benefit of. */
export const ACCURACY_ALLOWANCE_CAP_M = 20;
/** Fixes vaguer than this can't confirm an arrival. */
export const MAX_USABLE_ACCURACY_M = 50;

export interface ArrivalInput {
  /** Metres from the fix to the stop. */
  distance: number;
  /** Reported GPS accuracy in metres, when the device gave one. */
  accuracy: number | null;
  /** The stop's radius in metres (null/0 → default). */
  radius: number | null;
}

export type ArrivalVerdict =
  | { kind: "inside" }
  | { kind: "too_far"; distance: number; radius: number }
  | { kind: "weak_gps"; accuracy: number };

export function stopRadius(radius: number | null | undefined): number {
  return typeof radius === "number" && radius > 0 ? radius : DEFAULT_STOP_RADIUS_M;
}

export function checkArrival({ distance, accuracy, radius }: ArrivalInput): ArrivalVerdict {
  const r = stopRadius(radius);
  const acc = typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
  if (acc !== null && acc > MAX_USABLE_ACCURACY_M) return { kind: "weak_gps", accuracy: acc };
  const allowance = Math.min(acc ?? 0, ACCURACY_ALLOWANCE_CAP_M);
  if (distance - allowance <= r) return { kind: "inside" };
  return { kind: "too_far", distance, radius: r };
}

/** "about 140 m" / "about 1.2 km", for the too-far message. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `about ${Math.max(5, Math.round(meters / 5) * 5)} m`;
  return `about ${(meters / 1000).toFixed(1)} km`;
}
