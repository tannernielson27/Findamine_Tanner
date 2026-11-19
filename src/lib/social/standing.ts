/**
 * Pure logic for "where do I stand?" leaderboard motivation (B5).
 *
 * Computes the viewer's rank, score, and the gap to the next rank up — from a
 * server-provided summary when available (precise, even outside the visible
 * top-N) or derived from the visible entries as a fallback. Display-only; it
 * reads scores already returned by the privacy-aware leaderboard API and never
 * affects scoring or the A5 name-redaction applied to other players.
 */

export interface StandingEntry {
  user_id: string;
  score: number;
  /**
   * The row's rank as the server worked it out. Present on boards that break
   * ties (see boardRanks); absent ones are ranked here by score alone.
   */
  rank?: number;
}

/** Server-computed standing (snake_case as returned by the API). */
export interface ServerMe {
  rank: number;
  score: number;
  /** 0 when the next player up has the same score and is ahead on the tiebreak. */
  gap_to_next: number | null;
  /** Set on boards that break ties: true only when a tie could not be broken. */
  tied?: boolean;
}

/** What a board is ordered by (issue #11). */
export interface StandingKey {
  score: number;
  /** Total solve time across the hunt's stops, in ms; null when it was not recorded. */
  solveMs: number | null;
  /** When the hunt was finished (ISO time); null when unknown. */
  completedAt: string | null;
}

/** Lower first; an unknown value sorts after every known one. */
function compareKnownFirst(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function timeOf(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Board order: higher score first, then lower total solve time, then the
 * earlier finish. Negative when `a` is ahead of `b`, 0 when nothing separates
 * them.
 */
export function compareStanding(a: StandingKey, b: StandingKey): number {
  if (a.score !== b.score) return b.score - a.score;
  const bySolve = compareKnownFirst(a.solveMs, b.solveMs);
  if (bySolve !== 0) return bySolve;
  return compareKnownFirst(timeOf(a.completedAt), timeOf(b.completedAt));
}

/**
 * Ranks for rows already in board order (compareStanding).
 *
 * splitTies true: the tiebreak decides, so two players share a rank only when
 * score, solve time and finish time are all equal. splitTies false: players on
 * the same score share a rank ("1, 1, 3"), as boards did before tiebreaks.
 */
export function boardRanks(rows: ReadonlyArray<StandingKey>, opts: { splitTies: boolean }): number[] {
  const ranks: number[] = [];
  rows.forEach((row, i) => {
    const previous = i > 0 ? rows[i - 1] : null;
    const level =
      previous !== null &&
      (opts.splitTies ? compareStanding(previous, row) === 0 : previous.score === row.score);
    ranks.push(level ? ranks[i - 1] : i + 1);
  });
  return ranks;
}

export interface ViewerStanding {
  rank: number;
  score: number;
  /** Points needed to reach the next rank up; null when already #1. */
  gapToNext: number | null;
  /** Rank of the next group up, when known (ties make it differ from rank - 1). */
  nextRank?: number;
  /** True when another visible player shares this rank. */
  tied?: boolean;
}

export interface StandingSummary {
  standing: ViewerStanding | null;
  /** True when the viewer appears in the visible entries (highlight in place). */
  inList: boolean;
  /** True when we should pin a separate "your position" row (viewer off-screen). */
  pinned: boolean;
}

/**
 * Competition ranks ("1, 1, 3") for entries sorted by score descending, so
 * tied players share a rank (and a medal) instead of being split by row order.
 */
export function competitionRanks(entries: StandingEntry[]): number[] {
  const ranks: number[] = [];
  entries.forEach((entry, i) => {
    ranks.push(i > 0 && entries[i - 1].score === entry.score ? ranks[i - 1] : i + 1);
  });
  return ranks;
}

/** The ranks to draw: the server's when every row carries one, else by score. */
export function displayRanks(entries: StandingEntry[]): number[] {
  const given = entries.map((e) => e.rank);
  if (entries.length > 0 && given.every((r): r is number => typeof r === "number")) return given;
  return competitionRanks(entries);
}

/**
 * A player's standing among a full ranked list (same tie rule as
 * competitionRanks). Used server-side for the overall board, where the caller
 * may sit outside the visible top-N. Returns null when the player isn't ranked.
 */
export function standingAmong(rows: StandingEntry[], userId: string): ServerMe | null {
  const mine = rows.find((r) => r.user_id === userId);
  if (!mine) return null;
  let higher = 0;
  let nextScore: number | null = null;
  for (const r of rows) {
    if (r.score > mine.score) {
      higher += 1;
      if (nextScore === null || r.score < nextScore) nextScore = r.score;
    }
  }
  return {
    rank: higher + 1,
    score: mine.score,
    gap_to_next: nextScore === null ? null : nextScore - mine.score,
  };
}

export function summarizeViewerStanding(
  entries: StandingEntry[],
  viewerId: string | null | undefined,
  serverMe?: ServerMe | null
): StandingSummary {
  const idx = viewerId ? entries.findIndex((e) => e.user_id === viewerId) : -1;
  const inList = idx >= 0;

  let standing: ViewerStanding | null = null;
  if (inList) {
    // On the board: describe the row as it is drawn, so the caption can never
    // disagree with the rank shown beside it.
    const ranks = displayRanks(entries);
    const rank = ranks[idx];
    const score = entries[idx].score;
    // The nearest row above with a better rank is the next group up. On a
    // board that breaks ties it can have the same score (gap 0).
    let above = idx - 1;
    while (above >= 0 && ranks[above] >= rank) above -= 1;
    standing = {
      rank,
      score,
      gapToNext: above >= 0 ? entries[above].score - score : null,
      ...(above >= 0 ? { nextRank: ranks[above] } : {}),
      tied: ranks.some((r, i) => i !== idx && r === rank),
    };
  } else if (serverMe) {
    standing = {
      rank: serverMe.rank,
      score: serverMe.score,
      gapToNext: serverMe.gap_to_next,
      ...(serverMe.tied !== undefined ? { tied: serverMe.tied } : {}),
    };
  }

  return { standing, inList, pinned: Boolean(standing) && !inList };
}

/** Short, encouraging caption for a viewer's standing. */
export function standingCaption(standing: ViewerStanding | null): string {
  if (!standing) return "";
  if (standing.rank === 1) return standing.tied ? "You're tied for the lead!" : "You're in the lead! 🏆";
  if (standing.gapToNext == null) return `You're #${standing.rank}.`;
  if (standing.gapToNext <= 0) {
    // Same score as the player above. On a board that breaks ties (tied is
    // false) that player is ahead on solve time; otherwise the rank is shared.
    return standing.tied === false
      ? `Same score as #${standing.nextRank ?? standing.rank - 1}. Their solve time was faster.`
      : `You're tied for #${standing.rank}!`;
  }
  const pts = standing.gapToNext === 1 ? "1 point" : `${standing.gapToNext} points`;
  return `${pts} to reach #${standing.nextRank ?? standing.rank - 1}`;
}