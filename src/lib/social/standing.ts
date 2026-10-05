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
}

/** Server-computed standing (snake_case as returned by the API). */
export interface ServerMe {
  rank: number;
  score: number;
  gap_to_next: number | null;
}

export interface ViewerStanding {
  rank: number;
  score: number;
  /** Points needed to reach the next rank up; null when already #1. */
  gapToNext: number | null;
  /** Rank of the next group up, when known (ties make it differ from rank - 1). */
  nextRank?: number;
  /** True when another visible player has the same score. */
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
    const ranks = competitionRanks(entries);
    const rank = ranks[idx];
    const score = entries[idx].score;
    // rank - 1 entries score strictly higher; the last of them is the next group up.
    const above = rank > 1 ? rank - 2 : -1;
    standing = {
      rank,
      score,
      gapToNext: above >= 0 ? entries[above].score - score : null,
      ...(above >= 0 ? { nextRank: ranks[above] } : {}),
      tied: entries.some((e, i) => i !== idx && e.score === score),
    };
  } else if (serverMe) {
    standing = { rank: serverMe.rank, score: serverMe.score, gapToNext: serverMe.gap_to_next };
  }

  return { standing, inList, pinned: Boolean(standing) && !inList };
}

/** Short, encouraging caption for a viewer's standing. */
export function standingCaption(standing: ViewerStanding | null): string {
  if (!standing) return "";
  if (standing.rank === 1) return standing.tied ? "You're tied for the lead!" : "You're in the lead! 🏆";
  if (standing.gapToNext == null) return `You're #${standing.rank}.`;
  if (standing.gapToNext <= 0) return `You're tied for #${standing.rank}!`;
  const pts = standing.gapToNext === 1 ? "1 point" : `${standing.gapToNext} points`;
  return `${pts} to reach #${standing.nextRank ?? standing.rank - 1}`;
}