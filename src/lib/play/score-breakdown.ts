/**
 * Plain-language rows for the score breakdown shown after an answer on a
 * scoring version 2 hunt (issue #11). Display only: the numbers are the
 * server's (lib/services/scoring-v2.ts) and add up to the stop's score.
 */

export interface BreakdownRow {
  label: string;
  /** Signed points: negative for hints. */
  points: number;
  /** A short note under the label, e.g. how long the stop took. */
  detail?: string;
}

/** True when the breakdown came from scoring version 2. */
export function isV2Breakdown(breakdown: Readonly<Record<string, number>> | null | undefined): boolean {
  return !!breakdown && typeof breakdown.solveTime === "number";
}

/**
 * The rows to show, in the order the score is built up. Parts that did not
 * apply (no bonus, no hints, release layer off) are left out; the answer and
 * speed rows always show, so a slow or wrong answer reads as 0 rather than
 * as missing. Given the stop's solve time, the speed row says how long it took.
 */
export function v2BreakdownRows(
  breakdown: Readonly<Record<string, number>>,
  solveMs?: number | null
): BreakdownRow[] {
  const part = (key: string) => (Number.isFinite(breakdown[key]) ? breakdown[key] : 0);
  const rows: BreakdownRow[] = [{ label: "Your answer", points: part("correctness") }];
  if (part("firstAttemptBonus") > 0) rows.push({ label: "Right on the first try", points: part("firstAttemptBonus") });
  if (part("completion") > 0) rows.push({ label: "Stop completed", points: part("completion") });
  const took = formatSolveDuration(solveMs);
  rows.push({ label: "Speed on this stop", points: part("solveTime"), ...(took ? { detail: `Solved in ${took}` } : {}) });
  if (part("releaseTime") > 0) rows.push({ label: "Solved soon after release", points: part("releaseTime") });
  if (part("hintPenalty") > 0) rows.push({ label: "Hints used", points: -part("hintPenalty") });
  if (part("effortCredit") > 0) rows.push({ label: "Credit for trying", points: part("effortCredit") });
  return rows;
}

/** "+191", "-40", "0". */
export function signedPoints(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${Math.abs(points)}`;
  return "0";
}

/**
 * A solve time for players: "45 s", "3 min 12 s", "1 h 5 min". Seconds are
 * dropped from an hour up. Null when the time is unknown or not a real
 * duration, so the caller shows nothing rather than "0 s".
 */
export function formatSolveDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  return `${seconds} s`;
}
