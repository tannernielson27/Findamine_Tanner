/**
 * Plain-language rows for the score breakdown shown after an answer on a
 * scoring version 2 hunt (issue #11). Display only: the numbers are the
 * server's (lib/services/scoring-v2.ts) and add up to the stop's score.
 */

export interface BreakdownRow {
  label: string;
  /** Signed points: negative for hints. */
  points: number;
}

/** True when the breakdown came from scoring version 2. */
export function isV2Breakdown(breakdown: Readonly<Record<string, number>> | null | undefined): boolean {
  return !!breakdown && typeof breakdown.solveTime === "number";
}

/**
 * The rows to show, in the order the score is built up. Parts that did not
 * apply (no bonus, no hints, release layer off) are left out; the answer and
 * speed rows always show, so a slow or wrong answer reads as 0 rather than
 * as missing.
 */
export function v2BreakdownRows(breakdown: Readonly<Record<string, number>>): BreakdownRow[] {
  const part = (key: string) => (Number.isFinite(breakdown[key]) ? breakdown[key] : 0);
  const rows: BreakdownRow[] = [{ label: "Your answer", points: part("correctness") }];
  if (part("firstAttemptBonus") > 0) rows.push({ label: "Right on the first try", points: part("firstAttemptBonus") });
  if (part("completion") > 0) rows.push({ label: "Stop completed", points: part("completion") });
  rows.push({ label: "Speed on this stop", points: part("solveTime") });
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
