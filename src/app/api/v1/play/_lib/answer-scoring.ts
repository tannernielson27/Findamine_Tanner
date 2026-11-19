import { calculateScore } from "@/lib/services/scoring";
import { calculateScoreV2, type TimeInput } from "@/lib/services/scoring-v2";
import {
  STOP_MAX_SCORE,
  readScoringVersion,
  readSolveWindowMs,
  toComparablePoints,
  type ScoringVersion,
} from "@/lib/hunts/scoring-version";
import { stopStartedAt } from "./stop-start";
import type { CompletionRow } from "./completions";

/**
 * Scores one answer under the hunt's scoring version (issue #11).
 *
 * Every time comes from the server: the stop's start from
 * find_completions.started_at and the answer time from the server clock.
 * Nothing the player's device sends is used.
 *
 * Version 1 is called exactly as before, including its time measured from the
 * start of the whole play session, so a version 1 hunt scores what it always
 * has. Version 2 measures each stop from its own start.
 */

export interface AnswerToScore {
  huntMetadata: Record<string, unknown> | null;
  isCorrect: boolean;
  partialCredit?: number;
  attemptNumber: number;
  completion: Pick<CompletionRow, "started_at" | "arrived_at" | "created_at" | "hints_used" | "clue_hints_used">;
  /** play_sessions.started_at: what version 1 measures time from. */
  sessionStartedAt: string;
  /** Server clock when the answer arrived, in ms since the epoch. */
  answeredAt: number;
  expectedTimeSeconds?: number;
  challengeType: string;
  /**
   * When this stop's clue was released (scheduled hunts, issue #14). Nothing
   * supplies it yet: left out, version 2 scores on solve time alone.
   */
  releasedAt?: TimeInput | null;
}

export interface ScoredAnswer {
  version: ScoringVersion;
  totalScore: number;
  /** The most this stop could have scored on this version. */
  maxScore: number;
  /** The score on the common 0-100 scale: what the points ledger and referral share use. */
  comparablePoints: number;
  breakdown: Record<string, number>;
  feedbackType: "correct" | "incorrect" | "partial";
  canRetry: boolean;
  /** Stop start to this answer in ms; null on version 1, which does not use it. */
  solveMs: number | null;
  /** Saved in find_completions.metadata beside the answer, for research exports. */
  record: Record<string, unknown>;
}

/** A moment as an ISO string; null when it is missing or unreadable. */
function iso(value: TimeInput | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function scoreV1(input: AnswerToScore): ScoredAnswer {
  const timeSpent = Math.round((input.answeredAt - new Date(input.sessionStartedAt).getTime()) / 1000);
  const result = calculateScore({
    isCorrect: input.isCorrect,
    partialCredit: input.partialCredit,
    attemptNumber: input.attemptNumber,
    hintsUsed: input.completion.hints_used || 0,
    clueHintsUsed: input.completion.clue_hints_used || 0,
    challengeHintsUsed: input.completion.hints_used || 0,
    timeSpentSeconds: timeSpent,
    expectedTimeSeconds: input.expectedTimeSeconds,
    isFirstAttempt: input.attemptNumber === 1,
    challengeType: input.challengeType,
  });
  return {
    version: 1,
    totalScore: result.totalScore,
    maxScore: STOP_MAX_SCORE[1],
    comparablePoints: toComparablePoints(result.totalScore, 1),
    breakdown: result.breakdown,
    feedbackType: result.feedback.type,
    canRetry: result.feedback.canRetry,
    solveMs: null,
    record: { scoring_version: 1, scoring_breakdown: result.breakdown },
  };
}

function scoreV2(input: AnswerToScore): ScoredAnswer {
  const startedAt = stopStartedAt(input.completion);
  const result = calculateScoreV2({
    isCorrect: input.isCorrect,
    partialCredit: input.partialCredit,
    attemptNumber: input.attemptNumber,
    clueHintsUsed: input.completion.clue_hints_used || 0,
    challengeHintsUsed: input.completion.hints_used || 0,
    startedAt,
    answeredAt: input.answeredAt,
    releasedAt: input.releasedAt ?? null,
    solveWindowMs: readSolveWindowMs(input.huntMetadata),
  });
  const { timing } = result;
  return {
    version: 2,
    totalScore: result.totalScore,
    maxScore: STOP_MAX_SCORE[2],
    comparablePoints: toComparablePoints(result.totalScore, 2),
    breakdown: { ...result.breakdown },
    feedbackType: result.feedback.type,
    canRetry: result.feedback.canRetry,
    solveMs: timing.solveMs,
    record: {
      scoring_version: 2,
      scoring_breakdown: { ...result.breakdown },
      // What each time layer was computed from.
      scoring_timing: {
        started_at: startedAt,
        answered_at: iso(input.answeredAt),
        solve_ms: timing.solveMs,
        solve_tau_ms: timing.solveTauMs,
        solve_window_ms: timing.solveWindowMs,
        solve_weight: timing.solveWeight,
        release_active: timing.releaseActive,
        released_at: timing.releaseActive ? iso(input.releasedAt) : null,
        release_ms: timing.releaseMs,
        release_tau_ms: timing.releaseTauMs,
        release_window_ms: timing.releaseWindowMs,
        release_weight: timing.releaseWeight,
      },
    },
  };
}

export function scoreAnswer(input: AnswerToScore): ScoredAnswer {
  return readScoringVersion(input.huntMetadata) === 2 ? scoreV2(input) : scoreV1(input);
}

export type TimedCompletion = Pick<CompletionRow, "started_at" | "arrived_at" | "created_at" | "completed_at">;

/**
 * Total solve time across a session's finished stops, in ms: each stop from
 * its start to its completion. The leaderboard tiebreak (lower is better).
 * Null when no stop is finished.
 */
export function totalSolveMs(completions: ReadonlyArray<TimedCompletion>): number | null {
  let total = 0;
  let finished = 0;
  for (const c of completions) {
    const start = stopStartedAt(c);
    if (!c.completed_at || !start) continue;
    const elapsed = Date.parse(c.completed_at) - Date.parse(start);
    if (!Number.isFinite(elapsed)) continue;
    total += Math.max(0, elapsed);
    finished += 1;
  }
  return finished > 0 ? total : null;
}
