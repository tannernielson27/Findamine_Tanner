/**
 * Findamine scoring, version 2 (issue #11).
 *
 * A stop is scored out of 1000, as a whole number:
 *
 *   score = correctness + first-attempt bonus + completion + time - hints
 *
 *   correctness   500 x credit x attempt multiplier
 *                 credit is 1 for a correct answer, the partial-credit share
 *                 (0..1) for a partly right one, 0 otherwise. The multiplier
 *                 drops 15% per retry and never goes below 40%.
 *   first attempt 100, correct on the first attempt only
 *   completion    100, correct answers only
 *   time          up to 300, correct answers only (see below)
 *   hints         20 per clue hint, 50 per challenge hint
 *   floor         50 for any attempt, so a wrong answer scores 50
 *
 * Time is one or two layers, each on a log curve that falls fast at first and
 * then flattens:
 *
 *   layer = weight x (1 - ln(1 + t/tau) / ln(1 + T/tau)),  clamped to 0..weight
 *
 *   solve time    t = the stop's start ("I'm ready") to the correct answer.
 *                 tau 2 min, T 60 min (T can be set per hunt).
 *   release time  t = the clue's release to the correct answer.
 *                 tau 10 min, T 24 h. Only when the caller gives a release
 *                 time (scheduled multi-day hunts, issue #14).
 *
 * With no release time the solve layer carries all 300 time points. With one,
 * they split 150 solve / 150 release.
 *
 * Every time is measured on the server, in milliseconds. Nothing here reads a
 * clock, the database, or anything sent by the player's device.
 *
 * Version 1 (lib/services/scoring.ts) is unchanged and still scores hunts that
 * are on version 1. Which version a hunt uses: lib/hunts/scoring-version.ts.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type ScoringMode = "standard" | "binary" | "lenient" | "mastery";

/** Every tunable number of version 2. Change them here and nowhere else. */
export const SCORING_V2 = {
  /** A stop is scored out of this. The components below add up to it. */
  maxScore: 1000,
  /** The least any attempt scores. */
  minScore: 50,
  /** The floor in lenient mode (version 1 doubles its floor there too). */
  lenientMinScore: 100,

  /** A fully correct first attempt. Scaled by partial credit and the attempt multiplier. */
  correctnessPoints: 500,
  /** Correct on the first attempt. */
  firstAttemptBonus: 100,
  /** Any correct answer. */
  completionPoints: 100,
  /** The most the time layers can add together. */
  timePoints: 300,
  /** Share of timePoints given to the release layer when a release time is supplied. */
  releaseShare: 0.5,

  /** Each retry takes this share off the correctness points... */
  attemptDecayPerRetry: 0.15,
  /** ...down to this share at the least. */
  attemptMultiplierFloor: 0.4,

  /** Points off per clue (navigation) hint. */
  clueHintPenalty: 20,
  /** Points off per challenge (learning) hint. */
  challengeHintPenalty: 50,

  /** Solve time: the stop's start to the correct answer. */
  solve: {
    /** Sets how fast the layer drops early on: smaller is steeper. */
    tauMs: 2 * MINUTE_MS,
    /** Where the layer reaches zero. A hunt can set its own (solveWindowMs). */
    windowMs: 60 * MINUTE_MS,
  },
  /** Release time: the clue's release to the correct answer. */
  release: {
    tauMs: 10 * MINUTE_MS,
    windowMs: 24 * HOUR_MS,
  },

  /** Attempts allowed per scoring mode (same as version 1). */
  maxAttempts: { standard: 5, binary: 1, lenient: 10, mastery: 99 },
} as const;

/** A moment in time: a Date, an ISO string, or milliseconds since the epoch. */
export type TimeInput = Date | string | number;

export interface ScoringV2Input {
  isCorrect: boolean;
  /** 0..1 share of credit for an answer that is not fully correct. */
  partialCredit?: number;
  /** 1 for the first attempt. */
  attemptNumber: number;
  /** Clue (navigation) hints used on this stop. */
  clueHintsUsed?: number;
  /** Challenge (learning) hints used on this stop. */
  challengeHintsUsed?: number;
  scoringMode?: ScoringMode;
  /** When the player started the stop (find_completions.started_at). */
  startedAt: TimeInput | null | undefined;
  /** When the server received this answer. */
  answeredAt: TimeInput;
  /**
   * When the clue was released to players. Give it for scheduled hunts
   * (issue #14) to turn the release layer on; leave it out, or pass null, for
   * play-anytime hunts.
   */
  releasedAt?: TimeInput | null;
  /** The hunt's own solve window T in milliseconds, replacing the default. */
  solveWindowMs?: number | null;
}

/** Points per component. They add up to the total exactly. */
export interface ScoringV2Breakdown {
  correctness: number;
  firstAttemptBonus: number;
  completion: number;
  /** Points from the solve-time layer. */
  solveTime: number;
  /** Points from the release-time layer; 0 when the layer is off. */
  releaseTime: number;
  /** Points taken off for hints (a positive number). */
  hintPenalty: number;
  /** Points added to bring the attempt up to the floor. */
  effortCredit: number;
}

/** What each time layer was computed from, kept for research exports. */
export interface ScoringV2Timing {
  /** Stop start to this answer, in ms. Null when the start is unknown. */
  solveMs: number | null;
  solveTauMs: number;
  solveWindowMs: number;
  /** The most the solve layer could give on this answer. */
  solveWeight: number;
  /** True when a release time was supplied. */
  releaseActive: boolean;
  /** Clue release to this answer, in ms. Null when the layer is off. */
  releaseMs: number | null;
  releaseTauMs: number;
  releaseWindowMs: number;
  /** The most the release layer could give on this answer (0 when off). */
  releaseWeight: number;
}

export interface ScoringV2Result {
  version: 2;
  totalScore: number;
  breakdown: ScoringV2Breakdown;
  timing: ScoringV2Timing;
  feedback: {
    type: "correct" | "incorrect" | "partial";
    attemptNumber: number;
    canRetry: boolean;
  };
}

function toMs(value: TimeInput | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Milliseconds from `from` to `to`, never negative; null when either is unknown. */
function elapsedMs(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function count(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

/**
 * The share of a time layer that is left after `elapsed` ms: 1 at zero,
 * falling on a log curve to 0 at `windowMs` and staying 0 after it. An unknown
 * elapsed time earns nothing.
 */
export function timeLayerShare(elapsed: number | null, tauMs: number, windowMs: number): number {
  if (elapsed === null || !Number.isFinite(elapsed)) return 0;
  if (!(tauMs > 0) || !(windowMs > 0)) return 0;
  const t = Math.max(0, elapsed);
  return clamp01(1 - Math.log(1 + t / tauMs) / Math.log(1 + windowMs / tauMs));
}

/** The hunt's solve window when it is a usable number, otherwise the default. */
function solveWindow(overrideMs: number | null | undefined): number {
  return typeof overrideMs === "number" && Number.isFinite(overrideMs) && overrideMs > 0
    ? overrideMs
    : SCORING_V2.solve.windowMs;
}

interface TimeLayers {
  solveTime: number;
  releaseTime: number;
  timing: ScoringV2Timing;
}

/** Both time layers. Measured for every answer; points only for a correct one. */
function timeLayers(input: ScoringV2Input): TimeLayers {
  const answeredAt = toMs(input.answeredAt);
  const releasedAt = toMs(input.releasedAt);
  const releaseActive = releasedAt !== null;
  const releaseWeight = releaseActive ? SCORING_V2.timePoints * SCORING_V2.releaseShare : 0;
  const solveWeight = SCORING_V2.timePoints - releaseWeight;
  const solveWindowMs = solveWindow(input.solveWindowMs);
  const solveMs = elapsedMs(toMs(input.startedAt), answeredAt);
  const releaseMs = releaseActive ? elapsedMs(releasedAt, answeredAt) : null;
  const { solve, release } = SCORING_V2;

  return {
    solveTime: input.isCorrect
      ? Math.round(solveWeight * timeLayerShare(solveMs, solve.tauMs, solveWindowMs))
      : 0,
    releaseTime: input.isCorrect
      ? Math.round(releaseWeight * timeLayerShare(releaseMs, release.tauMs, release.windowMs))
      : 0,
    timing: {
      solveMs,
      solveTauMs: solve.tauMs,
      solveWindowMs,
      solveWeight,
      releaseActive,
      releaseMs,
      releaseTauMs: release.tauMs,
      releaseWindowMs: release.windowMs,
      releaseWeight,
    },
  };
}

export function calculateScoreV2(input: ScoringV2Input): ScoringV2Result {
  const mode: ScoringMode = input.scoringMode ?? "standard";
  const lenient = mode === "lenient";
  const attempt = Math.max(1, count(input.attemptNumber));

  // Correctness, with partial credit (never in binary mode) and attempt decay.
  const partial = mode === "binary" ? 0 : clamp01(input.partialCredit ?? 0);
  const credit = input.isCorrect ? 1 : partial;
  const attemptMultiplier = Math.max(
    SCORING_V2.attemptMultiplierFloor,
    1 - (attempt - 1) * SCORING_V2.attemptDecayPerRetry
  );
  const correctness = Math.round(SCORING_V2.correctnessPoints * credit * attemptMultiplier);
  const firstAttemptBonus = input.isCorrect && attempt === 1 ? SCORING_V2.firstAttemptBonus : 0;
  const completion = input.isCorrect ? SCORING_V2.completionPoints : 0;
  const { solveTime, releaseTime, timing } = timeLayers(input);

  // Hints are free in lenient mode.
  const hintPenalty = lenient
    ? 0
    : count(input.clueHintsUsed) * SCORING_V2.clueHintPenalty +
      count(input.challengeHintsUsed) * SCORING_V2.challengeHintPenalty;

  const earned = correctness + firstAttemptBonus + completion + solveTime + releaseTime - hintPenalty;
  const floor = lenient ? SCORING_V2.lenientMinScore : SCORING_V2.minScore;
  const totalScore = Math.min(SCORING_V2.maxScore, Math.max(floor, earned));

  return {
    version: 2,
    totalScore,
    breakdown: {
      correctness,
      firstAttemptBonus,
      completion,
      solveTime,
      releaseTime,
      hintPenalty,
      effortCredit: totalScore - earned,
    },
    timing,
    feedback: {
      type: input.isCorrect ? "correct" : partial > 0 ? "partial" : "incorrect",
      attemptNumber: attempt,
      canRetry: !input.isCorrect && attempt < SCORING_V2.maxAttempts[mode],
    },
  };
}
