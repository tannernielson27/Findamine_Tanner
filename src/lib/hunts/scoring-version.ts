/**
 * Which scoring version a hunt uses, and how scores from different versions
 * are put on one footing (issue #11).
 *
 * Version 1 scores a stop out of 100 (lib/services/scoring.ts); version 2 out
 * of 1000 with real time layers (lib/services/scoring-v2.ts). The version is
 * kept in hunt metadata:
 *
 *   hunts.metadata.scoring_version            1 | 2
 *   hunts.metadata.scoring_solve_window_min   version 2 only, optional: minutes
 *                                             until solve-time points reach zero
 *
 * - A hunt with no `scoring_version` is on version 1. That is every hunt made
 *   before this shipped, so their boards and stored scores stay as they are.
 * - Hunts created from now on get version 2 (withNewHuntScoring).
 * - Both settings can change only while the hunt has no play sessions, so one
 *   leaderboard never mixes two scales. The API enforces it here; migration
 *   085 has the database trigger for writes that skip the API. To score a
 *   played hunt differently, clone it.
 *
 * Where hunts on different versions are added together (the overall
 * leaderboard, the points ledger behind tiers and profile totals, referral
 * shares, cross-hunt analytics), every stop counts out of 100:
 * toComparablePoints divides a version 2 score by 10. The SQL side does the
 * same (migration 085).
 *
 * Pure: no I/O, unit tested directly.
 */

import { DEFAULT_SCORING } from "@/lib/services/scoring";
import { SCORING_V2 } from "@/lib/services/scoring-v2";

type Meta = Readonly<Record<string, unknown>> | null | undefined;

export type ScoringVersion = 1 | 2;

/** Hunt metadata key holding the scoring version. */
export const SCORING_VERSION_KEY = "scoring_version";

/** Hunt metadata key holding the hunt's own solve window, in minutes (version 2). */
export const SOLVE_WINDOW_KEY = "scoring_solve_window_min";

/** A hunt whose metadata names no version. */
export const LEGACY_SCORING_VERSION: ScoringVersion = 1;

/** The version given to hunts created from now on. */
export const NEW_HUNT_SCORING_VERSION: ScoringVersion = 2;

/** The most one stop can score, per version. */
export const STOP_MAX_SCORE: Readonly<Record<ScoringVersion, number>> = {
  1: DEFAULT_SCORING.maxScore,
  2: SCORING_V2.maxScore,
};

/** The scale every stop is put on where versions are combined. */
export const COMPARABLE_STOP_MAX = 100;

/** Allowed range for a hunt's own solve window, in minutes. */
export const SOLVE_WINDOW_MINUTES = { min: 5, max: 24 * 60 } as const;

export const SCORING_LOCKED_MESSAGE =
  "Scoring is locked because this hunt has been played. Clone the hunt to use different scoring.";

export const SCORING_VERSION_INVALID_MESSAGE = "Scoring version must be 1 or 2.";

export const SOLVE_WINDOW_INVALID_MESSAGE =
  `The solve-time window must be a whole number of minutes from ${SOLVE_WINDOW_MINUTES.min} to ${SOLVE_WINDOW_MINUTES.max}.`;

function isScoringVersion(value: unknown): value is ScoringVersion {
  return value === 1 || value === 2;
}

function isSolveWindow(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SOLVE_WINDOW_MINUTES.min &&
    value <= SOLVE_WINDOW_MINUTES.max
  );
}

/** The hunt's scoring version; version 1 when none (or an unknown one) is stored. */
export function readScoringVersion(metadata: Meta): ScoringVersion {
  const value = metadata?.[SCORING_VERSION_KEY];
  return isScoringVersion(value) ? value : LEGACY_SCORING_VERSION;
}

/** The hunt's own solve window in minutes, or null to use the default. */
export function readSolveWindowMinutes(metadata: Meta): number | null {
  const value = metadata?.[SOLVE_WINDOW_KEY];
  return isSolveWindow(value) ? value : null;
}

/** The hunt's own solve window in milliseconds, or null to use the default. */
export function readSolveWindowMs(metadata: Meta): number | null {
  const minutes = readSolveWindowMinutes(metadata);
  return minutes === null ? null : minutes * 60_000;
}

/**
 * Metadata for a hunt being created: version 2 unless it already names a
 * valid version. Never mutates.
 */
export function withNewHuntScoring<T extends Readonly<Record<string, unknown>> | null>(
  metadata: T
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(metadata ?? {}) };
  if (isScoringVersion(base[SCORING_VERSION_KEY])) return base;
  return { ...base, [SCORING_VERSION_KEY]: NEW_HUNT_SCORING_VERSION };
}

/**
 * A stop score on the common 0-100 scale, as a whole number. Use it wherever
 * scores from hunts on different versions are added or compared.
 */
export function toComparablePoints(score: number | null | undefined, version: ScoringVersion): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0;
  return Math.round((score * COMPARABLE_STOP_MAX) / STOP_MAX_SCORE[version]);
}

/** What one clue hint and one challenge hint cost, for the labels players see. */
export const HINT_COSTS: Readonly<Record<ScoringVersion, { clue: number; challenge: number }>> = {
  1: { clue: DEFAULT_SCORING.clueHintPenalty, challenge: DEFAULT_SCORING.challengeHintPenalty },
  2: { clue: SCORING_V2.clueHintPenalty, challenge: SCORING_V2.challengeHintPenalty },
};

function settingsKey(metadata: Meta): string {
  return JSON.stringify([readScoringVersion(metadata), readSolveWindowMinutes(metadata)]);
}

/** Did the effective scoring (version or solve window) change? */
export function scoringSettingsChanged(before: Meta, after: Meta): boolean {
  return settingsKey(before) !== settingsKey(after);
}

/**
 * An update that leaves a scoring key out keeps the stored value: clients
 * that never saw the setting must not reset a hunt to version 1. A solve
 * window of null clears it. Never mutates.
 */
export function inheritScoringSettings(
  before: Meta,
  after: Readonly<Record<string, unknown>> | null
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(after ?? {}) };
  for (const key of [SCORING_VERSION_KEY, SOLVE_WINDOW_KEY]) {
    if (!(key in next) && before && key in before) next[key] = before[key];
  }
  if (next[SOLVE_WINDOW_KEY] === null) delete next[SOLVE_WINDOW_KEY];
  if (after === null && Object.keys(next).length === 0) return null;
  return next;
}

export type ScoringEditCheck = { ok: true } | { ok: false; status: 400 | 409; error: string };

/**
 * May this metadata update go through? Stored values are left alone when the
 * update does not touch them; a changed value must be valid (400) and the hunt
 * must have no play sessions (409).
 */
export function checkScoringEdit(input: { before: Meta; after: Meta; hasPlaySessions: boolean }): ScoringEditCheck {
  const { before, after, hasPlaySessions } = input;
  const version = after?.[SCORING_VERSION_KEY];
  const solveWindow = after?.[SOLVE_WINDOW_KEY];
  if (version !== undefined && version !== before?.[SCORING_VERSION_KEY] && !isScoringVersion(version)) {
    return { ok: false, status: 400, error: SCORING_VERSION_INVALID_MESSAGE };
  }
  if (solveWindow !== undefined && solveWindow !== before?.[SOLVE_WINDOW_KEY] && !isSolveWindow(solveWindow)) {
    return { ok: false, status: 400, error: SOLVE_WINDOW_INVALID_MESSAGE };
  }
  if (hasPlaySessions && scoringSettingsChanged(before, after)) {
    return { ok: false, status: 409, error: SCORING_LOCKED_MESSAGE };
  }
  return { ok: true };
}
