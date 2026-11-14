/**
 * Balanced survey subsets (pilot 2026-11): the Qualtrics week-2 check-in (MID)
 * and the T2 PEOU block each go to half of the participants, balanced within
 * every condition cell.
 *
 * Rule: enrollees in a cell are taken in pairs, in enrollment order. The first
 * of each pair gets a fair coin; the second gets the opposite. So every cell is
 * within one participant of a 50/50 split at all times, and nobody can predict
 * their own flag from their position. MID and PEOU use independent coins.
 *
 * Pure: the caller loads the prior flags for the cell and passes the rng.
 */

export interface NamedLevel {
  dimensionName: string;
  level: string;
}

/**
 * Stable key for a participant's condition cell: `dim=level` pairs sorted by
 * dimension name and joined with `|`. Empty names are ignored.
 */
export function cellKeyFor(assignments: readonly NamedLevel[]): string {
  return assignments
    .filter((a) => a.dimensionName)
    .map((a) => `${a.dimensionName}=${a.level}`)
    .sort()
    .join("|");
}

/**
 * The flag for the next enrollee in a cell, given the flags already assigned
 * in that cell in enrollment order. Null flags (rows from before this column
 * existed) are skipped, so they don't break the pairing.
 */
export function nextBalancedFlag(
  priorFlags: readonly (boolean | null | undefined)[],
  rng: () => number = Math.random
): boolean {
  const known = priorFlags.filter((f): f is boolean => typeof f === "boolean");
  if (known.length % 2 === 1) return !known[known.length - 1];
  return rng() < 0.5;
}
