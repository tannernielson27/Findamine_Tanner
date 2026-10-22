/**
 * Contract for the Home weekly ring ("2 of 3 hunts this week").
 *
 * Served by GET /api/v1/gamification/weekly (response: { data: WeeklyProgress }).
 * The week starts Monday 00:00 in America/Denver (BYU's time zone).
 */

export const WEEKLY_HUNT_GOAL = 3;

export interface WeeklyProgress {
  /** Hunts the player completed since the week started. */
  completedThisWeek: number;
  goal: number;
  /** Consecutive weeks (including this one if met) with at least one completed hunt. */
  streakWeeks: number;
}

/** Narrows an unknown JSON payload; falls back to an empty week. Pure. */
export function parseWeeklyProgress(payload: unknown): WeeklyProgress {
  const empty: WeeklyProgress = { completedThisWeek: 0, goal: WEEKLY_HUNT_GOAL, streakWeeks: 0 };
  if (!payload || typeof payload !== "object") return empty;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return empty;
  const d = data as Record<string, unknown>;
  const count = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  return {
    completedThisWeek: count(d.completedThisWeek, 0),
    goal: Math.max(1, count(d.goal, WEEKLY_HUNT_GOAL)),
    streakWeeks: count(d.streakWeeks, 0),
  };
}
