/**
 * The thesis "final" privacy index: the last snapshot taken before the T3
 * check-in opened. T3 gates the privacy page, so any change made while it is
 * pending comes after the participant has just answered privacy questions;
 * cutting the outcome off before T3 keeps that priming out of it.
 */

export const T3_TIMEPOINT = "T3";
export const T3_OFFSET_DAYS = 42;

const DAY_MS = 86_400_000;

export interface IndexPoint {
  created_at: string;
  index: number;
}

/**
 * Index in force at the earlier of (first T3 delivery, enrollment + 42 days).
 * `series` must be ascending by created_at. Null when there is no cutoff or no
 * snapshot at or before it. Pure.
 */
export function preT3Index(
  series: readonly IndexPoint[],
  t3DeliveredAt: string | undefined,
  enrolledAt: string | undefined,
  offsetDays: number = T3_OFFSET_DAYS
): number | null {
  const cutoffs = [
    t3DeliveredAt ? Date.parse(t3DeliveredAt) : NaN,
    enrolledAt ? Date.parse(enrolledAt) + offsetDays * DAY_MS : NaN,
  ].filter(Number.isFinite);
  if (cutoffs.length === 0) return null;
  const cutoff = Math.min(...cutoffs);

  let value: number | null = null;
  for (const point of series) {
    if (Date.parse(point.created_at) > cutoff) break;
    value = point.index;
  }
  return value;
}
