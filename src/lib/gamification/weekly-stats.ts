/**
 * Builds the WeeklyProgress contract (lib/gamification/weekly.ts) from the
 * completion times of a player's finished hunts.
 *
 * Weeks start Monday 00:00 in America/Denver. A week is identified by the
 * Denver calendar date of its Monday ("2026-10-19"), so daylight-saving
 * changes never shift a completion into the wrong week.
 *
 * Pure: no I/O, unit tested directly.
 */

import { WEEKLY_HUNT_GOAL, type WeeklyProgress } from "@/lib/gamification/weekly";

export const WEEK_TIME_ZONE = "America/Denver";

/** How far back the streak looks. Older completions can't extend it. */
export const STREAK_LOOKBACK_WEEKS = 156;

const DAY_MS = 86_400_000;
const WEEKDAY_INDEX: Readonly<Record<string, number>> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const denverParts = new Intl.DateTimeFormat("en-US", {
  timeZone: WEEK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

function isoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** The Denver-calendar Monday ("YYYY-MM-DD") of the week containing `instant`. */
export function weekKey(instant: Date): string {
  const parts = Object.fromEntries(denverParts.formatToParts(instant).map((p) => [p.type, p.value]));
  const weekday = WEEKDAY_INDEX[parts.weekday] ?? 0;
  const localMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return isoDate(localMidnight - weekday * DAY_MS);
}

/** The week key `weeks` weeks before `key`. */
export function shiftWeek(key: string, weeks: number): string {
  return isoDate(Date.parse(`${key}T00:00:00Z`) + weeks * 7 * DAY_MS);
}

/**
 * Completed-this-week count and the run of consecutive weeks with at least
 * one completion. This week extends the run only once it has a completion;
 * until then the run is counted up to last week, so it isn't broken just
 * because the new week hasn't had a hunt yet.
 */
export function computeWeeklyProgress(completedAt: ReadonlyArray<string | null | undefined>, now: Date = new Date()): WeeklyProgress {
  const thisWeek = weekKey(now);
  const weeks = new Map<string, number>();
  for (const value of completedAt) {
    if (!value) continue;
    const at = new Date(value);
    if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime()) continue;
    const key = weekKey(at);
    weeks.set(key, (weeks.get(key) ?? 0) + 1);
  }

  const completedThisWeek = weeks.get(thisWeek) ?? 0;
  let cursor = completedThisWeek > 0 ? thisWeek : shiftWeek(thisWeek, -1);
  let streakWeeks = 0;
  while (weeks.has(cursor) && streakWeeks < STREAK_LOOKBACK_WEEKS) {
    streakWeeks += 1;
    cursor = shiftWeek(cursor, -1);
  }

  return { completedThisWeek, goal: WEEKLY_HUNT_GOAL, streakWeeks };
}

/** Earliest completion time worth reading for the streak (a safe UTC lower bound). */
export function streakLookbackStart(now: Date = new Date()): string {
  return new Date(now.getTime() - (STREAK_LOOKBACK_WEEKS + 1) * 7 * DAY_MS).toISOString();
}
